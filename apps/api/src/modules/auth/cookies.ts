import type { FastifyRequest } from "fastify";

export type CookieTransport =
  | { protocol: "https" }
  | { protocol: "http"; local: true };

const cookies = {
  create(transport: CookieTransport) {
    const secure = transport.protocol === "https";
    if (
      !secure &&
      !(transport.protocol === "http" && transport.local === true)
    ) {
      throw new Error("HTTP session cookies require explicit local mode");
    }
    return {
      read(request: Pick<FastifyRequest, "headers">): string | null {
        const part = request.headers.cookie
          ?.split(";")
          .map((value) => value.trim())
          .find((value) => value.startsWith("anar_session="));
        const token = part?.slice("anar_session=".length);
        return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
      },
      issue(token: string, expiresAt: Date): string {
        return `anar_session=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}${secure ? "; Secure" : ""}`;
      },
      clear(): string {
        return `anar_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure ? "; Secure" : ""}`;
      },
    };
  },
};

export default cookies;
