// Structured request logging for API route handlers.
//
// Why a wrapper and not `middleware.ts`: Next.js middleware runs *before*
// the handler on a separate runtime and cannot observe response status,
// body, or duration. The community-recommended pattern (see
// https://omiid.me/notebook/29/logging-route-handler-responses-in-next-js-14
// and the r/nextjs "Possible to grab response data from middleware?"
// thread) is a higher-order function wrapping each route handler.
//
// Emits one JSON line per request to stdout, which fluentbit-gke ships to
// Google Cloud Logging with `jsonPayload.*` fields parsed out. Filter in
// Logs Explorer with e.g. `jsonPayload.route="llm.proxy"` or
// `jsonPayload.ms>5000`.
//
// Handlers receive a mutable `log` object and may attach identity fields
// (`userId`, `email`) or usage fields (`inputTokens`, `outputTokens`)
// once known — the wrapper emits them in the final log line.
//
// Deliberately does *not* read the response body — we serve SSE streams
// from the LLM proxy and cloning+draining them would break streaming and
// leak user prompts/completions into logs. The LLM proxy tees its own
// stream to extract usage and writes it to `log` directly.

type Ctx = any;
type Handler<C extends Ctx = Ctx> = (
  req: Request,
  ctx: C,
  log: LogMeta,
) => Promise<Response> | Response;

export interface LogMeta {
  userId?: string | null;
  email?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  /** Free-form extra fields to include in the log line. */
  extra?: Record<string, unknown>;
}

export interface LogFields extends LogMeta {
  evt: "http";
  route: string;
  method: string;
  path: string;
  status: number;
  ms: number;
  ip: string | null;
  reqId: string | null;
  ua: string | null;
  err?: string;
}

export function withLogging<C extends Ctx = Ctx>(
  route: string,
  handler: Handler<C>,
): (req: Request, ctx: C) => Promise<Response> {
  return async (req, ctx) => {
    const t0 = Date.now();
    const url = new URL(req.url);
    const meta: LogMeta = {};
    let status = 0;
    let err: unknown;
    try {
      const res = await handler(req, ctx, meta);
      status = res.status;
      return res;
    } catch (e) {
      err = e;
      status = 500;
      throw e;
    } finally {
      const fields: LogFields = {
        evt: "http",
        route,
        method: req.method,
        path: url.pathname,
        status,
        ms: Date.now() - t0,
        ip: req.headers.get("x-forwarded-for") ?? null,
        reqId: req.headers.get("x-request-id") ?? null,
        ua: req.headers.get("user-agent") ?? null,
        ...(meta.userId !== undefined ? { userId: meta.userId } : {}),
        ...(meta.email !== undefined ? { email: meta.email } : {}),
        ...(meta.inputTokens !== undefined ? { inputTokens: meta.inputTokens } : {}),
        ...(meta.outputTokens !== undefined ? { outputTokens: meta.outputTokens } : {}),
        ...(meta.extra ?? {}),
        ...(err ? { err: String((err as any)?.message ?? err) } : {}),
      };
      console.log(JSON.stringify(fields));
    }
  };
}
