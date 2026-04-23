// In-memory rate limiter for Deno Edge Functions.
//
// NOTE (M13, deferred): This Map resets on every function cold start, so a
// determined caller spread across cold starts can exceed the configured cap.
// A Postgres-backed counter would solve this but project policy defers backend
// rate limiting until centrally-managed primitives exist (see
// <important-info> "Do Not Implement Backend Rate Limiting"). Layered defenses
// (honeypot fields, strict input validation, and downstream webhook limits)
// remain in place at each call site as the practical mitigation.

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export function checkRateLimit(
  identifier: string,
  config: RateLimitConfig
): RateLimitResult {
  const now = Date.now();
  const record = rateLimitMap.get(identifier);
  
  // Periodically clean expired entries (10% chance per call)
  if (Math.random() < 0.1) {
    cleanExpiredEntries(now);
  }
  
  // New or expired window
  if (!record || now > record.resetAt) {
    const resetAt = now + config.windowMs;
    rateLimitMap.set(identifier, { count: 1, resetAt });
    return { 
      allowed: true, 
      remaining: config.maxRequests - 1, 
      resetAt 
    };
  }
  
  // Within window - check if limit exceeded
  if (record.count >= config.maxRequests) {
    return { 
      allowed: false, 
      remaining: 0, 
      resetAt: record.resetAt 
    };
  }
  
  // Increment count
  record.count++;
  return { 
    allowed: true, 
    remaining: config.maxRequests - record.count, 
    resetAt: record.resetAt 
  };
}

function cleanExpiredEntries(now: number) {
  for (const [key, value] of rateLimitMap.entries()) {
    if (now > value.resetAt) {
      rateLimitMap.delete(key);
    }
  }
}

// Get client IP from request headers
export function getClientIP(req: Request): string {
  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }
  
  const realIp = req.headers.get('x-real-ip');
  if (realIp) {
    return realIp.trim();
  }
  
  return 'unknown';
}

// Create rate limit response
export function createRateLimitResponse(
  resetAt: number,
  corsHeaders: Record<string, string>
): Response {
  const retryAfter = Math.ceil((resetAt - Date.now()) / 1000);
  
  return new Response(
    JSON.stringify({ 
      success: false,
      error: 'Rate limit exceeded. Please wait before trying again.',
      retryAfter 
    }),
    { 
      status: 429, 
      headers: { 
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Retry-After': String(retryAfter)
      }
    }
  );
}
