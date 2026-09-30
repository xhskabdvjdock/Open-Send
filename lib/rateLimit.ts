// Simple in-memory rate limiter (single-server LAN app — no external store needed).
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, max: number, windowMs: number): { ok: boolean; remaining: number; retryAfterMs: number } {
  const now = Date.now();
  const cur = buckets.get(key);
  if (!cur || now > cur.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: max - 1, retryAfterMs: 0 };
  }
  if (cur.count >= max) {
    return { ok: false, remaining: 0, retryAfterMs: cur.resetAt - now };
  }
  cur.count += 1;
  return { ok: true, remaining: max - cur.count, retryAfterMs: 0 };
}

export function loginKey(ip: string, username: string): string {
  return `login:${ip}:${(username || '').toLowerCase()}`;
}
