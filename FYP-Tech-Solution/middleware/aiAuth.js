/**
 * AI Authentication Middleware
 * Verifies requests coming FROM the AI module to backend data endpoints.
 * Uses a shared secret (API key) for service-to-service authentication.
 */

/**
 * Verify that an incoming request is from the AI module
 */
function verifyAIServiceKey(req, res, next) {
  const apiKey = req.headers['x-ai-service-key'];
  const expectedKey = process.env.AI_SERVICE_SECRET;

  if (!expectedKey) {
    console.warn('[AI Auth] AI_SERVICE_SECRET not configured — allowing request in dev mode');
    return next();
  }

  if (!apiKey) {
    return res.status(401).json({ error: 'Missing AI service authentication' });
  }

  if (apiKey !== expectedKey) {
    return res.status(403).json({ error: 'Invalid AI service key' });
  }

  // Extract shop_id from header (set by AI module)
  const shopId = req.headers['x-shop-id'];
  if (shopId) {
    req.aiShopId = shopId;
  }

  next();
}

/**
 * Simple rate limiter for AI data endpoints
 * Allows 100 requests per minute per shop
 */
const rateLimitMap = new Map();

function aiRateLimit(req, res, next) {
  const shopId = req.headers['x-shop-id'] || 'default';
  const now = Date.now();
  const windowMs = 60000; // 1 minute
  const maxRequests = 100;

  if (!rateLimitMap.has(shopId)) {
    rateLimitMap.set(shopId, { count: 1, windowStart: now });
    return next();
  }

  const entry = rateLimitMap.get(shopId);

  // Reset window if expired
  if (now - entry.windowStart > windowMs) {
    entry.count = 1;
    entry.windowStart = now;
    return next();
  }

  entry.count++;

  if (entry.count > maxRequests) {
    return res.status(429).json({ error: 'Rate limit exceeded. Try again later.' });
  }

  next();
}

module.exports = { verifyAIServiceKey, aiRateLimit };
