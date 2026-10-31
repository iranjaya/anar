import { slugSchema } from "@anar/domain/agencies";
import { type NextRequest, NextResponse } from "next/server";
import { dataMode } from "./lib/api/mode";

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const real = dataMode() === "real";
  const [, slug, ...rest] = path.split("/");
  const companyRoute =
    slugSchema.safeParse(slug).success &&
    (rest.length === 0 || rest.join("/") === "settings/team");
  const realRoute =
    [
      "/",
      "/login",
      "/login/code",
      "/invite",
      "/account",
      "/account/sessions",
      "/workspaces",
      "/owner/agencies",
      "/agency",
      "/agency/staff",
      "/agency/invites",
      "/agency/companies",
    ].includes(path) || companyRoute;
  if (real && !realRoute) return new NextResponse(null, { status: 404 });
  const authScreen =
    real ||
    path === "/login" ||
    path.startsWith("/login/") ||
    path === "/invite" ||
    path === "/owner" ||
    path.startsWith("/owner/") ||
    path === "/agency" ||
    path.startsWith("/agency/") ||
    path === "/account/sessions";
  const incoming = new Headers(request.headers);
  incoming.set("x-anar-auth-screen", authScreen ? "1" : "0");
  incoming.delete("x-nonce");
  incoming.delete("Content-Security-Policy");
  if (!authScreen) return NextResponse.next({ request: { headers: incoming } });
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
  incoming.set("x-nonce", nonce);
  incoming.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers: incoming } });
  response.headers.set("Content-Security-Policy", policy);
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: ["/((?!api/|_next/|favicon.ico).*)"],
};
