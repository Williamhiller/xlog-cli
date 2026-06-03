// Serialization cache module for xLogger
// Caches serialized values to improve performance

const DEFAULT_CACHE_SIZE = 1000;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute

export class SerializationCache {
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

  generateKey(value, depth, options) {
    // Generate a cache key based on value type and content
    if (value === null || value === undefined) {
      return `null:${depth}`;
    }

    const type = typeof value;
    if (type === 'string' || type === 'number' || type === 'boolean') {
      return `${type}:${value}:${depth}`;
    }

    if (type === 'function') {
      return `function:${value.name || 'anonymous'}:${depth}`;
    }

    if (value instanceof Date) {
      return `date:${value.toISOString()}:${depth}`;
    }

    if (value instanceof RegExp) {
      return `regexp:${value.toString()}:${depth}`;
    }

    if (value instanceof Error) {
      return `error:${value.name}:${value.message}:${depth}`;
    }

    // For objects, use a hash of the JSON representation
    try {
      const json = JSON.stringify(value, null, 0);
      const hash = this.hashString(json);
      return `object:${hash}:${depth}`;
    } catch {
      // If JSON.stringify fails, use a unique key
      return `object:${Date.now()}:${Math.random()}:${depth}`;
    }
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

  get(value, depth, options) {
    if (!this.enabled) {
      return null;
    }

    const key = this.generateKey(value, depth, options);
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

  set(value, depth, options, serialized) {
    if (!this.enabled) {
      return;
    }

    const key = this.generateKey(value, depth, options);

    // If cache is full, evict least recently used entries
    if (this.cache.size >= this.maxSize) {
      this.evict();
    }

    this.cache.set(key, {
      value: serialized,
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

// Utility function to create a serialization cache
export function createSerializationCache(options = {}) {
  return new SerializationCache(options);
}

// Cached serialization wrapper
export function createCachedSerializer(serializer, options = {}) {
  const cache = createSerializationCache(options);

  function cachedSerialize(value, depth = 0, seen = new WeakSet(), serializeOptions = {}) {
    // Check cache first
    const cached = cache.get(value, depth, serializeOptions);
    if (cached) {
      return cached;
    }

    // Serialize value
    const serialized = serializer(value, depth, seen, serializeOptions);

    // Cache result
    cache.set(value, depth, serializeOptions, serialized);

    return serialized;
  }

  cachedSerialize.cache = cache;
  cachedSerialize.getStats = () => cache.getStats();
  cachedSerialize.clear = () => cache.clear();
  cachedSerialize.destroy = () => cache.destroy();

  return cachedSerialize;
}

// Performance monitoring for serialization
export class SerializationPerformanceMonitor {
  constructor() {
    this.metrics = {
      totalSerializations: 0,
      totalTime: 0,
      avgTime: 0,
      maxTime: 0,
      minTime: Infinity,
      cacheHits: 0,
      cacheMisses: 0
    };

    this.history = [];
    this.maxHistory = 100;
  }

  recordSerialization(duration, cached = false) {
    this.metrics.totalSerializations++;
    this.metrics.totalTime += duration;
    this.metrics.avgTime = this.metrics.totalTime / this.metrics.totalSerializations;

    if (duration > this.metrics.maxTime) {
      this.metrics.maxTime = duration;
    }

    if (duration < this.metrics.minTime) {
      this.metrics.minTime = duration;
    }

    if (cached) {
      this.metrics.cacheHits++;
    } else {
      this.metrics.cacheMisses++;
    }

    // Add to history
    this.history.push({
      timestamp: Date.now(),
      duration,
      cached
    });

    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
  }

  getMetrics() {
    return {
      ...this.metrics,
      cacheHitRate: this.metrics.cacheHits + this.metrics.cacheMisses > 0
        ? Math.round((this.metrics.cacheHits / (this.metrics.cacheHits + this.metrics.cacheMisses)) * 100)
        : 0,
      recentAvgTime: this.calculateRecentAvgTime()
    };
  }

  calculateRecentAvgTime() {
    if (this.history.length === 0) {
      return 0;
    }

    const recent = this.history.slice(-10);
    const totalTime = recent.reduce((sum, entry) => sum + entry.duration, 0);
    return totalTime / recent.length;
  }

  reset() {
    this.metrics = {
      totalSerializations: 0,
      totalTime: 0,
      avgTime: 0,
      maxTime: 0,
      minTime: Infinity,
      cacheHits: 0,
      cacheMisses: 0
    };

    this.history = [];
  }
}

// Utility function to create a serialization performance monitor
export function createSerializationPerformanceMonitor() {
  return new SerializationPerformanceMonitor();
}

// Wrapper function for monitored serialization
export function createMonitoredSerializer(serializer, options = {}) {
  const monitor = createSerializationPerformanceMonitor();
  const cache = options.cache !== false ? createSerializationCache(options.cacheOptions) : null;

  function monitoredSerialize(value, depth = 0, seen = new WeakSet(), serializeOptions = {}) {
    const startTime = performance.now();

    // Check cache if enabled
    if (cache) {
      const cached = cache.get(value, depth, serializeOptions);
      if (cached) {
        const duration = performance.now() - startTime;
        monitor.recordSerialization(duration, true);
        return cached;
      }
    }

    // Serialize value
    const serialized = serializer(value, depth, seen, serializeOptions);

    const duration = performance.now() - startTime;
    monitor.recordSerialization(duration, false);

    // Cache result if enabled
    if (cache) {
      cache.set(value, depth, serializeOptions, serialized);
    }

    return serialized;
  }

  monitoredSerialize.monitor = monitor;
  monitoredSerialize.cache = cache;
  monitoredSerialize.getMetrics = () => monitor.getMetrics();
  monitoredSerialize.getCacheStats = () => cache ? cache.getStats() : null;
  monitoredSerialize.clearCache = () => cache ? cache.clear() : null;
  monitoredSerialize.destroy = () => {
    if (cache) {
      cache.destroy();
    }
  };

  return monitoredSerialize;
}