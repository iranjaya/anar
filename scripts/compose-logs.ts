import { execFileSync } from "node:child_process";

const logs = execFileSync("docker", ["compose", "logs", "--no-color"], {
  encoding: "utf8",
});
process.stdout.write(
  logs
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "postgresql://[REDACTED]")
    .replace(
      /((?:password|secret|token|DATABASE_URL)\s*[=:]\s*)[^\s,;]+/gi,
      "$1[REDACTED]",
    ),
);
