import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config";

declare module "fastify" {
  interface FastifyRequest {
    /** Resolved user identity. Single-user MVP, so mostly informational. */
    user: string;
  }
}

const API_PREFIX = "/api/v1";

/** Constant-time string compare that never short-circuits on length. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) {
    // Still run a comparison to keep timing roughly uniform, then fail.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

function bearerToken(header: string | undefined): string {
  if (!header) return "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
}

/**
 * Auth seam. `/api/v1/*` requires `Authorization: Bearer <LECTERN_API_TOKEN>`
 * (constant-time compared); anything else is rejected with 401. Non-API routes
 * trust the `Ynh-User` header injected by YunoHost's SSO in production and fall
 * back to `LECTERN_DEV_USER` in dev. `request.user` is decorated for handlers.
 */
export function registerAuth(app: FastifyInstance): void {
  app.decorateRequest("user", "");

  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.url === API_PREFIX || req.url.startsWith(API_PREFIX + "/")) {
      const token = bearerToken(req.headers.authorization);
      if (token.length === 0 || !safeEqual(token, config.LECTERN_API_TOKEN)) {
        await reply.code(401).send({ error: "unauthorized" });
        return reply;
      }
      req.user = config.LECTERN_DEV_USER;
      return;
    }
    const ynhUser = req.headers["ynh-user"];
    req.user = (typeof ynhUser === "string" && ynhUser) || config.LECTERN_DEV_USER;
  });
}
