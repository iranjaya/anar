import { execFile } from "node:child_process";
import { createECDH, randomBytes } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const preset = {
  PUBLIC_ORIGIN: "https://anar.visitshankhuwasabha.com",
  EMAIL_TRANSPORT: "resend",
  EMAIL_FROM: "info@visitshankhuwasabha.com",
  EMAIL_REPLY_TO: "info@visitshankhuwasabha.com",
  VAPID_SUBJECT: "mailto:info@visitshankhuwasabha.com",
  ANAR_PUSH_ENABLED: "false",
} as const;
const operatorNames = [
  "POSTGRES_PASSWORD",
  "APP_DATABASE_PASSWORD",
  "MIGRATION_DATABASE_PASSWORD",
  "DATABASE_URL",
  "MIGRATION_DATABASE_URL",
  "ANAR_LAN_BIND_ADDRESS",
  "ANAR_SITE_ADDRESS",
] as const;
export type EnvInitStatus =
  | "generated"
  | "filled from keychain"
  | "kept"
  | "still missing";
export type EnvInitResult = Record<string, EnvInitStatus>;

const assignment = /^([A-Z][A-Z0-9_]*)=(.*)$/;
const present = (value: string | undefined) =>
  value !== undefined &&
  value.trim() !== "" &&
  value.trim() !== '""' &&
  value.trim() !== "''";

function parse(text: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = assignment.exec(line);
    if (match) values.set(match[1], match[2]);
  }
  return values;
}

export async function readResendKey(): Promise<string> {
  try {
    const { stdout } = await run(
      "/usr/bin/security",
      ["find-generic-password", "-s", "env:anar", "-a", "email_api_key", "-w"],
      { maxBuffer: 16_384 },
    );
    return stdout.replace(/\r?\n$/, "");
  } catch {
    return "";
  }
}

export async function initEnv(
  directory: string,
  keychain: () => Promise<string> = readResendKey,
): Promise<EnvInitResult> {
  const template = await readFile(path.join(directory, ".env.example"), "utf8");
  let existing = "";
  let existed = false;
  try {
    existing = await readFile(path.join(directory, ".env"), "utf8");
    existed = true;
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    )
      throw error;
  }
  const example = parse(template);
  const saved = parse(existing);
  const values = new Map(example);
  const status: EnvInitResult = {};
  for (const [name, value] of saved) {
    if (!values.has(name) || present(value)) values.set(name, value);
  }
  const keep = (name: string) => {
    if (present(values.get(name))) {
      status[name] = "kept";
      return true;
    }
    return false;
  };
  for (const [name, value] of Object.entries(preset)) {
    if (!keep(name)) {
      values.set(name, value);
      status[name] = "generated";
    }
  }
  for (const name of ["MAIL_ENCRYPTION_KEY", "OTP_PEPPER"] as const) {
    if (!keep(name)) {
      values.set(name, randomBytes(32).toString("base64"));
      status[name] = "generated";
    }
  }
  const publicSet = keep("VAPID_PUBLIC_KEY");
  const privateSet = keep("VAPID_PRIVATE_KEY");
  if (!publicSet && !privateSet) {
    const vapid = createECDH("prime256v1");
    values.set("VAPID_PUBLIC_KEY", vapid.generateKeys().toString("base64url"));
    const privateKey = vapid.getPrivateKey();
    values.set(
      "VAPID_PRIVATE_KEY",
      Buffer.concat([
        Buffer.alloc(32 - privateKey.length),
        privateKey,
      ]).toString("base64url"),
    );
    status.VAPID_PUBLIC_KEY = "generated";
    status.VAPID_PRIVATE_KEY = "generated";
  } else if (!publicSet && privateSet) {
    try {
      const vapid = createECDH("prime256v1");
      vapid.setPrivateKey(
        Buffer.from(values.get("VAPID_PRIVATE_KEY") ?? "", "base64url"),
      );
      values.set(
        "VAPID_PUBLIC_KEY",
        vapid.getPublicKey().toString("base64url"),
      );
      status.VAPID_PUBLIC_KEY = "generated";
    } catch {
      status.VAPID_PUBLIC_KEY = "still missing";
    }
  } else if (publicSet && !privateSet) {
    status.VAPID_PRIVATE_KEY = "still missing";
  }
  if (!keep("RESEND_API_KEY")) {
    const key = await keychain().catch(() => "");
    if (present(key)) {
      values.set("RESEND_API_KEY", key);
      status.RESEND_API_KEY = "filled from keychain";
    } else status.RESEND_API_KEY = "still missing";
  }
  for (const name of operatorNames)
    status[name] = present(values.get(name)) ? "kept" : "still missing";

  const lines = template
    .trimEnd()
    .split(/\r?\n/)
    .map((line) => {
      const match = assignment.exec(line);
      return match ? `${match[1]}=${values.get(match[1]) ?? ""}` : line;
    });
  for (const [name, value] of values)
    if (!example.has(name)) lines.push(`${name}=${value}`);
  const output = `${lines.join("\n")}\n`;
  const target = path.join(directory, ".env");
  if (existed) await chmod(target, 0o600);
  await writeFile(target, output, { mode: 0o600 });
  await chmod(target, 0o600);
  return status;
}

if (import.meta.main) {
  try {
    const result = await initEnv(root);
    for (const [name, status] of Object.entries(result))
      process.stdout.write(`${name}: ${status}\n`);
  } catch {
    process.stderr.write("env:init failed\n");
    process.exitCode = 1;
  }
}
