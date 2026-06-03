// Request cache module for xLogger server
// Caches API responses to improve performance

const DEFAULT_CACHE_SIZE = 100;
const DEFAULT_CACHE_TTL_MS = 30 * 1000; // 30 seconds
const CACHE_CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute

export class RequestCache {
  constructor(options = {}) {
    this.maxSize = options.maxSize || DEFAULT_CACHE_SIZE;
    this.ttlMs = options.ttlMs || DEFAULT_CACHE_TTL_MS;
    this.enabled = options.enabled !== false;

    this.cache = new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      size: 0
    };

    this.cleanupTimer = null;

    if (this.enabled) {
      this.startCleanup();
    }
  }

  startCleanup() {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, CACHE_CLEANUP_INTERVAL_MS);
  }

  stopCleanup() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  generateKey(url, method, body) {
    // Generate a cache key based on request URL, method, and body
    const parts = [method, url];

    if (body) {
      try {
        const bodyHash = this.hashString(JSON.stringify(body));
        parts.push(bodyHash);
      } catch {
        // If body can't be serialized, use a unique key
        parts.push(Date.now().toString());
      }
    }

    return parts.join(':');
  }

  hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
  }

  get(url, method, body) {
    if (!this.enabled) {
      return null;
    }

    const key = this.generateKey(url, method, body);
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    // Check if entry has expired
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      this.stats.misses++;
      return null;
    }

    this.stats.hits++;
    entry.lastAccessed = Date.now();
    return entry.value;
  }

  set(url, method, body, response) {
    if (!this.enabled) {
      return;
    }

    const key = this.generateKey(url, method, body);

    // If cache is full, evict least recently used entries
    if (this.cache.size >= this.maxSize) {
      this.evict();
    }

    this.cache.set(key, {
      value: response,
      timestamp: Date.now(),
      lastAccessed: Date.now()
    });

    this.stats.size = this.cache.size;
  }

  evict() {
    if (this.cache.size === 0) {
      return;
    }

    // Find least recently used entry
    let oldestKey = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.stats.evictions++;
      this.stats.size = this.cache.size;
    }
  }

  cleanup() {
    const now = Date.now();
    const keysToDelete = [];

    for (const [key, entry] of this.cache) {
      if (now - entry.timestamp > this.ttlMs) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
    }

    this.stats.size = this.cache.size;
  }

  clear() {
    this.cache.clear();
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      size: 0
    };
  }

  getStats() {
    return {
      ...this.stats,
      hitRate: this.stats.hits + this.stats.misses > 0
        ? Math.round((this.stats.hits / (this.stats.hits + this.stats.misses)) * 100)
        : 0,
      maxSize: this.maxSize,
      ttlMs: this.ttlMs
    };
  }

  resize(newSize) {
    this.maxSize = newSize;

    // If cache is now too large, evict entries
    while (this.cache.size > this.maxSize) {
      this.evict();
    }
  }

  destroy() {
    this.stopCleanup();
    this.clear();
  }
}

// Rate limiter module for xLogger server
// Limits request rate to prevent abuse

const DEFAULT_RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 100; // 100 requests per window

export class RateLimiter {
  constructor(options = {}) {
    this.windowMs = options.windowMs || DEFAULT_RATE_LIMIT_WINDOW_MS;
    this.maxRequests = options.maxRequests || DEFAULT_RATE_LIMIT_MAX_REQUESTS;
    this.enabled = options.enabled !== false;

    this.clients = new Map();
    this.stats = {
      totalRequests: 0,
      rejectedRequests: 0,
      activeClients: 0
    };

    this.cleanupTimer = null;

    if (this.enabled) {
      this.startCleanup();
    }
  }

  startCleanup() {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.windowMs);
  }

  stopCleanup() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  getClientId(req) {
    // Use IP address as client identifier
    return req.socket.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
  }

  isAllowed(req) {
    if (!this.enabled) {
      return true;
    }

    const clientId = this.getClientId(req);
    const now = Date.now();

    if (!this.clients.has(clientId)) {
      this.clients.set(clientId, {
        requests: [],
        firstRequest: now
      });
    }

    const client = this.clients.get(clientId);

    // Remove expired requests
    client.requests = client.requests.filter(timestamp => now - timestamp < this.windowMs);

    // Check if limit is exceeded
    if (client.requests.length >= this.maxRequests) {
      this.stats.rejectedRequests++;
      return false;
    }

    // Add current request
    client.requests.push(now);
    this.stats.totalRequests++;

    return true;
  }

  cleanup() {
    const now = Date.now();
    const clientsToDelete = [];

    for (const [clientId, client] of this.clients) {
      // Remove expired requests
      client.requests = client.requests.filter(timestamp => now - timestamp < this.windowMs);

      // Remove clients with no recent requests
      if (client.requests.length === 0) {
        clientsToDelete.push(clientId);
      }
    }

    for (const clientId of clientsToDelete) {
      this.clients.delete(clientId);
    }

    this.stats.activeClients = this.clients.size;
  }

  getStats() {
    return {
      ...this.stats,
      activeClients: this.clients.size,
      windowMs: this.windowMs,
      maxRequests: this.maxRequests
    };
  }

  reset() {
    this.clients.clear();
    this.stats = {
      totalRequests: 0,
      rejectedRequests: 0,
      activeClients: 0
    };
  }

  destroy() {
    this.stopCleanup();
    this.reset();
  }
}

// JSON parser optimization
const JSON_PARSE_CACHE_SIZE = 50;
const JSON_PARSE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export class JsonParserCache {
  constructor(options = {}) {
    this.maxSize = options.maxSize || JSON_PARSE_CACHE_SIZE;
    this.ttlMs = options.ttlMs || JSON_PARSE_CACHE_TTL_MS;
    this.enabled = options.enabled !== false;

    this.cache = new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      size: 0
    };

    this.cleanupTimer = null;

    if (this.enabled) {
      this.startCleanup();
    }
  }

  startCleanup() {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, 60 * 1000); // Cleanup every minute
  }

  stopCleanup() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  generateKey(jsonString) {
    // Generate a cache key based on JSON string hash
    return this.hashString(jsonString);
  }

  hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
  }

  parse(jsonString) {
    if (!this.enabled) {
      return JSON.parse(jsonString);
    }

    const key = this.generateKey(jsonString);
    const entry = this.cache.get(key);

    if (entry) {
      // Check if entry has expired
      if (Date.now() - entry.timestamp > this.ttlMs) {
        this.cache.delete(key);
        this.stats.misses++;
      } else {
        this.stats.hits++;
        entry.lastAccessed = Date.now();
        return entry.value;
      }
    } else {
      this.stats.misses++;
    }

    // Parse JSON
    const parsed = JSON.parse(jsonString);

    // Cache result
    if (this.cache.size >= this.maxSize) {
      this.evict();
    }

    this.cache.set(key, {
      value: parsed,
      timestamp: Date.now(),
      lastAccessed: Date.now()
    });

    this.stats.size = this.cache.size;

    return parsed;
  }

  evict() {
    if (this.cache.size === 0) {
      return;
    }

    // Find least recently used entry
    let oldestKey = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.stats.evictions++;
      this.stats.size = this.cache.size;
    }
  }

  cleanup() {
    const now = Date.now();
    const keysToDelete = [];

    for (const [key, entry] of this.cache) {
      if (now - entry.timestamp > this.ttlMs) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
    }

    this.stats.size = this.cache.size;
  }

  clear() {
    this.cache.clear();
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      size: 0
    };
  }

  getStats() {
    return {
      ...this.stats,
      hitRate: this.stats.hits + this.stats.misses > 0
        ? Math.round((this.stats.hits / (this.stats.hits + this.stats.misses)) * 100)
        : 0,
      maxSize: this.maxSize,
      ttlMs: this.ttlMs
    };
  }

  destroy() {
    this.stopCleanup();
    this.clear();
  }
}

// Utility functions
export function createRequestCache(options = {}) {
  return new RequestCache(options);
}

export function createRateLimiter(options = {}) {
  return new RateLimiter(options);
}

export function createJsonParserCache(options = {}) {
  return new JsonParserCache(options);
}

// Request middleware factory
export function createRequestMiddleware(options = {}) {
  const cache = createRequestCache(options.cache);
  const rateLimiter = createRateLimiter(options.rateLimit);
  const jsonParser = createJsonParserCache(options.jsonParser);

  return {
    cache,
    rateLimiter,
    jsonParser,

    // Middleware function for Express/Node.js HTTP server
    middleware(req, res, next) {
      // Check rate limit
      if (!rateLimiter.isAllowed(req)) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Too many requests' }));
        return;
      }

      // Check cache for GET requests
      if (req.method === 'GET') {
        const cached = cache.get(req.url, req.method);
        if (cached) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(cached));
          return;
        }
      }

      // Continue to next middleware
      if (next) {
        next();
      }
    },

    // Cache response helper
    cacheResponse(url, method, body, response) {
      if (method === 'GET') {
        cache.set(url, method, body, response);
      }
    },

    // Parse JSON with cache
    parseJson(jsonString) {
      return jsonParser.parse(jsonString);
    },

    // Get stats
    getStats() {
      return {
        cache: cache.getStats(),
        rateLimiter: rateLimiter.getStats(),
        jsonParser: jsonParser.getStats()
      };
    },

    // Cleanup
    destroy() {
      cache.destroy();
      rateLimiter.destroy();
      jsonParser.destroy();
    }
  };
}