-- Safe operational rollback for 20261107020000_stage5_teacher_operations.sql.
-- This disables the new administrative surface without deleting result
-- snapshots, answers, audit records, or grade snapshots.  Deleting those
-- records would be an irreversible loss of academic data.
revoke execute on function public.server_refresh_teacher_attempt_expiry(uuid) from service_role;
revoke execute on function public.server_update_grade_scale(uuid,jsonb) from service_role;
revoke execute on function public.server_extend_teacher_attempt(uuid,uuid,timestamptz) from service_role;
revoke execute on function public.server_extend_teacher_test_attempts(uuid,uuid,timestamptz) from service_role;
revoke execute on function public.server_force_finish_teacher_attempt(uuid,uuid) from service_role;
revoke execute on function public.server_regrade_teacher_attempt(uuid,uuid) from service_role;
revoke select on public.teacher_grade_scales from authenticated;
