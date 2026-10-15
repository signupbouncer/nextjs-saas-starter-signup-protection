// signupbouncer check: copy this file into your project as-is. No dependencies; runs on Node 18+, Deno, Bun, edge
// runtimes and Cloudflare Workers.
//
// Rules (the same in every signupbouncer snippet):
// - Act on `action`, never on `verdict`. In shadow mode `action` is always "allow" while `verdict` shows what
//   enforce mode would do.
// - Fail open: a timeout (1,500 ms by default), network error, non-2xx answer, unreadable body, a connection that
//   breaks mid-answer, or an answer missing any field the API always sends returns action "allow" and calls onError.
//   Only a complete, well-formed answer can refuse a sign-up. Our outage never blocks your sign-ups.
// - onError gets a fixed reason and, for HTTP answers, the status code: never an exception message or response text,
//   so it is safe to log. It is not awaited, and anything it throws or rejects with is ignored.
// - Trust no IP header by default: clientIp() reads only the header you name, the one your host overwrites.
//
// API reference: https://signupbouncer.com/docs#api

export type SignupAction = "allow" | "challenge" | "block";

export type CheckErrorReason =
  | "missing_api_key"
  | "malformed_api_key"
  | "timeout"
  | "network"
  | "http_status"
  | "bad_response";

/** Safe to log: a fixed reason and, for HTTP answers, the status code. Never an exception message or response text. */
export interface CheckError {
  reason: CheckErrorReason;
  status?: number;
}

export interface CheckResponse {
  verdict?: SignupAction;
  action: SignupAction;
  mode?: "shadow" | "enforce";
  score?: number;
  check_id?: string;
  reasons?: { code: string; detail?: string; points?: number; tier?: string }[];
  quota_exceeded?: boolean;
  [key: string]: unknown;
}

export type CheckResult =
  | { ok: true; action: SignupAction; response: CheckResponse }
  | { ok: false; action: "allow"; error: CheckError };

export interface CheckOptions {
  /** Your `sb_live_...` key. Keep it on the server. */
  apiKey: string;
  /** Default `https://signupbouncer.com`. */
  baseUrl?: string;
  /**
   * Leave it out. A key belongs to one app and its checks go there. Only an older all-apps key uses it to pick the
   * app (`app_...`; default: your first app). With a per-app key, another app's id is refused and the sign-up allowed.
   */
  app?: string;
  /** Default 1,500 ms. */
  timeoutMs?: number;
  /** Called when the check fails; the sign-up is allowed anyway. Not awaited; its errors and rejections are ignored. */
  onError?: (error: CheckError) => unknown;
}

export interface SignupInput {
  email?: string;
  ip?: string;
  userAgent?: string;
  /**
   * For OAuth/SSO sign-ups: the provider that verified `email` ("google", "github", "google.com", ...). signupbouncer
   * then scores only the IP and signup bursts, and still counts the email's domain in your stats. Leave it out for
   * email/password sign-ups.
   */
  authProvider?: string;
}

export const DEFAULT_BLOCK_MESSAGE = "Please sign up with a permanent email address.";

const ACTIONS = new Set<string>(["allow", "challenge", "block"]);

function failOpen(onError: CheckOptions["onError"], error: CheckError): CheckResult {
  // A broken or slow logger must not fail or delay the sign-up: not awaited, sync throws and rejections ignored.
  try {
    const pending: unknown = onError?.(error);
    if (pending && typeof (pending as PromiseLike<unknown>).then === "function") {
      Promise.resolve(pending).catch(() => {});
    }
  } catch {
    // ignored
  }
  return { ok: false, action: "allow", error };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isStrOrNull = (v: unknown): boolean => v === null || typeof v === "string";

/**
 * True only for a complete /v1/check answer: every field the API always sends, with the right type. Only such an
 * answer can refuse a sign-up; a partial or malformed one counts as a failed check (allow, onError "bad_response").
 * A refusing answer must also be consistent: enforce mode, under quota, and `action` equal to `verdict`.
 */
export function isCheckResponse(v: unknown): v is CheckResponse {
  if (!isObj(v)) return false;
  const { action, verdict, mode, reasons, shadow, normalized: n, network: net } = v;
  if (!isStr(action) || !ACTIONS.has(action) || !isStr(verdict) || !ACTIONS.has(verdict)) return false;
  if (mode !== "shadow" && mode !== "enforce") return false;
  if (!isNum(v.score) || !isStr(v.check_id) || !isNum(v.latency_ms) || typeof v.quota_exceeded !== "boolean") {
    return false;
  }
  const reasonOk = (r: unknown) => isObj(r) && isStr(r.code) && isStr(r.detail) && isNum(r.points) && isStr(r.tier);
  if (!Array.isArray(reasons) || !reasons.every(reasonOk)) return false;
  const shadowOk = (r: unknown) => isObj(r) && isStr(r.code) && isStr(r.detail) && isStr(r.tier);
  if (!Array.isArray(shadow) || !shadow.every(shadowOk)) return false;
  if (!isObj(n) || !isStrOrNull(n.provider) || !isNum(n.repeat_signups_7d)) return false;
  if (
    net !== null &&
    !(isObj(net) && (net.asn === null || isNum(net.asn)) && isStrOrNull(net.asn_org) && Array.isArray(net.kinds) &&
      net.kinds.every(isStr) && isStrOrNull(net.label) && isStr(net.prefix))
  ) return false;
  return action === "allow" || (mode === "enforce" && v.quota_exceeded === false && action === verdict);
}

/** Calls POST {baseUrl}/v1/check. Never throws. */
export async function checkSignup(options: CheckOptions, input: SignupInput): Promise<CheckResult> {
  const apiKey = options.apiKey?.trim() ?? "";
  if (!apiKey) return failOpen(options.onError, { reason: "missing_api_key" });
  // A key with a newline or other junk pasted in: fetch would reject the header and quote the key in its error.
  if (!/^[\x21-\x7e]+$/.test(apiKey)) return failOpen(options.onError, { reason: "malformed_api_key" });
  const url = (options.baseUrl ?? "https://signupbouncer.com").replace(/\/+$/, "") + "/v1/check";
  const body: Record<string, string> = {};
  if (input.email) body.email = input.email;
  if (input.ip) body.ip = input.ip;
  if (input.userAgent) body.user_agent = input.userAgent.slice(0, 512);
  if (input.authProvider) body.auth_provider = input.authProvider;
  if (options.app) body.app = options.app;
  if (!body.email && !body.ip) return { ok: true, action: "allow", response: { action: "allow" } };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 1500);
  try {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "authorization": `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      return failOpen(options.onError, { reason: controller.signal.aborted ? "timeout" : "network" });
    }
    try {
      if (!res.ok) {
        // Free the connection without waiting: cancel() rejects on a stream that already errored, and cleanup must
        // never fail the sign-up.
        try {
          res.body?.cancel().catch(() => {});
        } catch {
          // a locked or broken body: nothing to free
        }
        return failOpen(options.onError, { reason: "http_status", status: res.status });
      }
      let parsed: unknown;
      try {
        parsed = await res.json();
      } catch {
        if (controller.signal.aborted) return failOpen(options.onError, { reason: "timeout" });
        return failOpen(options.onError, { reason: "bad_response", status: res.status });
      }
      if (!isCheckResponse(parsed)) return failOpen(options.onError, { reason: "bad_response", status: res.status });
      return { ok: true, action: parsed.action, response: parsed };
    } catch {
      // Anything else that breaks while handling the answer still allows the sign-up.
      if (controller.signal.aborted) return failOpen(options.onError, { reason: "timeout" });
      return failOpen(options.onError, { reason: "bad_response", status: res.status });
    }
  } finally {
    clearTimeout(timer);
  }
}

/** True when the sign-up should be refused. `challenge` decides what a "challenge" answer does (default allow). */
export function shouldBlock(result: CheckResult, challenge: "allow" | "block" = "allow"): boolean {
  return result.action === "block" || (result.action === "challenge" && challenge === "block");
}

/**
 * Client IP from `header`, the one header your host or proxy overwrites with it (Vercel: "x-real-ip", Cloudflare:
 * "cf-connecting-ip", Fly.io: "fly-client-ip"). With no header named it returns undefined: a header nothing in front
 * of you overwrites is whatever the client sent. For a comma list (X-Forwarded-For behind your own proxies) it takes
 * the entry `trustedProxies` places from the right (default 1, the right-most); entries further left came from the
 * client. A list shorter than `trustedProxies` gives undefined. A count is only safe when every request passes through
 * all of those proxies: if the app or an inner proxy can be reached directly, a client can supply the missing entries.
 * Prefer a single header your outermost proxy overwrites.
 */
export function clientIp(headers: Headers, header: string | undefined, trustedProxies = 1): string | undefined {
  const entries = header ? headers.get(header)?.split(",") ?? [] : [];
  const n = Number.isInteger(trustedProxies) && trustedProxies >= 1 ? trustedProxies : 1;
  if (entries.length < n) return undefined;
  let ip = entries[entries.length - n].trim();
  if (ip.startsWith("[")) ip = ip.slice(1, ip.indexOf("]") > 0 ? ip.indexOf("]") : undefined);
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(ip)) ip = ip.slice(0, ip.lastIndexOf(":"));
  return ip.length > 0 && ip.length <= 64 && /^[0-9a-fA-F:.]+$/.test(ip) ? ip : undefined;
}
