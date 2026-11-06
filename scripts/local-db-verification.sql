begin;

do $$
declare
  v_teacher uuid := '11111111-1111-4111-8111-111111111111';
  v_other_teacher uuid := '22222222-2222-4222-8222-222222222222';
  v_student uuid;
  v_version uuid;
  v_assignment uuid;
  v_attempt uuid;
  v_question uuid;
  v_import jsonb;
  v_submission jsonb;
  v_remaining integer;
begin
  insert into auth.users(id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (v_teacher, 'authenticated', 'authenticated', 'teacher@example.test', '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_other_teacher, 'authenticated', 'authenticated', 'other@example.test', '{}'::jsonb, '{}'::jsonb, now(), now());

  v_import := public.server_import_test(v_teacher, jsonb_build_object(
    'title', 'Интеграционный тест',
    'description', 'Проверяет серверную обработку',
    'questions', jsonb_build_array(jsonb_build_object(
      'id', 'q1', 'type', 'single_choice', 'text', '2 + 2?', 'points', 2,
      'options', jsonb_build_array(
        jsonb_build_object('id', 'a', 'text', '4'),
        jsonb_build_object('id', 'b', 'text', '5')
      ),
      'correct_option_ids', jsonb_build_array('a'),
      'topics', jsonb_build_array('Сложение'),
      'explanation', 'Два плюс два равно четырём'
    ))
  ));

  v_version := (v_import->>'version_id')::uuid;
  perform public.server_publish_version(v_teacher, v_version);
  select id into v_question from public.questions where version_id = v_version;

  insert into public.students(teacher_id, first_name, last_name)
  values (v_teacher, 'Иван', 'Петров') returning id into v_student;
  insert into public.assignments(teacher_id, student_id, version_id, token_hash, token_hint, deadline_at, expires_at)
  values (v_teacher, v_student, v_version, digest('integration-token', 'sha256'), 'integ', now() + interval '1 day', now() + interval '2 days')
  returning id into v_assignment;

  select attempt_id into v_attempt
  from public.server_start_attempt(v_assignment, 'Иван', 'Петров', digest('integration-session', 'sha256'));
  perform public.server_save_answers(v_attempt, 1, jsonb_build_array(jsonb_build_object(
    'question_id', v_question, 'selected_option_ids', jsonb_build_array('a')
  )));
  v_submission := public.server_submit_attempt(v_attempt, '33333333-3333-4333-8333-333333333333');
  if (v_submission->>'score_percent')::numeric <> 100 then
    raise exception 'expected 100 percent, got %', v_submission;
  end if;

  perform public.server_update_teacher_settings(v_teacher, 90, 50::smallint, 75::smallint);
  if not exists (select 1 from public.teacher_profiles where id = v_teacher and retention_days = 90 and review_below = 50 and reinforce_below = 75) then
    raise exception 'teacher settings were not saved';
  end if;

  perform public.server_delete_student(v_teacher, v_student);
  select count(*) into v_remaining from public.assignments where id = v_assignment;
  if v_remaining <> 0 then raise exception 'assignment was not deleted by cascade'; end if;
  if not exists (select 1 from public.audit_log where teacher_id = v_teacher and action = 'student_data_deleted') then
    raise exception 'anonymized audit event was not created';
  end if;

  perform set_config('request.jwt.claim.sub', v_teacher::text, true);
  execute 'set local role authenticated';
  if (select count(*) from public.teacher_profiles) <> 1 then
    raise exception 'teacher RLS did not isolate own profile';
  end if;
  perform set_config('request.jwt.claim.sub', v_other_teacher::text, true);
  if (select count(*) from public.teacher_profiles) <> 0 then
    raise exception 'teacher RLS exposed another teacher profile';
  end if;
  execute 'reset role';
end;
$$;

rollback;
