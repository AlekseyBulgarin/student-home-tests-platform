import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const jsonHeaders = { "Content-Type": "application/json", "Cache-Control": "no-store" };

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: jsonHeaders });

  const expectedSecret = Deno.env.get("MAINTENANCE_SECRET");
  const suppliedSecret = request.headers.get("x-maintenance-secret");
  if (!expectedSecret || !suppliedSecret || suppliedSecret !== expectedSecret) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: jsonHeaders });
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const service = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await service.rpc("server_purge_retention");
  if (error) return new Response(JSON.stringify({ error: "maintenance_failed" }), { status: 500, headers: jsonHeaders });

  return new Response(JSON.stringify({ deleted_assignments: data, completed_at: new Date().toISOString() }), { status: 200, headers: jsonHeaders });
});
