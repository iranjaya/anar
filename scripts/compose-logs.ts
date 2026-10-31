import { execFileSync } from "node:child_process";

const project = process.argv[2];
const logs = execFileSync(
  "docker",
  ["compose", ...(project ? ["-p", project] : []), "logs", "--no-color"],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);
process.stdout.write(
  logs
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "postgresql://[REDACTED]")
    .replace(
      /((?:password|secret|token|DATABASE_URL)\s*[=:]\s*)[^\s,;]+/gi,
      "$1[REDACTED]",
    ),
);
