-- Edge Functions use the service role for server-authoritative grade-scale
-- reads and updates. Keep browser roles read-only through the RLS policy.
grant select, insert, update on public.teacher_grade_scales to service_role;
