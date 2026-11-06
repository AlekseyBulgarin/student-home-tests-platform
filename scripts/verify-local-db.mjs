import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `${command} failed`);
  return result.stdout;
}

const containerId = run("docker", ["ps", "--filter", "name=^/supabase_db_", "--format", "{{.ID}}"])
  .trim()
  .split(/\r?\n/)[0];

if (!containerId) throw new Error("Local Supabase is not running. Run npm run supabase:start first.");

const sqlUrl = new URL("./local-db-verification.sql", import.meta.url);
const sql = readFileSync(fileURLToPath(sqlUrl), "utf8");
run("docker", ["exec", "-i", containerId, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-f", "-"], { input: sql });
