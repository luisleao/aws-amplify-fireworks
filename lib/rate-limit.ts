/**
 * Throttle de cortesia por IP, em memória.
 *
 * Segura o dedo nervoso de um participante, não um ataque: cada instância da
 * Lambda tem o seu próprio balde, então a proteção real contra abuso é uma
 * regra rate-based do AWS WAF na frente do app (ver README).
 */

const CAPACITY = 3; // rajada permitida
const REFILL_MS = 3000; // um fogo a cada 3s em regime
const MAX_TRACKED_KEYS = 10_000;

type Bucket = { tokens: number; updatedAt: number };

const globalRef = globalThis as typeof globalThis & { __fireworksBuckets?: Map<string, Bucket> };
const buckets: Map<string, Bucket> = (globalRef.__fireworksBuckets ??= new Map<string, Bucket>());

export type RateLimitResult = { ok: true } | { ok: false; retryAfterMs: number };

export function takeToken(key: string, now = Date.now()): RateLimitResult {
  if (buckets.size > MAX_TRACKED_KEYS) pruneStale(now);

  const bucket = buckets.get(key) ?? { tokens: CAPACITY, updatedAt: now };
  const refilled = Math.floor((now - bucket.updatedAt) / REFILL_MS);
  if (refilled > 0) {
    bucket.tokens = Math.min(CAPACITY, bucket.tokens + refilled);
    bucket.updatedAt += refilled * REFILL_MS;
  }

  if (bucket.tokens < 1) {
    buckets.set(key, bucket);
    return { ok: false, retryAfterMs: Math.max(0, bucket.updatedAt + REFILL_MS - now) };
  }

  bucket.tokens -= 1;
  // Um balde cheio que acabou de gastar um token precisa marcar o instante,
  // senão o refill contaria desde um `updatedAt` antigo e nunca limitaria.
  if (bucket.tokens === CAPACITY - 1) bucket.updatedAt = now;
  buckets.set(key, bucket);
  return { ok: true };
}

function pruneStale(now: number): void {
  const cutoff = now - CAPACITY * REFILL_MS;
  for (const [key, bucket] of buckets) {
    if (bucket.updatedAt < cutoff) buckets.delete(key);
  }
}
