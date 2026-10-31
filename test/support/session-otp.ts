import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

async function docker(...args: string[]) {
  return (await run("docker", args, { timeout: 30000 })).stdout.trim();
}

const [baseURL = "", email = "", minutesArg = ""] = process.argv.slice(2);
const minutes = Number(minutesArg);
if (!/^[a-z0-9.-]+@browser\.example\.test$/.test(email))
  throw new Error("Expected a browser test email");
if (!Number.isInteger(minutes) || minutes < 1)
  throw new Error("Expected whole minutes");
const project = await docker(
  "ps",
  "--filter",
  `publish=${new URL(baseURL).port}`,
  "--format",
  '{{.Label "com.docker.compose.project"}}',
);
if (!/^anar-browser-[0-9a-f-]{36}$/.test(project))
  throw new Error("Expected the disposable browser stack");
const db = await docker(
  "ps",
  "--quiet",
  "--filter",
  `label=com.docker.compose.project=${project}`,
  "--filter",
  "label=com.docker.compose.service=db",
);
const result = await docker(
  "exec",
  db,
  "psql",
  "-U",
  "postgres",
  "-d",
  "anar",
  "-v",
  "ON_ERROR_STOP=1",
  "-Atc",
  `UPDATE sessions SET last_otp_at = now() - interval '${minutes} minutes'
    FROM users WHERE sessions.user_id = users.id
    AND users.email = '${email}' AND sessions.revoked_at IS NULL`,
);
if (!/^UPDATE [1-9]/.test(result))
  throw new Error("Expected a live session to age");
