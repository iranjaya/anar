import { spawn } from "node:child_process";
import path from "node:path";
import {
  readRelease,
  releaseEnvironment,
  repository,
} from "./server-release.ts";

export async function serverCompose(
  root: string,
  envFile: string,
  args: string[],
): Promise<number> {
  const release = await readRelease(root);
  if (!path.isAbsolute(envFile) || !args.length)
    throw new Error(
      "An absolute production env path and Compose command are required",
    );
  if (
    ![
      "config",
      "pull",
      "up",
      "run",
      "stop",
      "start",
      "restart",
      "ps",
      "logs",
      "exec",
    ].includes(args[0])
  )
    throw new Error("Use a supported Compose command before any flags");
  if (args[0] === "config" && (args.length !== 2 || args[1] !== "--quiet"))
    throw new Error("Use config --quiet to keep secrets out of output");
  return new Promise((resolve, reject) => {
    const child = spawn(
      "docker",
      [
        "compose",
        "--project-name",
        "anar-server",
        "--env-file",
        envFile,
        "--file",
        path.join(root, "compose.yml"),
        "--file",
        path.join(root, "compose.server.yml"),
        ...args,
      ],
      {
        cwd: root,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          ...releaseEnvironment(release),
        },
        stdio: "inherit",
      },
    );
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

if (import.meta.main) {
  try {
    const [envFile, ...args] = process.argv.slice(2);
    process.exitCode = await serverCompose(repository, envFile ?? "", args);
  } catch {
    console.error(
      "Server Compose failed; check release digests, env path and command",
    );
    process.exitCode = 1;
  }
}
