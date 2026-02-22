type RateLimitEntry = {
  count: number;
  windowStartedAtMs: number;
  blockedUntilMs: number;
};

const rateLimitBuckets = new Map<string, RateLimitEntry>();

export type RateLimitConfig = {
  maxRequests: number;
  windowMs: number;
  blockMs?: number;
};

export type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

export function checkAndConsumeRateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  const existing = rateLimitBuckets.get(key);
  const entry: RateLimitEntry =
    existing || {
      count: 0,
      windowStartedAtMs: now,
      blockedUntilMs: 0,
    };

  if (entry.blockedUntilMs > now) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.blockedUntilMs - now) / 1000)),
    };
  }

  if (now - entry.windowStartedAtMs >= config.windowMs) {
    entry.count = 0;
    entry.windowStartedAtMs = now;
    entry.blockedUntilMs = 0;
  }

  entry.count += 1;
  if (entry.count > config.maxRequests) {
    if (config.blockMs && config.blockMs > 0) {
      entry.blockedUntilMs = now + config.blockMs;
      rateLimitBuckets.set(key, entry);
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil(config.blockMs / 1000)),
      };
    }

    rateLimitBuckets.set(key, entry);
    const retryAfterMs = entry.windowStartedAtMs + config.windowMs - now;
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(Math.max(0, retryAfterMs) / 1000)),
    };
  }

  rateLimitBuckets.set(key, entry);
  return {
    allowed: true,
    retryAfterSeconds: 0,
  };
}
