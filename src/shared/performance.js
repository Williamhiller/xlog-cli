// Performance monitoring module for xLogger
// Collects runtime performance metrics for debugging and optimization

const PERFORMANCE_SAMPLE_INTERVAL_MS = 5000; // Sample every 5 seconds
const MAX_SAMPLES = 100; // Keep last 100 samples
const MEMORY_WARNING_THRESHOLD_MB = 50; // Warn if memory usage exceeds 50MB
const LONG_TASK_THRESHOLD_MS = 50; // Warn if task takes longer than 50ms

export class PerformanceMonitor {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.sampleInterval = options.sampleInterval || PERFORMANCE_SAMPLE_INTERVAL_MS;
    this.maxSamples = options.maxSamples || MAX_SAMPLES;
    this.onMetric = options.onMetric || null;
    this.onWarning = options.onWarning || null;

    this.samples = [];
    this.metrics = {
      memory: [],
      timing: [],
      network: [],
      errors: []
    };

    this.startTime = Date.now();
    this.lastSampleTime = 0;
    this.sampleTimer = null;

    if (this.enabled) {
      this.startMonitoring();
    }
  }

  startMonitoring() {
    // Monitor memory usage
    this.monitorMemory();

    // Monitor long tasks
    this.monitorLongTasks();

    // Monitor network performance
    this.monitorNetwork();

    // Start periodic sampling
    this.startSampling();
  }

  stopMonitoring() {
    if (this.sampleTimer) {
      clearInterval(this.sampleTimer);
      this.sampleTimer = null;
    }
  }

  monitorMemory() {
    if (typeof performance === 'undefined' || !performance.memory) {
      return;
    }

    const checkMemory = () => {
      const memory = performance.memory;
      const usedMB = memory.usedJSHeapSize / 1024 / 1024;
      const totalMB = memory.totalJSHeapSize / 1024 / 1024;
      const limitMB = memory.jsHeapSizeLimit / 1024 / 1024;

      const sample = {
        timestamp: Date.now(),
        usedMB: Math.round(usedMB * 100) / 100,
        totalMB: Math.round(totalMB * 100) / 100,
        limitMB: Math.round(limitMB * 100) / 100,
        usagePercent: Math.round((usedMB / limitMB) * 100)
      };

      this.metrics.memory.push(sample);
      if (this.metrics.memory.length > this.maxSamples) {
        this.metrics.memory.shift();
      }

      // Check for memory warnings
      if (usedMB > MEMORY_WARNING_THRESHOLD_MB) {
        this.emitWarning('memory', {
          message: `High memory usage: ${usedMB.toFixed(1)}MB`,
          threshold: MEMORY_WARNING_THRESHOLD_MB,
          current: usedMB
        });
      }

      return sample;
    };

    // Initial sample
    checkMemory();

    // Periodic sampling
    setInterval(checkMemory, this.sampleInterval);
  }

  monitorLongTasks() {
    if (typeof PerformanceObserver === 'undefined') {
      return;
    }

    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration > LONG_TASK_THRESHOLD_MS) {
            const sample = {
              timestamp: Date.now(),
              duration: entry.duration,
              startTime: entry.startTime,
              name: entry.name
            };

            this.metrics.timing.push(sample);
            if (this.metrics.timing.length > this.maxSamples) {
              this.metrics.timing.shift();
            }

            this.emitWarning('longTask', {
              message: `Long task detected: ${entry.duration.toFixed(1)}ms`,
              threshold: LONG_TASK_THRESHOLD_MS,
              current: entry.duration,
              entry: sample
            });
          }
        }
      });

      observer.observe({ entryTypes: ['longtask'] });
    } catch {
      // PerformanceObserver not supported for longtask
    }
  }

  monitorNetwork() {
    if (typeof PerformanceObserver === 'undefined') {
      return;
    }

    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.initiatorType === 'fetch' || entry.initiatorType === 'xmlhttprequest') {
            const sample = {
              timestamp: Date.now(),
              name: entry.name,
              duration: entry.duration,
              transferSize: entry.transferSize,
              encodedBodySize: entry.encodedBodySize,
              decodedBodySize: entry.decodedBodySize,
              initiatorType: entry.initiatorType
            };

            this.metrics.network.push(sample);
            if (this.metrics.network.length > this.maxSamples) {
              this.metrics.network.shift();
            }

            // Emit metric
            this.emitMetric('network', sample);
          }
        }
      });

      observer.observe({ entryTypes: ['resource'] });
    } catch {
      // PerformanceObserver not supported for resource
    }
  }

  startSampling() {
    this.sampleTimer = setInterval(() => {
      this.collectSamples();
    }, this.sampleInterval);
  }

  collectSamples() {
    const now = Date.now();
    if (now - this.lastSampleTime < this.sampleInterval) {
      return;
    }

    this.lastSampleTime = now;

    // Collect memory sample
    if (typeof performance !== 'undefined' && performance.memory) {
      const memory = performance.memory;
      const sample = {
        timestamp: now,
        usedMB: Math.round((memory.usedJSHeapSize / 1024 / 1024) * 100) / 100,
        totalMB: Math.round((memory.totalJSHeapSize / 1024 / 1024) * 100) / 100,
        limitMB: Math.round((memory.jsHeapSizeLimit / 1024 / 1024) * 100) / 100
      };

      this.samples.push(sample);
      if (this.samples.length > this.maxSamples) {
        this.samples.shift();
      }
    }

    // Collect timing sample
    if (typeof performance !== 'undefined' && performance.timing) {
      const timing = performance.timing;
      const sample = {
        timestamp: now,
        loadTime: timing.loadEventEnd - timing.navigationStart,
        domReady: timing.domContentLoadedEventEnd - timing.navigationStart,
        firstPaint: timing.responseEnd - timing.requestStart
      };

      this.metrics.timing.push(sample);
      if (this.metrics.timing.length > this.maxSamples) {
        this.metrics.timing.shift();
      }
    }
  }

  emitMetric(type, data) {
    if (this.onMetric) {
      this.onMetric(type, data);
    }
  }

  emitWarning(type, data) {
    if (this.onWarning) {
      this.onWarning(type, data);
    }
  }

  getMetrics() {
    return {
      uptime: Date.now() - this.startTime,
      samples: this.samples.length,
      memory: this.metrics.memory.slice(-10), // Last 10 samples
      timing: this.metrics.timing.slice(-10),
      network: this.metrics.network.slice(-10),
      errors: this.metrics.errors.slice(-10)
    };
  }

  getMemoryUsage() {
    if (typeof performance === 'undefined' || !performance.memory) {
      return null;
    }

    const memory = performance.memory;
    return {
      usedMB: Math.round((memory.usedJSHeapSize / 1024 / 1024) * 100) / 100,
      totalMB: Math.round((memory.totalJSHeapSize / 1024 / 1024) * 100) / 100,
      limitMB: Math.round((memory.jsHeapSizeLimit / 1024 / 1024) * 100) / 100,
      usagePercent: Math.round((memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100)
    };
  }

  getNetworkStats() {
    const network = this.metrics.network;
    if (!network.length) {
      return null;
    }

    const durations = network.map(n => n.duration);
    const sizes = network.map(n => n.transferSize || 0);

    return {
      requests: network.length,
      avgDuration: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
      maxDuration: Math.round(Math.max(...durations)),
      totalTransfer: sizes.reduce((a, b) => a + b, 0),
      avgTransferSize: Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length)
    };
  }

  getTimingStats() {
    const timing = this.metrics.timing;
    if (!timing.length) {
      return null;
    }

    const durations = timing.map(t => t.duration);
    return {
      samples: timing.length,
      avgDuration: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
      maxDuration: Math.round(Math.max(...durations)),
      longTasks: timing.filter(t => t.duration > LONG_TASK_THRESHOLD_MS).length
    };
  }

  reset() {
    this.samples = [];
    this.metrics = {
      memory: [],
      timing: [],
      network: [],
      errors: []
    };
    this.startTime = Date.now();
  }
}

// Utility function to create a performance monitor
export function createPerformanceMonitor(options = {}) {
  return new PerformanceMonitor(options);
}

// Utility function to collect current performance metrics
export function collectCurrentMetrics() {
  const metrics = {
    timestamp: Date.now(),
    memory: null,
    timing: null,
    navigation: null
  };

  // Memory metrics
  if (typeof performance !== 'undefined' && performance.memory) {
    const memory = performance.memory;
    metrics.memory = {
      usedMB: Math.round((memory.usedJSHeapSize / 1024 / 1024) * 100) / 100,
      totalMB: Math.round((memory.totalJSHeapSize / 1024 / 1024) * 100) / 100,
      limitMB: Math.round((memory.jsHeapSizeLimit / 1024 / 1024) * 100) / 100
    };
  }

  // Timing metrics
  if (typeof performance !== 'undefined' && performance.timing) {
    const timing = performance.timing;
    metrics.timing = {
      loadTime: timing.loadEventEnd - timing.navigationStart,
      domReady: timing.domContentLoadedEventEnd - timing.navigationStart,
      firstPaint: timing.responseEnd - timing.requestStart
    };
  }

  // Navigation metrics
  if (typeof performance !== 'undefined' && performance.navigation) {
    const navigation = performance.navigation;
    metrics.navigation = {
      type: navigation.type,
      redirectCount: navigation.redirectCount
    };
  }

  return metrics;
}

// Utility function to format performance metrics for logging
export function formatMetricsForLogging(metrics) {
  const parts = [];

  if (metrics.memory) {
    parts.push(`Memory: ${metrics.memory.usedMB}MB / ${metrics.memory.limitMB}MB`);
  }

  if (metrics.timing) {
    parts.push(`Load: ${metrics.timing.loadTime}ms, DOM: ${metrics.timing.domReady}ms`);
  }

  if (metrics.network) {
    parts.push(`Network: ${metrics.network.requests} requests, avg ${metrics.network.avgDuration}ms`);
  }

  return parts.join(' | ');
}