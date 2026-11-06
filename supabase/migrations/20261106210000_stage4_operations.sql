create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teacher_profiles(id) on delete cascade,
  actor_type text not null check (actor_type in ('teacher','system')),
  action text not null check (char_length(action) between 1 and 100),
  entity_type text not null check (char_length(entity_type) between 1 and 100),
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb check (pg_column_size(metadata) <= 4096),
  created_at timestamptz not null default now()
);

create index audit_log_teacher_created_idx on public.audit_log(teacher_id, created_at desc);
alter table public.audit_log enable row level security;
create policy teacher_reads_own_audit_log on public.audit_log
for select using (teacher_id = auth.uid());
revoke all on public.audit_log from anon;
grant select on public.audit_log to authenticated;

create or replace function public.server_delete_student(p_teacher_id uuid, p_student_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student public.students;
begin
  select * into v_student from public.students
  where id = p_student_id and teacher_id = p_teacher_id
  for update;
  if v_student.id is null then raise exception 'student_not_found'; end if;

  insert into public.audit_log(teacher_id, actor_type, action, entity_type, entity_id, metadata)
  values (p_teacher_id, 'teacher', 'student_data_deleted', 'student', p_student_id,
    jsonb_build_object('cascade', jsonb_build_array('assignments','attempts','answers','results','events')));

  delete from public.students where id = p_student_id and teacher_id = p_teacher_id;
  return jsonb_build_object('deleted_student_id', p_student_id);
end;
$$;

create or replace function public.server_purge_retention(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public, private
as $$
declare v_deleted integer;
begin
  delete from public.assignments assignment_row
  using public.attempts attempt_row, public.teacher_profiles teacher
  where attempt_row.assignment_id = assignment_row.id
    and teacher.id = assignment_row.teacher_id
    and attempt_row.status in ('submitted','expired')
    and coalesce(attempt_row.submitted_at, attempt_row.expired_at, attempt_row.started_at)
      < p_now - make_interval(days => teacher.retention_days);
  get diagnostics v_deleted = row_count;

  delete from private.rate_limit_buckets where window_started_at < p_now - interval '1 day';
  delete from private.attempt_sessions where expires_at < p_now - interval '1 day';
  return v_deleted;
end;
$$;

create or replace function public.server_update_teacher_settings(
  p_teacher_id uuid,
  p_retention_days integer,
  p_review_below smallint,
  p_reinforce_below smallint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_profile public.teacher_profiles;
begin
  if p_retention_days not between 1 and 3650 or p_review_below not between 1 and 99
    or p_reinforce_below not between 2 and 100 or p_review_below >= p_reinforce_below then
    raise exception 'invalid_settings';
  end if;
  update public.teacher_profiles
  set retention_days = p_retention_days, review_below = p_review_below, reinforce_below = p_reinforce_below
  where id = p_teacher_id
  returning * into v_profile;
  if v_profile.id is null then raise exception 'teacher_profile_not_found'; end if;
  return jsonb_build_object('retention_days',v_profile.retention_days,'review_below',v_profile.review_below,'reinforce_below',v_profile.reinforce_below);
end;
$$;

revoke all on function public.server_delete_student(uuid,uuid) from public, anon, authenticated;
revoke all on function public.server_purge_retention(timestamptz) from public, anon, authenticated;
revoke all on function public.server_update_teacher_settings(uuid,integer,smallint,smallint) from public, anon, authenticated;
grant execute on function public.server_delete_student(uuid,uuid) to service_role;
grant execute on function public.server_purge_retention(timestamptz) to service_role;
grant execute on function public.server_update_teacher_settings(uuid,integer,smallint,smallint) to service_role;
