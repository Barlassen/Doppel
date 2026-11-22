/**
 * Abuse guards of the model gateway: who may call it, how often, and how much it may spend per day.
 *
 * All state is in this process's memory. One `next start` process is exact; on a serverless platform each instance
 * keeps its own counters, so set the daily budgets with the number of instances in mind (or put a provider-side
 * spending limit on the key, which is the only hard stop).
 */

export const REQUESTS_PER_MINUTE = 12;
/** All clients together. Also the only limit when no trustworthy client address is available. */
export const GLOBAL_REQUESTS_PER_MINUTE = 60;
export const BUCKET_LIMIT = 2048;
const GLOBAL_KEY = "*";

type Env = Readonly<Record<string, string | undefined>>;
interface Bucket { tokens: number; at: number }
const buckets = new Map<string, Bucket>();

const isAddress = (value: string) => /^[a-f\d.:]{2,45}$/i.test(value) && /[.:]/.test(value);

/**
 * The client address, only from a header the client cannot write.
 *  - On Vercel the platform overwrites `x-vercel-forwarded-for`.
 *  - Behind N reverse proxies you run (`DOPPEL_TRUSTED_PROXIES=N`) the N-th entry from the right of
 *    `x-forwarded-for` was appended by your outermost proxy.
 *  - Otherwise there is none: Next.js keeps a client-sent `x-forwarded-for` as is, so trusting it would let anyone
 *    pick a fresh rate-limit bucket per request. Such requests share the global limit.
 */
export function clientAddress(headers: Headers, env: Env = process.env): string | undefined {
  if (env.VERCEL) {
    const address = headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ?? "";
    return isAddress(address) ? address.toLowerCase() : undefined;
  }
  const hops = Math.min(8, Math.max(0, Math.floor(Number(env.DOPPEL_TRUSTED_PROXIES) || 0)));
  if (!hops) return undefined;
  const chain = (headers.get("x-forwarded-for") ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  const address = chain[chain.length - hops] ?? "";
  return isAddress(address) ? address.toLowerCase() : undefined;
}

function level(key: string, limit: number, now: number): number {
  const bucket = buckets.get(key);
  return bucket ? Math.min(limit, bucket.tokens + Math.max(0, now - bucket.at) * limit / 60_000) : limit;
}

function store(key: string, tokens: number, now: number) {
  // Re-inserting keeps the Map in least-recently-used order.
  buckets.delete(key);
  if (buckets.size >= BUCKET_LIMIT) {
    // A bucket idle for a minute is full again, so dropping it loses nothing.
    for (const [other, bucket] of buckets) if (other !== GLOBAL_KEY && now - bucket.at >= 60_000) buckets.delete(other);
    // Still full: drop the least recently used client instead of refusing the new one.
    for (const other of buckets.keys()) {
      if (buckets.size < BUCKET_LIMIT) break;
      if (other !== GLOBAL_KEY) buckets.delete(other);
    }
  }
  buckets.set(key, { tokens, at: now });
}

/** Token buckets: per client (when its address is trustworthy) and for everyone together. `cost` > 1 for dear tasks. */
export function consumeRate(headers: Headers, cost = 1, now = Date.now(), env: Env = process.env): boolean {
  const address = clientAddress(headers, env);
  const global = level(GLOBAL_KEY, GLOBAL_REQUESTS_PER_MINUTE, now);
  const own = address ? level(address, REQUESTS_PER_MINUTE, now) : Infinity;
  if (global < cost || own < cost) return false;
  store(GLOBAL_KEY, global - cost, now);
  if (address) store(address, own - cost, now);
  return true;
}

// ---------------- daily budget ----------------

export const DEFAULT_DAILY_BUDGET_USD = 1;
export const DEFAULT_DAILY_TOKEN_BUDGET = 2_000_000;

export interface Spend { tokens: number; usd: number }
const spent: Spend & { day: string } = { day: "", tokens: 0, usd: 0 };
const reserved: Spend = { tokens: 0, usd: 0 };

function limitOf(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return raw !== undefined && raw.trim() !== "" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function budgetLimits(env: Env = process.env): Spend {
  return {
    usd: limitOf(env.DOPPEL_DAILY_BUDGET_USD, DEFAULT_DAILY_BUDGET_USD),
    tokens: limitOf(env.DOPPEL_DAILY_TOKEN_BUDGET, DEFAULT_DAILY_TOKEN_BUDGET),
  };
}

function rollDay(now: number) {
  const day = new Date(now).toISOString().slice(0, 10);
  if (spent.day !== day) Object.assign(spent, { day, tokens: 0, usd: 0 });
}

/**
 * Sets aside the worst case of one call before it is sent, so parallel calls cannot overrun the budget together.
 * Returns `settle(actual)` to replace the reservation with what the call really used, or undefined when today's
 * budget (UTC day) cannot cover the call.
 */
export function reserveBudget(worstCase: Spend, now = Date.now(), env: Env = process.env): ((actual: Spend) => void) | undefined {
  rollDay(now);
  const limits = budgetLimits(env);
  // A budget of 0 switches the gateway off, also for models without a known price.
  if (limits.usd <= 0 || limits.tokens <= 0) return undefined;
  if (spent.usd + reserved.usd + worstCase.usd > limits.usd || spent.tokens + reserved.tokens + worstCase.tokens > limits.tokens) return undefined;
  reserved.usd += worstCase.usd;
  reserved.tokens += worstCase.tokens;
  let open = true;
  return (actual) => {
    if (!open) return;
    open = false;
    reserved.usd = Math.max(0, reserved.usd - worstCase.usd);
    reserved.tokens = Math.max(0, reserved.tokens - worstCase.tokens);
    rollDay(Date.now());
    spent.usd += Math.max(0, actual.usd);
    spent.tokens += Math.max(0, actual.tokens);
  };
}

export const spentToday = (): Spend => ({ tokens: spent.tokens, usd: spent.usd });

// ---------------- same-origin ----------------

/**
 * Browsers attach `Origin` (and `Sec-Fetch-Site`) to a cross-site POST, and a page on another site cannot remove
 * them. A request without either is not a browser on another site (curl, a server, the smoke test) and is left to
 * the rate limit and the budget.
 */
export function sameOrigin(headers: Headers, env: Env = process.env): boolean {
  const site = headers.get("sec-fetch-site");
  const origin = headers.get("origin");
  if (!origin) return !site || site === "same-origin" || site === "none";
  const allowed = (env.DOPPEL_ALLOWED_ORIGINS ?? "").split(",").map((entry) => entry.trim().replace(/\/+$/, "").toLowerCase()).filter(Boolean);
  if (allowed.includes(origin.toLowerCase())) return true;
  if (site && site !== "same-origin") return false;
  let host: string;
  try {
    host = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  const own = [headers.get("host"), headers.get("x-forwarded-host")?.split(",")[0]].map((value) => value?.trim().toLowerCase()).filter(Boolean);
  return own.includes(host);
}

/** For checks only: forget every bucket and today's spend. */
export function resetGuards() {
  buckets.clear();
  Object.assign(spent, { day: "", tokens: 0, usd: 0 });
  reserved.tokens = 0;
  reserved.usd = 0;
}
