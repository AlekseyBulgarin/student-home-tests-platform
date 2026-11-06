-- Edge Functions execute privileged, server-side workflows using service_role.
grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
