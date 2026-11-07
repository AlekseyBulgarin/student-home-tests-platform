-- Stage 5: operational teacher panel.  This migration is additive and keeps
-- existing result snapshots intact.  The companion rollback document only
-- revokes the new surface; it deliberately does not delete academic records.

do $$ begin
  create type public.attempt_completion_reason as enum ('student', 'teacher', 'deadline');
exception when duplicate_object then null;
end $$;

create or replace function public.grade_thresholds_are_valid(p_thresholds jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_item jsonb;
  v_label text;
  v_percent numeric;
  v_previous numeric := 101;
  v_labels text[] := '{}';
  v_count integer := 0;
begin
  if jsonb_typeof(p_thresholds) <> 'array' or jsonb_array_length(p_thresholds) < 2 or jsonb_array_length(p_thresholds) > 10 then
    return false;
  end if;
  for v_item in select value from jsonb_array_elements(p_thresholds)
  loop
    if jsonb_typeof(v_item) <> 'object' or jsonb_typeof(v_item->'min_percent') <> 'number' then return false; end if;
    v_label := trim(coalesce(v_item->>'label', ''));
    v_percent := (v_item->>'min_percent')::numeric;
    if char_length(v_label) < 1 or char_length(v_label) > 20 or v_percent < 0 or v_percent > 100
      or v_percent >= v_previous or v_label = any(v_labels) then
      return false;
    end if;
    v_labels := array_append(v_labels, v_label);
    v_previous := v_percent;
    v_count := v_count + 1;
  end loop;
  return v_count >= 2 and v_previous = 0;
exception when others then
  return false;
end;
$$;

create table if not exists public.teacher_grade_scales (
  teacher_id uuid primary key references public.teacher_profiles(id) on delete cascade,
  thresholds jsonb not null default '[{"label":"5","min_percent":85},{"label":"4","min_percent":70},{"label":"3","min_percent":50},{"label":"2","min_percent":0}]'::jsonb,
  updated_at timestamptz not null default now(),
  check (public.grade_thresholds_are_valid(thresholds))
);

alter table public.attempts
  add column if not exists completion_reason public.attempt_completion_reason,
  add column if not exists grade_label text check (grade_label is null or char_length(grade_label) between 1 and 20),
  add column if not exists grade_scale_snapshot jsonb;

create or replace function public.grade_label_for_percent(p_thresholds jsonb, p_percent numeric)
returns text
language sql
immutable
set search_path = public
as $$
  select item->>'label'
  from jsonb_array_elements(p_thresholds) item
  where (item->>'min_percent')::numeric <= p_percent
  order by (item->>'min_percent')::numeric desc
  limit 1;
$$;

create or replace function public.snapshot_attempt_grade()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_teacher_id uuid;
  v_thresholds jsonb := '[{"label":"5","min_percent":85},{"label":"4","min_percent":70},{"label":"3","min_percent":50},{"label":"2","min_percent":0}]'::jsonb;
begin
  if new.status = 'expired' and old.status is distinct from 'expired' then
    new.completion_reason := 'deadline';
  end if;
  if new.status = 'submitted' and (old.status is distinct from 'submitted' or new.grade_scale_snapshot is null) then
    select teacher_id into v_teacher_id from public.assignments where id = new.assignment_id;
    select thresholds into v_thresholds from public.teacher_grade_scales where teacher_id = v_teacher_id;
    new.grade_scale_snapshot := coalesce(v_thresholds, '[{"label":"5","min_percent":85},{"label":"4","min_percent":70},{"label":"3","min_percent":50},{"label":"2","min_percent":0}]'::jsonb);
    new.grade_label := public.grade_label_for_percent(new.grade_scale_snapshot, coalesce(new.score_percent, 0));
  end if;
  return new;
end;
$$;

drop trigger if exists snapshot_attempt_grade on public.attempts;
create trigger snapshot_attempt_grade
before update of status, score_percent, grade_scale_snapshot on public.attempts
for each row execute function public.snapshot_attempt_grade();

-- The existing system did not have a grade scale.  Snapshot the initial
-- default once so subsequent scale edits never rewrite historical results.
update public.attempts
set completion_reason = case when status = 'submitted' then 'student'::public.attempt_completion_reason when status = 'expired' then 'deadline'::public.attempt_completion_reason else null end,
    grade_scale_snapshot = case when status = 'submitted' then '[{"label":"5","min_percent":85},{"label":"4","min_percent":70},{"label":"3","min_percent":50},{"label":"2","min_percent":0}]'::jsonb else null end,
    grade_label = case when status = 'submitted' then public.grade_label_for_percent('[{"label":"5","min_percent":85},{"label":"4","min_percent":70},{"label":"3","min_percent":50},{"label":"2","min_percent":0}]'::jsonb, coalesce(score_percent, 0)) else null end
where completion_reason is null or (status = 'submitted' and grade_scale_snapshot is null);

create index if not exists attempts_operational_idx on public.attempts(status, deadline_at_snapshot);
create index if not exists assignments_teacher_version_idx on public.assignments(teacher_id, version_id);

alter table public.teacher_grade_scales enable row level security;
drop policy if exists teacher_reads_own_grade_scale on public.teacher_grade_scales;
create policy teacher_reads_own_grade_scale on public.teacher_grade_scales
for select using (teacher_id = auth.uid());
revoke all on public.teacher_grade_scales from anon;
grant select on public.teacher_grade_scales to authenticated;

create or replace function public.server_refresh_teacher_attempt_expiry(p_teacher_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_count integer;
begin
  update public.attempts attempt_row
  set status = 'expired', expired_at = now()
  from public.assignments assignment_row
  where attempt_row.assignment_id = assignment_row.id
    and assignment_row.teacher_id = p_teacher_id
    and attempt_row.status = 'in_progress'
    and attempt_row.deadline_at_snapshot <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.server_update_grade_scale(p_teacher_id uuid, p_thresholds jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.grade_thresholds_are_valid(p_thresholds) then raise exception 'invalid_grade_scale'; end if;
  insert into public.teacher_grade_scales(teacher_id, thresholds, updated_at)
  values (p_teacher_id, p_thresholds, now())
  on conflict (teacher_id) do update set thresholds = excluded.thresholds, updated_at = excluded.updated_at;
  insert into public.audit_log(teacher_id, actor_type, action, entity_type, metadata)
  values (p_teacher_id, 'teacher', 'grade_scale_updated', 'grade_scale', jsonb_build_object('threshold_count', jsonb_array_length(p_thresholds)));
  return jsonb_build_object('thresholds', p_thresholds);
end;
$$;

create or replace function public.server_extend_teacher_attempt(
  p_teacher_id uuid, p_attempt_id uuid, p_deadline_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_attempt public.attempts; v_assignment public.assignments; v_seconds integer;
begin
  select attempt_row.* into v_attempt
  from public.attempts attempt_row join public.assignments assignment_row on assignment_row.id = attempt_row.assignment_id
  where attempt_row.id = p_attempt_id and assignment_row.teacher_id = p_teacher_id
  for update of attempt_row;
  if v_attempt.id is null then raise exception 'attempt_not_found'; end if;
  select * into v_assignment from public.assignments where id = v_attempt.assignment_id for update;
  if v_attempt.status <> 'in_progress' or v_attempt.deadline_at_snapshot <= now() then raise exception 'attempt_not_active'; end if;
  if p_deadline_at <= now() or p_deadline_at <= v_attempt.deadline_at_snapshot then raise exception 'invalid_extension'; end if;
  v_seconds := extract(epoch from (p_deadline_at - v_attempt.deadline_at_snapshot))::integer;
  update public.attempts set deadline_at_snapshot = p_deadline_at where id = v_attempt.id;
  update public.assignments set deadline_at = p_deadline_at, expires_at = greatest(v_assignment.expires_at, p_deadline_at + interval '7 days') where id = v_assignment.id;
  insert into public.audit_log(teacher_id, actor_type, action, entity_type, entity_id, metadata)
  values (p_teacher_id, 'teacher', 'attempt_deadline_extended', 'attempt', p_attempt_id, jsonb_build_object('extension_seconds', v_seconds));
  return jsonb_build_object('attempt_id', p_attempt_id, 'deadline_at', p_deadline_at);
end;
$$;

create or replace function public.server_extend_teacher_test_attempts(
  p_teacher_id uuid, p_version_id uuid, p_deadline_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_count integer;
begin
  if p_deadline_at <= now() then raise exception 'invalid_extension'; end if;
  if not exists (
    select 1 from public.test_versions version_row
    join public.tests test_row on test_row.id = version_row.test_id
    where version_row.id = p_version_id and test_row.teacher_id = p_teacher_id
  ) then raise exception 'version_not_found'; end if;
  update public.attempts attempt_row
  set deadline_at_snapshot = p_deadline_at
  from public.assignments assignment_row
  where attempt_row.assignment_id = assignment_row.id
    and assignment_row.teacher_id = p_teacher_id
    and assignment_row.version_id = p_version_id
    and attempt_row.status = 'in_progress'
    and attempt_row.deadline_at_snapshot > now()
    and attempt_row.deadline_at_snapshot < p_deadline_at;
  get diagnostics v_count = row_count;
  update public.assignments assignment_row
  set deadline_at = p_deadline_at, expires_at = greatest(assignment_row.expires_at, p_deadline_at + interval '7 days')
  where assignment_row.teacher_id = p_teacher_id
    and assignment_row.version_id = p_version_id
    and exists (select 1 from public.attempts attempt_row where attempt_row.assignment_id = assignment_row.id and attempt_row.status = 'in_progress' and attempt_row.deadline_at_snapshot = p_deadline_at);
  insert into public.audit_log(teacher_id, actor_type, action, entity_type, entity_id, metadata)
  values (p_teacher_id, 'teacher', 'test_attempts_deadline_extended', 'test_version', p_version_id, jsonb_build_object('affected_attempts', v_count));
  return jsonb_build_object('affected_attempts', v_count, 'deadline_at', p_deadline_at);
end;
$$;

create or replace function public.server_force_finish_teacher_attempt(p_teacher_id uuid, p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare v_attempt public.attempts; v_score numeric; v_max numeric;
begin
  select attempt_row.* into v_attempt
  from public.attempts attempt_row join public.assignments assignment_row on assignment_row.id = attempt_row.assignment_id
  where attempt_row.id = p_attempt_id and assignment_row.teacher_id = p_teacher_id
  for update;
  if v_attempt.id is null then raise exception 'attempt_not_found'; end if;
  if v_attempt.status <> 'in_progress' or v_attempt.deadline_at_snapshot <= now() then raise exception 'attempt_not_active'; end if;
  insert into public.attempt_results(attempt_id, question_id, selected_option_ids, correct_option_ids, general_explanation, option_explanations, earned_points, max_points, is_correct)
  select p_attempt_id, q.id, coalesce(a.selected_option_ids, '{}'::text[]), k.correct_option_ids, k.general_explanation, k.option_explanations,
    case when coalesce(a.selected_option_ids, '{}'::text[]) @> k.correct_option_ids and coalesce(a.selected_option_ids, '{}'::text[]) <@ k.correct_option_ids then q.points else 0 end,
    q.points, coalesce(a.selected_option_ids, '{}'::text[]) @> k.correct_option_ids and coalesce(a.selected_option_ids, '{}'::text[]) <@ k.correct_option_ids
  from public.questions q join private.question_keys k on k.question_id = q.id
  left join public.attempt_answers a on a.attempt_id = p_attempt_id and a.question_id = q.id
  where q.version_id = v_attempt.version_id;
  select coalesce(sum(earned_points), 0), coalesce(sum(max_points), 0) into v_score, v_max from public.attempt_results where attempt_id = p_attempt_id;
  update public.attempts set status = 'submitted', completion_reason = 'teacher', submitted_at = now(),
    duration_seconds = greatest(0, extract(epoch from (now() - started_at))::integer), submission_idempotency_key = coalesce(submission_idempotency_key, gen_random_uuid()),
    score_points = v_score, max_points = v_max, score_percent = case when v_max = 0 then 0 else round(v_score / v_max * 100, 2) end
  where id = p_attempt_id;
  insert into public.audit_log(teacher_id, actor_type, action, entity_type, entity_id, metadata)
  values (p_teacher_id, 'teacher', 'attempt_force_finished', 'attempt', p_attempt_id, '{}'::jsonb);
  return jsonb_build_object('attempt_id', p_attempt_id, 'completion_reason', 'teacher');
end;
$$;

create or replace function public.server_regrade_teacher_attempt(p_teacher_id uuid, p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare v_attempt public.attempts; v_score numeric; v_max numeric;
begin
  select attempt_row.* into v_attempt
  from public.attempts attempt_row join public.assignments assignment_row on assignment_row.id = attempt_row.assignment_id
  where attempt_row.id = p_attempt_id and assignment_row.teacher_id = p_teacher_id
  for update;
  if v_attempt.id is null then raise exception 'attempt_not_found'; end if;
  if v_attempt.status <> 'submitted' then raise exception 'attempt_not_submitted'; end if;
  delete from public.attempt_results where attempt_id = p_attempt_id;
  insert into public.attempt_results(attempt_id, question_id, selected_option_ids, correct_option_ids, general_explanation, option_explanations, earned_points, max_points, is_correct)
  select p_attempt_id, q.id, coalesce(a.selected_option_ids, '{}'::text[]), k.correct_option_ids, k.general_explanation, k.option_explanations,
    case when coalesce(a.selected_option_ids, '{}'::text[]) @> k.correct_option_ids and coalesce(a.selected_option_ids, '{}'::text[]) <@ k.correct_option_ids then q.points else 0 end,
    q.points, coalesce(a.selected_option_ids, '{}'::text[]) @> k.correct_option_ids and coalesce(a.selected_option_ids, '{}'::text[]) <@ k.correct_option_ids
  from public.questions q join private.question_keys k on k.question_id = q.id
  left join public.attempt_answers a on a.attempt_id = p_attempt_id and a.question_id = q.id
  where q.version_id = v_attempt.version_id;
  select coalesce(sum(earned_points), 0), coalesce(sum(max_points), 0) into v_score, v_max from public.attempt_results where attempt_id = p_attempt_id;
  update public.attempts set score_points = v_score, max_points = v_max,
    score_percent = case when v_max = 0 then 0 else round(v_score / v_max * 100, 2) end,
    grade_scale_snapshot = null
  where id = p_attempt_id;
  insert into public.audit_log(teacher_id, actor_type, action, entity_type, entity_id, metadata)
  values (p_teacher_id, 'teacher', 'attempt_regraded', 'attempt', p_attempt_id, '{}'::jsonb);
  return jsonb_build_object('attempt_id', p_attempt_id, 'regraded', true);
end;
$$;

-- Keep student submission server-side and add the grade snapshot through the
-- trigger above.  The idempotency behaviour and answer immutability remain unchanged.
create or replace function public.server_submit_attempt(p_attempt_id uuid, p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v_attempt public.attempts; v_score numeric; v_max numeric;
begin
  select * into v_attempt from public.attempts where id=p_attempt_id for update;
  if v_attempt.id is null then raise exception 'attempt_not_found'; end if;
  if v_attempt.status = 'submitted' then
    return jsonb_build_object('attempt_id', v_attempt.id, 'score_points', v_attempt.score_points, 'max_points', v_attempt.max_points, 'score_percent', v_attempt.score_percent, 'idempotent', true);
  end if;
  if v_attempt.status <> 'in_progress' then raise exception 'attempt_closed'; end if;
  if now() >= v_attempt.deadline_at_snapshot then
    update public.attempts set status='expired', expired_at=now() where id=p_attempt_id;
    raise exception 'deadline_passed';
  end if;
  insert into public.attempt_results(attempt_id, question_id, selected_option_ids, correct_option_ids, general_explanation, option_explanations, earned_points, max_points, is_correct)
  select p_attempt_id, q.id, coalesce(a.selected_option_ids, '{}'::text[]), k.correct_option_ids, k.general_explanation, k.option_explanations,
    case when coalesce(a.selected_option_ids, '{}'::text[]) @> k.correct_option_ids and coalesce(a.selected_option_ids, '{}'::text[]) <@ k.correct_option_ids then q.points else 0 end,
    q.points, coalesce(a.selected_option_ids, '{}'::text[]) @> k.correct_option_ids and coalesce(a.selected_option_ids, '{}'::text[]) <@ k.correct_option_ids
  from public.questions q join private.question_keys k on k.question_id=q.id
  left join public.attempt_answers a on a.attempt_id=p_attempt_id and a.question_id=q.id
  where q.version_id=v_attempt.version_id;
  select coalesce(sum(earned_points),0), coalesce(sum(max_points),0) into v_score, v_max from public.attempt_results where attempt_id=p_attempt_id;
  update public.attempts set status='submitted', completion_reason='student', submitted_at=now(), duration_seconds=greatest(0, extract(epoch from (now()-started_at))::integer), submission_idempotency_key=p_idempotency_key, score_points=v_score, max_points=v_max, score_percent=case when v_max=0 then 0 else round(v_score/v_max*100,2) end where id=p_attempt_id returning * into v_attempt;
  return jsonb_build_object('attempt_id', v_attempt.id, 'score_points', v_attempt.score_points, 'max_points', v_attempt.max_points, 'score_percent', v_attempt.score_percent, 'idempotent', false);
end;
$$;

revoke all on function public.server_refresh_teacher_attempt_expiry(uuid) from public, anon, authenticated;
revoke all on function public.server_update_grade_scale(uuid,jsonb) from public, anon, authenticated;
revoke all on function public.server_extend_teacher_attempt(uuid,uuid,timestamptz) from public, anon, authenticated;
revoke all on function public.server_extend_teacher_test_attempts(uuid,uuid,timestamptz) from public, anon, authenticated;
revoke all on function public.server_force_finish_teacher_attempt(uuid,uuid) from public, anon, authenticated;
revoke all on function public.server_regrade_teacher_attempt(uuid,uuid) from public, anon, authenticated;
grant execute on function public.server_refresh_teacher_attempt_expiry(uuid) to service_role;
grant execute on function public.server_update_grade_scale(uuid,jsonb) to service_role;
grant execute on function public.server_extend_teacher_attempt(uuid,uuid,timestamptz) to service_role;
grant execute on function public.server_extend_teacher_test_attempts(uuid,uuid,timestamptz) to service_role;
grant execute on function public.server_force_finish_teacher_attempt(uuid,uuid) to service_role;
grant execute on function public.server_regrade_teacher_attempt(uuid,uuid) to service_role;
