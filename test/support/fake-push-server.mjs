// Stands in for the browser push services inside the disposable browser stack.
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";

const received = [];
let replies = [];

https
  .createServer(
    {
      key: readFileSync("/fake/server.key"),
      cert: readFileSync("/fake/server.pem"),
    },
    (request, response) => {
      let bytes = 0;
      request.on("data", (chunk) => {
        bytes += chunk.length;
      });
      request.on("end", () => {
        received.push({
          host: request.headers.host,
          path: request.url,
          method: request.method,
          ttl: request.headers.ttl ?? null,
          urgency: request.headers.urgency ?? null,
          topic: request.headers.topic ?? null,
          contentEncoding: request.headers["content-encoding"] ?? null,
          vapid: /^vapid t=.+, k=.+$/.test(request.headers.authorization ?? ""),
          bytes,
        });
        const reply = replies.shift() ?? { status: 201 };
        response.writeHead(
          reply.status,
          reply.retryAfter ? { "retry-after": String(reply.retryAfter) } : {},
        );
        response.end();
      });
    },
  )
  .listen(443);

http
  .createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      if (request.method === "GET" && request.url === "/requests") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(received));
        return;
      }
      if (request.method === "POST" && request.url === "/replies") {
        replies = JSON.parse(body || "[]");
        response.writeHead(204).end();
        return;
      }
      if (request.method === "POST" && request.url === "/reset") {
        received.length = 0;
        replies = [];
        response.writeHead(204).end();
        return;
      }
      response.writeHead(404).end();
    });
  })
  .listen(8080);
