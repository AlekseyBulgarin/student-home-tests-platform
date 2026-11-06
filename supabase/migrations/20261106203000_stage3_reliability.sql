alter table public.attempts
  add column if not exists last_event_sequence bigint not null default 0;

create table private.rate_limit_buckets (
  action text not null,
  key_hash bytea not null,
  window_started_at timestamptz not null,
  request_count integer not null default 1,
  primary key (action, key_hash, window_started_at)
);

create index rate_limit_expiry_idx on private.rate_limit_buckets(window_started_at);

create or replace function public.server_check_rate_limit(
  p_key_hash bytea,
  p_action text,
  p_limit integer,
  p_window_seconds integer
)
returns table(allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_window_start timestamptz;
  v_count integer;
  v_retry integer;
begin
  if p_limit < 1 or p_window_seconds < 1 or p_window_seconds > 3600 then
    raise exception 'invalid_rate_limit_configuration';
  end if;
  v_window_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into private.rate_limit_buckets(action, key_hash, window_started_at, request_count)
  values (p_action, p_key_hash, v_window_start, 1)
  on conflict (action, key_hash, window_started_at)
  do update set request_count = private.rate_limit_buckets.request_count + 1
  returning request_count into v_count;
  v_retry := greatest(1, ceil(extract(epoch from (v_window_start + make_interval(secs => p_window_seconds) - now())))::integer);
  delete from private.rate_limit_buckets where window_started_at < now() - interval '1 day';
  return query select v_count <= p_limit, case when v_count <= p_limit then 0 else v_retry end;
end;
$$;

create or replace function public.server_record_events(p_attempt_id uuid, p_events jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt public.attempts;
  v_event jsonb;
  v_type text;
  v_sequence bigint;
  v_client_time timestamptz;
  v_inserted integer := 0;
  v_max_sequence bigint := 0;
begin
  select * into v_attempt from public.attempts where id = p_attempt_id for update;
  if v_attempt.id is null then raise exception 'attempt_not_found'; end if;
  if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > 50 then raise exception 'invalid_event_batch'; end if;
  if v_attempt.status <> 'in_progress' and coalesce(v_attempt.submitted_at, v_attempt.expired_at) < now() - interval '5 minutes' then
    raise exception 'event_window_closed';
  end if;

  for v_event in select value from jsonb_array_elements(p_events)
  loop
    v_type := v_event->>'type';
    v_sequence := (v_event->>'sequence')::bigint;
    v_client_time := (v_event->>'client_occurred_at')::timestamptz;
    if v_type not in ('fullscreen_enter','fullscreen_exit','visibility_visible','visibility_hidden','window_focus','window_blur','copy_attempt','online','offline') then
      raise exception 'invalid_event_type';
    end if;
    if v_sequence < 1 or v_client_time < now() - interval '24 hours' or v_client_time > now() + interval '5 minutes' then
      raise exception 'invalid_event_metadata';
    end if;
    insert into public.attempt_events(attempt_id,event_id,sequence,type,client_occurred_at,payload)
    values (p_attempt_id,(v_event->>'event_id')::uuid,v_sequence,v_type,v_client_time,coalesce(v_event->'payload','{}'::jsonb))
    on conflict (attempt_id,event_id) do nothing;
    if found then v_inserted := v_inserted + 1; end if;
    v_max_sequence := greatest(v_max_sequence,v_sequence);
  end loop;
  update public.attempts set last_event_sequence=greatest(last_event_sequence,v_max_sequence) where id=p_attempt_id;
  return jsonb_build_object('accepted',v_inserted,'server_time',now(),'last_sequence',greatest(v_attempt.last_event_sequence,v_max_sequence));
end;
$$;

revoke all on function public.server_check_rate_limit(bytea,text,integer,integer) from public, anon, authenticated;
revoke all on function public.server_record_events(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.server_check_rate_limit(bytea,text,integer,integer) to service_role;
grant execute on function public.server_record_events(uuid,jsonb) to service_role;
