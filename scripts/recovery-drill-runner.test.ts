import assert from "node:assert/strict";
import { test } from "node:test";
import { loadApiConfig } from "../apps/api/src/lib/config.ts";
import {
  createProofKeys,
  createRecoveryDrillRunner,
} from "./recovery-drill-runner.ts";

const config = {
  envFile: "/private/synthetic-runtime",
  composeFiles: ["/repo/compose.yml", "/repo/compose.proof.yml"],
};

test("synthetic keys satisfy the real API config contract", () => {
  const keys = createProofKeys();
  assert.notEqual(keys.OTP_PEPPER, keys.MAIL_ENCRYPTION_KEY);
  assert.doesNotThrow(() =>
    loadApiConfig({
      ...keys,
      DATABASE_URL: "postgresql://synthetic",
      PUBLIC_ORIGIN: "http://127.0.0.1:49152",
      ANAR_LOCAL_HTTP: "true",
      ANAR_PUSH_ENABLED: "false",
      UPLOADS_ROOT: "/synthetic/uploads",
    }),
  );
});
function setup(output = "") {
  const calls: string[][] = [];
  const runner = createRecoveryDrillRunner({
    repository: "/repo",
    configuration: config,
    io: {
      async docker(args) {
        calls.push(args);
        return output;
      },
      async dockerFromFile() {},
      async dockerToFile() {},
      async revision() {
        return "a".repeat(40);
      },
    },
  });
  return { runner, calls };
}

test("drill refuses non-disposable projects without Docker commands", async () => {
  const c = setup();
  await assert.rejects(c.runner.assertDisposable("anar-local"));
  await assert.rejects(c.runner.stopDisposableContainers("anar-local"));
  assert.equal(c.calls.length, 0);
});

test("drill cleanup leaves projects it did not reserve untouched", async () => {
  const c = setup();
  await c.runner.stopDisposableContainers("anar-proof-test");
  assert.equal(c.calls.length, 0);
  assert.ok(
    c.calls.every(
      (args) =>
        !args.includes("--volumes") &&
        !args.includes("-v") &&
        !args.includes("prune"),
    ),
  );
  assert.ok(c.calls.every((args) => !args.includes("/repo/.env")));
});

test("source checksum refuses a running worker", async () => {
  const c = setup("worker\n");
  await assert.rejects(c.runner.sourceState("anar-proof-test"), /worker/);
  assert.equal(c.calls.length, 1);
});

test("unlabelled source volumes are refused before source startup", async () => {
  const calls: string[][] = [];
  const runner = createRecoveryDrillRunner({
    repository: "/repo",
    configuration: config,
    io: {
      async docker(args) {
        calls.push(args);
        return args.includes("volume") && args.includes("--format")
          ? "anar-proof-test_postgres_data\n"
          : "";
      },
      async dockerFromFile() {},
      async dockerToFile() {},
      async revision() {
        return "a".repeat(40);
      },
    },
  });
  await assert.rejects(runner.assertDisposable("anar-proof-test"), /occupied/);
  assert.equal(
    calls.some((args) => args.includes("up") || args.includes("migrate")),
    false,
  );
});

test("a source reservation race leaves the occupied volume and other containers alone", async () => {
  const calls: string[][] = [];
  const runner = createRecoveryDrillRunner({
    repository: "/repo",
    configuration: config,
    io: {
      async docker(args) {
        calls.push(args);
        return args.includes("inspect") ? "another-run-token" : "";
      },
      async dockerFromFile() {},
      async dockerToFile() {},
      async revision() {
        return "a".repeat(40);
      },
    },
  });
  await assert.rejects(
    runner.preparePausedImport("anar-proof-race"),
    /occupied/,
  );
  await runner.stopDisposableContainers("anar-proof-race");
  assert.equal(
    calls.some(
      (args) =>
        args.includes("build") || args.includes("up") || args.includes("down"),
    ),
    false,
  );
  assert.deepEqual(calls.at(-1), ["rm", "anar-proof-race_proof_reservation"]);
  assert.equal(
    calls.some((args) => args[0] === "volume" && args.includes("rm")),
    false,
  );
});

test("pauses the source at the chunk boundary and resumes only the restored import", async () => {
  const commands: string[][] = [];
  const requests: { route: string; body: unknown }[] = [];
  const batchId = "20000000-0000-4000-8000-000000000001";
  const leadId = "30000000-0000-4000-8000-000000000001";
  let reservationToken = "";
  const runner = createRecoveryDrillRunner({
    repository: "/repo",
    configuration: config,
    io: {
      async docker(args) {
        commands.push(args);
        if (args.includes("volume") && args.includes("create"))
          reservationToken =
            args
              .find((arg) => arg.startsWith("anar.proof.token="))
              ?.split("=")[1] ?? "";
        if (args.includes("inspect")) return reservationToken;
        if (args.includes("port")) return "127.0.0.1:49153\n";
        const query = args.at(-1) ?? "";
        if (query.startsWith("SELECT last_row_no")) return "500\n";
        if (query.includes("FROM worker_heartbeats")) return "1\n";
        if (query.startsWith("SELECT count(*) FROM pg_stat_activity"))
          return "0\n";
        if (query.startsWith("SELECT id FROM leads")) return leadId;
        if (query.startsWith("SELECT status")) return "done\n";
        if (query.includes("'ledgerRows'"))
          return JSON.stringify({
            ledgerRows: 501,
            distinctRowNumbers: 501,
            importedEvents: 501,
          });
        return "";
      },
      async dockerFromFile() {},
      async dockerToFile() {},
      async revision() {
        return "a".repeat(40);
      },
    },
    async request(url, init) {
      const route = new URL(String(url)).pathname;
      const body =
        typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
      requests.push({ route, body });
      let data: object = {};
      if (route === "/api/imports") data = { batchId };
      if (route.endsWith("dryRunImport")) data = { previewRevision: 1 };
      return Response.json({ ok: true, data });
    },
  });
  assert.deepEqual(await runner.preparePausedImport("anar-proof-test"), {
    processed: 500,
    totalRows: 501,
  });
  const kill = commands.findIndex(
    (args) => args.includes("kill") && args.includes("worker"),
  );
  const dropTrigger = commands.findIndex((args) =>
    args.some((value) => value.includes("DROP TRIGGER drill_pause")),
  );
  assert.ok(kill >= 0 && dropTrigger > kill);
  assert.ok(
    commands.some((args) =>
      args.some(
        (value) =>
          value.includes("NEW.row_no = 501") && value.includes("pg_sleep(600)"),
      ),
    ),
  );
  assert.ok(commands.every((args) => !args.includes("/repo/.env")));
  const uploaded = requests.find((item) => item.route === "/api/imports")
    ?.body as FormData;
  const file = uploaded.get("file") as File;
  assert.equal((await file.text()).trimEnd().split("\n").length, 502);
  assert.equal(
    requests.filter((item) => item.route.endsWith("commitImport")).length,
    1,
  );
  assert.deepEqual(await runner.resumeImport("anar-restore-test"), {
    ledgerRows: 501,
    distinctRowNumbers: 501,
    importedEvents: 501,
  });
  const resume = commands.filter((args) =>
    args.some((value) => value.startsWith("SELECT status")),
  );
  assert.ok(resume.every((args) => args.includes("anar-restore-test")));
  await runner.stopDisposableContainers("anar-proof-test");
  assert.ok(
    commands.some(
      (args) => args.includes("down") && args.includes("anar-proof-test"),
    ),
  );
  assert.ok(
    commands.some(
      (args) =>
        args[0] === "rm" && args.includes("anar-proof-test_proof_reservation"),
    ),
  );
  assert.ok(commands.every((args) => !args.includes("--volumes")));
});
