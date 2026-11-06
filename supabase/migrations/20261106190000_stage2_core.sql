create extension if not exists pgcrypto;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create type public.test_version_status as enum ('draft', 'published');
create type public.question_type as enum ('single_choice', 'multiple_choice');
create type public.attempt_status as enum ('in_progress', 'submitted', 'expired');
create type public.disclosure_policy as enum ('immediate', 'after_deadline', 'teacher_released');

create table public.teacher_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  retention_days integer not null default 365 check (retention_days between 1 and 3650),
  review_below smallint not null default 60 check (review_below between 1 and 99),
  reinforce_below smallint not null default 80 check (reinforce_below between 2 and 100),
  created_at timestamptz not null default now(),
  check (review_below < reinforce_below)
);

create table public.students (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teacher_profiles(id) on delete cascade,
  first_name text not null check (char_length(first_name) between 1 and 100),
  last_name text not null check (char_length(last_name) between 1 and 100),
  note text check (char_length(note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tests (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teacher_profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  description text not null default '' check (char_length(description) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.test_versions (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.tests(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  status public.test_version_status not null default 'draft',
  title_snapshot text not null,
  description_snapshot text not null default '',
  settings_snapshot jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  published_by uuid references public.teacher_profiles(id),
  created_at timestamptz not null default now(),
  unique (test_id, version_number),
  check ((status = 'draft' and published_at is null) or (status = 'published' and published_at is not null))
);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.test_versions(id) on delete cascade,
  stable_id text not null check (stable_id ~ '^[A-Za-z0-9._-]{1,100}$'),
  type public.question_type not null,
  text text not null check (char_length(text) between 1 and 5000),
  points numeric(8,2) not null check (points > 0),
  position integer not null check (position >= 0),
  unique (version_id, stable_id),
  unique (version_id, position)
);

create table public.question_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  stable_id text not null check (stable_id ~ '^[A-Za-z0-9._-]{1,100}$'),
  text text not null check (char_length(text) between 1 and 1000),
  position integer not null check (position >= 0),
  unique (question_id, stable_id),
  unique (question_id, position)
);

create table private.question_keys (
  question_id uuid primary key references public.questions(id) on delete cascade,
  correct_option_ids text[] not null check (cardinality(correct_option_ids) > 0),
  general_explanation text not null check (char_length(general_explanation) <= 10000),
  option_explanations jsonb not null default '{}'::jsonb
);

create table public.topics (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teacher_profiles(id) on delete cascade,
  normalized_name text not null,
  display_name text not null check (char_length(display_name) between 1 and 100),
  unique (teacher_id, normalized_name)
);

create table public.question_topics (
  question_id uuid not null references public.questions(id) on delete cascade,
  topic_id uuid not null references public.topics(id) on delete cascade,
  primary key (question_id, topic_id)
);

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teacher_profiles(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  version_id uuid not null references public.test_versions(id),
  token_hash bytea not null unique,
  token_hint text not null,
  starts_at timestamptz,
  deadline_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  disclosure_policy public.disclosure_policy not null default 'after_deadline',
  released_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at >= deadline_at)
);

create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null unique references public.assignments(id) on delete cascade,
  version_id uuid not null references public.test_versions(id),
  display_first_name text not null check (char_length(display_first_name) between 1 and 100),
  display_last_name text not null check (char_length(display_last_name) between 1 and 100),
  status public.attempt_status not null default 'in_progress',
  started_at timestamptz not null default now(),
  deadline_at_snapshot timestamptz not null,
  submitted_at timestamptz,
  expired_at timestamptz,
  last_client_revision bigint not null default 0,
  score_points numeric(10,2),
  max_points numeric(10,2),
  score_percent numeric(6,2),
  submission_idempotency_key uuid,
  duration_seconds integer,
  created_at timestamptz not null default now()
);

create table private.attempt_sessions (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.attempts(id) on delete cascade,
  token_hash bytea not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.attempt_answers (
  attempt_id uuid not null references public.attempts(id) on delete cascade,
  question_id uuid not null references public.questions(id),
  selected_option_ids text[] not null,
  client_revision bigint not null,
  saved_at timestamptz not null default now(),
  primary key (attempt_id, question_id)
);

create table public.attempt_results (
  attempt_id uuid not null references public.attempts(id) on delete cascade,
  question_id uuid not null references public.questions(id),
  selected_option_ids text[] not null,
  correct_option_ids text[] not null,
  general_explanation text not null,
  option_explanations jsonb not null default '{}'::jsonb,
  earned_points numeric(8,2) not null,
  max_points numeric(8,2) not null,
  is_correct boolean not null,
  primary key (attempt_id, question_id)
);

create table public.attempt_events (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.attempts(id) on delete cascade,
  event_id uuid not null,
  sequence bigint not null,
  type text not null check (type in ('fullscreen_enter','fullscreen_exit','visibility_visible','visibility_hidden','window_focus','window_blur','copy_attempt','online','offline')),
  client_occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  unique (attempt_id, event_id),
  check (pg_column_size(payload) <= 4096)
);

create index students_teacher_idx on public.students(teacher_id);
create index tests_teacher_idx on public.tests(teacher_id);
create index assignments_teacher_idx on public.assignments(teacher_id);
create index questions_version_idx on public.questions(version_id, position);
create index events_attempt_idx on public.attempt_events(attempt_id, sequence);

create or replace function public.protect_published_version()
returns trigger language plpgsql set search_path = public as $$
declare current_status public.test_version_status;
begin
  if tg_table_name = 'test_versions' then
    if old.status = 'published' then raise exception 'published version is immutable'; end if;
    return new;
  end if;

  select status into current_status
  from public.test_versions
  where id = coalesce(old.version_id, new.version_id);
  if current_status = 'published' then raise exception 'published version is immutable'; end if;
  return coalesce(new, old);
end;
$$;

create trigger protect_test_versions before update or delete on public.test_versions
for each row execute function public.protect_published_version();
create trigger protect_questions before insert or update or delete on public.questions
for each row execute function public.protect_published_version();

create or replace function public.protect_published_options()
returns trigger language plpgsql set search_path = public as $$
declare current_status public.test_version_status;
begin
  select tv.status into current_status
  from public.questions q join public.test_versions tv on tv.id = q.version_id
  where q.id = coalesce(old.question_id, new.question_id);
  if current_status = 'published' then raise exception 'published version is immutable'; end if;
  return coalesce(new, old);
end;
$$;
create trigger protect_question_options before insert or update or delete on public.question_options
for each row execute function public.protect_published_options();
create trigger protect_question_keys before insert or update or delete on private.question_keys
for each row execute function public.protect_published_options();

create or replace function public.server_import_test(p_teacher_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_test_id uuid;
  v_version_id uuid;
  v_question_id uuid;
  v_topic_id uuid;
  v_question jsonb;
  v_option jsonb;
  v_topic text;
  v_question_position bigint;
  v_option_position bigint;
  v_option_explanations jsonb;
begin
  insert into public.teacher_profiles(id) values (p_teacher_id) on conflict (id) do nothing;
  insert into public.tests(teacher_id, title, description)
  values (p_teacher_id, p_payload->>'title', coalesce(p_payload->>'description', ''))
  returning id into v_test_id;

  insert into public.test_versions(test_id, version_number, title_snapshot, description_snapshot, settings_snapshot)
  values (v_test_id, 1, p_payload->>'title', coalesce(p_payload->>'description', ''), coalesce(p_payload->'settings', '{}'::jsonb))
  returning id into v_version_id;

  for v_question, v_question_position in
    select value, ordinality - 1 from jsonb_array_elements(p_payload->'questions') with ordinality
  loop
    insert into public.questions(version_id, stable_id, type, text, points, position)
    values (v_version_id, v_question->>'id', (v_question->>'type')::public.question_type,
      v_question->>'text', (v_question->>'points')::numeric, v_question_position)
    returning id into v_question_id;

    v_option_explanations := '{}'::jsonb;
    for v_option, v_option_position in
      select value, ordinality - 1 from jsonb_array_elements(v_question->'options') with ordinality
    loop
      insert into public.question_options(question_id, stable_id, text, position)
      values (v_question_id, v_option->>'id', v_option->>'text', v_option_position);
      if v_option ? 'explanation' then
        v_option_explanations := v_option_explanations || jsonb_build_object(v_option->>'id', v_option->>'explanation');
      end if;
    end loop;

    insert into private.question_keys(question_id, correct_option_ids, general_explanation, option_explanations)
    values (
      v_question_id,
      array(select jsonb_array_elements_text(v_question->'correct_option_ids')),
      coalesce(v_question->>'explanation', ''),
      v_option_explanations
    );

    for v_topic in select jsonb_array_elements_text(v_question->'topics')
    loop
      insert into public.topics(teacher_id, normalized_name, display_name)
      values (p_teacher_id, lower(trim(v_topic)), trim(v_topic))
      on conflict (teacher_id, normalized_name) do update set display_name = excluded.display_name
      returning id into v_topic_id;
      insert into public.question_topics(question_id, topic_id) values (v_question_id, v_topic_id);
    end loop;
  end loop;

  return jsonb_build_object('test_id', v_test_id, 'version_id', v_version_id);
end;
$$;

create or replace function public.server_publish_version(p_teacher_id uuid, p_version_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_version public.test_versions;
begin
  update public.test_versions tv
  set status = 'published', published_at = now(), published_by = p_teacher_id
  from public.tests t
  where tv.id = p_version_id and t.id = tv.test_id and t.teacher_id = p_teacher_id and tv.status = 'draft'
  returning tv.* into v_version;
  if v_version.id is null then raise exception 'version_not_publishable'; end if;
  return jsonb_build_object('version_id', v_version.id, 'published_at', v_version.published_at);
end;
$$;

create or replace function public.server_save_answers(p_attempt_id uuid, p_revision bigint, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_attempt public.attempts; v_answer jsonb; v_question_id uuid; v_selected text[];
begin
  select * into v_attempt from public.attempts where id = p_attempt_id for update;
  if v_attempt.id is null then raise exception 'attempt_not_found'; end if;
  if v_attempt.status <> 'in_progress' then raise exception 'attempt_closed'; end if;
  if now() >= v_attempt.deadline_at_snapshot then
    update public.attempts set status='expired', expired_at=now() where id=p_attempt_id;
    raise exception 'deadline_passed';
  end if;
  if p_revision <= v_attempt.last_client_revision then
    return jsonb_build_object('accepted', false, 'revision', v_attempt.last_client_revision, 'saved_at', now());
  end if;

  for v_answer in select value from jsonb_array_elements(p_answers)
  loop
    select q.id into v_question_id from public.questions q
    where q.id = (v_answer->>'question_id')::uuid and q.version_id = v_attempt.version_id;
    if v_question_id is null then raise exception 'question_out_of_scope'; end if;
    select coalesce(array_agg(distinct value order by value), '{}'::text[]) into v_selected
    from jsonb_array_elements_text(coalesce(v_answer->'selected_option_ids', '[]'::jsonb));
    if exists (select 1 from unnest(v_selected) selected where not exists (
      select 1 from public.question_options o where o.question_id = v_question_id and o.stable_id = selected
    )) then raise exception 'option_out_of_scope'; end if;
    insert into public.attempt_answers(attempt_id, question_id, selected_option_ids, client_revision, saved_at)
    values (p_attempt_id, v_question_id, v_selected, p_revision, now())
    on conflict (attempt_id, question_id) do update set
      selected_option_ids=excluded.selected_option_ids, client_revision=excluded.client_revision, saved_at=excluded.saved_at;
  end loop;
  update public.attempts set last_client_revision=p_revision where id=p_attempt_id;
  return jsonb_build_object('accepted', true, 'revision', p_revision, 'saved_at', now());
end;
$$;

create or replace function public.server_submit_attempt(p_attempt_id uuid, p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v_attempt public.attempts; v_score numeric; v_max numeric;
begin
  select * into v_attempt from public.attempts where id=p_attempt_id for update;
  if v_attempt.id is null then raise exception 'attempt_not_found'; end if;
  if v_attempt.status = 'submitted' then
    return jsonb_build_object('attempt_id', v_attempt.id, 'score_points', v_attempt.score_points,
      'max_points', v_attempt.max_points, 'score_percent', v_attempt.score_percent, 'idempotent', true);
  end if;
  if v_attempt.status <> 'in_progress' then raise exception 'attempt_closed'; end if;
  if now() >= v_attempt.deadline_at_snapshot then
    update public.attempts set status='expired', expired_at=now() where id=p_attempt_id;
    raise exception 'deadline_passed';
  end if;

  insert into public.attempt_results(attempt_id, question_id, selected_option_ids, correct_option_ids,
    general_explanation, option_explanations, earned_points, max_points, is_correct)
  select p_attempt_id, q.id, coalesce(a.selected_option_ids, '{}'::text[]), k.correct_option_ids,
    k.general_explanation, k.option_explanations,
    case when coalesce(a.selected_option_ids, '{}'::text[]) @> k.correct_option_ids
      and coalesce(a.selected_option_ids, '{}'::text[]) <@ k.correct_option_ids
      then q.points else 0 end,
    q.points,
    coalesce(a.selected_option_ids, '{}'::text[]) @> k.correct_option_ids
      and coalesce(a.selected_option_ids, '{}'::text[]) <@ k.correct_option_ids
  from public.questions q
  join private.question_keys k on k.question_id=q.id
  left join public.attempt_answers a on a.attempt_id=p_attempt_id and a.question_id=q.id
  where q.version_id=v_attempt.version_id;

  select coalesce(sum(earned_points),0), coalesce(sum(max_points),0) into v_score, v_max
  from public.attempt_results where attempt_id=p_attempt_id;
  update public.attempts set status='submitted', submitted_at=now(),
    duration_seconds=greatest(0, extract(epoch from (now()-started_at))::integer),
    submission_idempotency_key=p_idempotency_key, score_points=v_score, max_points=v_max,
    score_percent=case when v_max=0 then 0 else round(v_score/v_max*100,2) end
  where id=p_attempt_id returning * into v_attempt;
  return jsonb_build_object('attempt_id', v_attempt.id, 'score_points', v_attempt.score_points,
    'max_points', v_attempt.max_points, 'score_percent', v_attempt.score_percent, 'idempotent', false);
end;
$$;

create or replace function public.server_resolve_assignment(p_token_hash bytea)
returns table(id uuid, teacher_id uuid, student_id uuid, version_id uuid, deadline_at timestamptz,
  expires_at timestamptz, disclosure_policy public.disclosure_policy, revoked_at timestamptz,
  student_first_name text, student_last_name text, test_title text)
language sql security definer set search_path = public as $$
  select a.id, a.teacher_id, a.student_id, a.version_id, a.deadline_at, a.expires_at,
    a.disclosure_policy, a.revoked_at, s.first_name, s.last_name, tv.title_snapshot
  from public.assignments a
  join public.students s on s.id=a.student_id
  join public.test_versions tv on tv.id=a.version_id
  where a.token_hash=p_token_hash and a.revoked_at is null and a.expires_at>now()
  limit 1;
$$;

create or replace function public.server_start_attempt(
  p_assignment_id uuid, p_first_name text, p_last_name text, p_session_hash bytea
)
returns table(attempt_id uuid, session_expires_at timestamptz)
language plpgsql security definer set search_path = public, private as $$
declare v_assignment public.assignments; v_attempt_id uuid; v_session_expires timestamptz;
begin
  select * into v_assignment from public.assignments where id=p_assignment_id for update;
  if v_assignment.id is null or v_assignment.revoked_at is not null or v_assignment.expires_at<=now() then
    raise exception 'assignment_unavailable';
  end if;
  if v_assignment.starts_at is not null and v_assignment.starts_at>now() then raise exception 'assignment_not_started'; end if;
  if v_assignment.deadline_at<=now() then raise exception 'deadline_passed'; end if;
  insert into public.attempts(assignment_id,version_id,display_first_name,display_last_name,deadline_at_snapshot)
  values (v_assignment.id,v_assignment.version_id,trim(p_first_name),trim(p_last_name),v_assignment.deadline_at)
  on conflict (assignment_id) do update set assignment_id=excluded.assignment_id
  returning id into v_attempt_id;
  v_session_expires := least(v_assignment.expires_at, now()+interval '24 hours');
  insert into private.attempt_sessions(attempt_id,token_hash,expires_at)
  values (v_attempt_id,p_session_hash,v_session_expires);
  return query select v_attempt_id,v_session_expires;
end;
$$;

create or replace function public.server_resolve_session(p_session_hash bytea)
returns table(attempt_id uuid)
language sql security definer set search_path = public, private as $$
  select s.attempt_id from private.attempt_sessions s
  join public.attempts a on a.id=s.attempt_id
  join public.assignments ass on ass.id=a.assignment_id
  where s.token_hash=p_session_hash and s.expires_at>now() and ass.revoked_at is null and ass.expires_at>now()
  limit 1;
$$;

revoke all on function public.server_import_test(uuid,jsonb) from public, anon, authenticated;
revoke all on function public.server_publish_version(uuid,uuid) from public, anon, authenticated;
revoke all on function public.server_save_answers(uuid,bigint,jsonb) from public, anon, authenticated;
revoke all on function public.server_submit_attempt(uuid,uuid) from public, anon, authenticated;
revoke all on function public.server_resolve_assignment(bytea) from public, anon, authenticated;
revoke all on function public.server_start_attempt(uuid,text,text,bytea) from public, anon, authenticated;
revoke all on function public.server_resolve_session(bytea) from public, anon, authenticated;
grant execute on function public.server_import_test(uuid,jsonb) to service_role;
grant execute on function public.server_publish_version(uuid,uuid) to service_role;
grant execute on function public.server_save_answers(uuid,bigint,jsonb) to service_role;
grant execute on function public.server_submit_attempt(uuid,uuid) to service_role;
grant execute on function public.server_resolve_assignment(bytea) to service_role;
grant execute on function public.server_start_attempt(uuid,text,text,bytea) to service_role;
grant execute on function public.server_resolve_session(bytea) to service_role;

alter table public.teacher_profiles enable row level security;
alter table public.students enable row level security;
alter table public.tests enable row level security;
alter table public.test_versions enable row level security;
alter table public.questions enable row level security;
alter table public.question_options enable row level security;
alter table public.topics enable row level security;
alter table public.question_topics enable row level security;
alter table public.assignments enable row level security;
alter table public.attempts enable row level security;
alter table public.attempt_answers enable row level security;
alter table public.attempt_results enable row level security;
alter table public.attempt_events enable row level security;

create policy teacher_owns_profile on public.teacher_profiles
for all using (id = auth.uid()) with check (id = auth.uid());
create policy teacher_owns_students on public.students
for all using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());
create policy teacher_owns_tests on public.tests
for all using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());
create policy teacher_reads_versions on public.test_versions
for select using (exists (select 1 from public.tests t where t.id = test_id and t.teacher_id = auth.uid()));
create policy teacher_reads_questions on public.questions
for select using (exists (select 1 from public.test_versions tv join public.tests t on t.id = tv.test_id where tv.id = version_id and t.teacher_id = auth.uid()));
create policy teacher_reads_options on public.question_options
for select using (exists (select 1 from public.questions q join public.test_versions tv on tv.id = q.version_id join public.tests t on t.id = tv.test_id where q.id = question_id and t.teacher_id = auth.uid()));
create policy teacher_owns_topics on public.topics
for all using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());
create policy teacher_reads_question_topics on public.question_topics
for select using (exists (select 1 from public.topics t where t.id = topic_id and t.teacher_id = auth.uid()));
create policy teacher_owns_assignments on public.assignments
for select using (teacher_id = auth.uid());
create policy teacher_reads_attempts on public.attempts
for select using (exists (select 1 from public.assignments a where a.id = assignment_id and a.teacher_id = auth.uid()));
create policy teacher_reads_answers on public.attempt_answers
for select using (exists (select 1 from public.attempts at join public.assignments a on a.id = at.assignment_id where at.id = attempt_id and a.teacher_id = auth.uid()));
create policy teacher_reads_results on public.attempt_results
for select using (exists (select 1 from public.attempts at join public.assignments a on a.id = at.assignment_id where at.id = attempt_id and a.teacher_id = auth.uid()));
create policy teacher_reads_events on public.attempt_events
for select using (exists (select 1 from public.attempts at join public.assignments a on a.id = at.assignment_id where at.id = attempt_id and a.teacher_id = auth.uid()));

revoke all on all tables in schema public from anon;
revoke all on all tables in schema private from anon, authenticated;
grant usage on schema public to authenticated;
grant select on public.teacher_profiles, public.students, public.tests, public.test_versions,
  public.questions, public.question_options, public.topics, public.question_topics,
  public.assignments, public.attempts, public.attempt_answers, public.attempt_results,
  public.attempt_events to authenticated;
