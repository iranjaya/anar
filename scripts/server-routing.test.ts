import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { repository } from "./server-release.ts";

const run = promisify(execFile);
const read = (file: string) => readFile(path.join(repository, file), "utf8");

test("first issuance serves challenges without needing a certificate", async () => {
  const nginx = await read("ops/nginx/anar-http.conf");
  assert.match(nginx, /listen 80;/);
  assert.match(nginx, /location \^~ \/\.well-known\/acme-challenge\//);
  assert.match(nginx, /root \/etc\/letsencrypt\/anar-webroot;/);
  assert.match(nginx, /try_files \$uri =404;/);
  assert.match(nginx, /location \/ \{\s+return 503;/);
  assert.doesNotMatch(nginx, /listen 443|ssl_certificate|return 30[18]/);
});

test("nginx keeps the challenge outside the redirect and resolves backend replacements", async () => {
  const nginx = await read("ops/nginx/anar.conf");
  assert.match(
    nginx,
    /location \^~ \/\.well-known\/acme-challenge\/ \{\s+root \/etc\/letsencrypt\/anar-webroot;\s+default_type text\/plain;\s+try_files \$uri =404;\s+\}/,
  );
  assert.match(
    nginx,
    /location \/ \{\s+return 308 https:\/\/anar\.visitshankhuwasabha\.com\$request_uri;/,
  );
  for (const name of ["api", "web"]) {
    assert.match(nginx, new RegExp(`zone anar_${name}_backend 64k;`));
    assert.match(
      nginx,
      new RegExp(
        `server anar-${name}:${name === "api" ? 3001 : 3000} resolve;`,
      ),
    );
  }
  assert.equal(
    (nginx.match(/resolver 127\.0\.0\.11 valid=10s ipv6=off;/g) ?? []).length,
    2,
  );
  assert.match(
    nginx,
    /location = \/api \{\s+proxy_pass http:\/\/anar_api_backend;/,
  );
  assert.match(
    nginx,
    /location \^~ \/api\/ \{\s+proxy_pass http:\/\/anar_api_backend;/,
  );
  assert.doesNotMatch(nginx, /proxy_pass http:\/\/anar_api_backend\//);
  for (const header of [
    "Host $host",
    "Origin $http_origin",
    "X-Real-IP $remote_addr",
    "X-Forwarded-For $remote_addr",
    "X-Forwarded-Host $host",
    "X-Forwarded-Proto https",
    "X-Forwarded-Port 443",
    'Forwarded ""',
  ])
    assert.ok(nginx.includes(`proxy_set_header ${header};`));
  assert.doesNotMatch(nginx, /proxy_add_x_forwarded_for/);
  assert.match(nginx, /client_max_body_size 25664k;/);
  for (const timeout of [
    "client_body_timeout",
    "send_timeout",
    "proxy_read_timeout",
    "proxy_send_timeout",
  ])
    assert.ok(nginx.includes(`${timeout} 125s;`));
  assert.match(
    nginx,
    /add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;/,
  );
  assert.match(nginx, /add_header Cache-Control "private, no-store" always;/);
  assert.match(nginx, /proxy_cache off;/);
  assert.match(
    nginx,
    /location = \/sw\.js \{\s+proxy_pass http:\/\/anar_web_backend;/,
  );
  assert.match(
    nginx,
    /ssl_certificate \/etc\/letsencrypt\/anar\/live\/anar\.visitshankhuwasabha\.com\/fullchain.pem;/,
  );
});

test("renewal uses its own paths with no legacy directory hooks", async () => {
  const config = await read("ops/certbot/anar.ini");
  const service = await read("ops/systemd/anar-certbot.service");
  const timer = await read("ops/systemd/anar-certbot.timer");
  for (const setting of [
    "config-dir = /etc/letsencrypt/anar",
    "work-dir = /var/lib/letsencrypt/anar",
    "logs-dir = /var/log/letsencrypt/anar",
    "authenticator = webroot",
    "webroot-path = /etc/letsencrypt/anar-webroot",
  ])
    assert.ok(config.includes(setting));
  assert.match(
    config,
    /deploy-hook = \/home\/sishir\/anar\/current\/ops\/certbot\/deploy-hook.sh/,
  );
  assert.match(
    service,
    /renew --config \/home\/sishir\/anar\/current\/ops\/certbot\/anar.ini --cert-name anar.visitshankhuwasabha.com --no-directory-hooks/,
  );
  assert.doesNotMatch(
    config + service,
    /standalone|stop-nginx|start-nginx|cloudflare|pre-hook|post-hook/,
  );
  assert.match(timer, /Persistent=true/);
  assert.match(timer, /OnCalendar=\*-\*-\* 00,12:00:00/);
});

test("deploy hook tests nginx before reloading and refuses a failed config", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "anar-certbot-hook-"));
  const log = path.join(directory, "calls");
  try {
    await writeFile(
      path.join(directory, "docker"),
      '#!/bin/sh\nprintf "%s\\n" "$*" >> "$ANAR_TEST_LOG"\nif [ "$*" = "exec investment-nginx nginx -t" ]; then exit "$ANAR_TEST_EXIT"; fi\n',
      { mode: 0o755 },
    );
    const hook = path.join(repository, "ops/certbot/deploy-hook.sh");
    const env = {
      PATH: `${directory}:${process.env.PATH}`,
      ANAR_TEST_LOG: log,
      ANAR_TEST_EXIT: "0",
    };
    await run("sh", [hook], { env });
    assert.equal(
      await readFile(log, "utf8"),
      "exec investment-nginx nginx -t\nexec investment-nginx nginx -s reload\n",
    );
    await writeFile(log, "");
    await assert.rejects(
      run("sh", [hook], { env: { ...env, ANAR_TEST_EXIT: "1" } }),
    );
    assert.equal(
      await readFile(log, "utf8"),
      "exec investment-nginx nginx -t\n",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
