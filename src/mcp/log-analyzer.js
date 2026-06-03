// Log analyzer module for xLogger MCP server
// Provides advanced log analysis capabilities for AI debugging

const PATTERN_DETECTION_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const ANOMALY_DETECTION_THRESHOLD = 2; // Standard deviations
const TREND_ANALYSIS_MIN_SAMPLES = 5;

export class LogAnalyzer {
  constructor(options = {}) {
    this.patternWindowMs = options.patternWindowMs || PATTERN_DETECTION_WINDOW_MS;
    this.anomalyThreshold = options.anomalyThreshold || ANOMALY_DETECTION_THRESHOLD;
    this.trendMinSamples = options.trendMinSamples || TREND_ANALYSIS_MIN_SAMPLES;

    this.patterns = new Map();
    this.anomalies = [];
    this.trends = new Map();
  }

  // Pattern detection
  detectPatterns(logs) {
    if (!logs || logs.length === 0) {
      return [];
    }

    const patterns = [];
    const now = Date.now();
    const windowStart = now - this.patternWindowMs;

    // Group logs by time windows
    const timeWindows = new Map();
    for (const log of logs) {
      const timestamp = log.occurredAtMs || new Date(log.occurredAt).getTime();
      if (timestamp < windowStart) continue;

      const windowKey = Math.floor(timestamp / 1000); // 1-second windows
      if (!timeWindows.has(windowKey)) {
        timeWindows.set(windowKey, []);
      }
      timeWindows.get(windowKey).push(log);
    }

    // Detect error bursts
    for (const [windowKey, windowLogs] of timeWindows) {
      const errorCount = windowLogs.filter(l => l.level === 'error').length;
      if (errorCount > 3) {
        patterns.push({
          type: 'error_burst',
          timestamp: new Date(windowKey * 1000).toISOString(),
          count: errorCount,
          logs: windowLogs.filter(l => l.level === 'error').slice(0, 5)
        });
      }
    }

    // Detect repeated errors
    const errorGroups = new Map();
    for (const log of logs) {
      if (log.level !== 'error') continue;

      const key = `${log.text || ''}|${log.callsite?.file || ''}|${log.callsite?.line || ''}`;
      if (!errorGroups.has(key)) {
        errorGroups.set(key, {
          count: 0,
          firstOccurrence: log.occurredAt,
          lastOccurrence: log.occurredAt,
          samples: []
        });
      }

      const group = errorGroups.get(key);
      group.count++;
      group.lastOccurrence = log.occurredAt;
      if (group.samples.length < 3) {
        group.samples.push(log);
      }
    }

    for (const [key, group] of errorGroups) {
      if (group.count > 1) {
        patterns.push({
          type: 'repeated_error',
          key,
          count: group.count,
          firstOccurrence: group.firstOccurrence,
          lastOccurrence: group.lastOccurrence,
          samples: group.samples
        });
      }
    }

    // Detect console.error patterns
    const consoleErrors = logs.filter(l => l.kind === 'console' && l.level === 'error');
    if (consoleErrors.length > 0) {
      patterns.push({
        type: 'console_errors',
        count: consoleErrors.length,
        samples: consoleErrors.slice(0, 5)
      });
    }

    // Detect network failures
    const networkFailures = logs.filter(l => l.extra?.networkFailures?.length > 0);
    if (networkFailures.length > 0) {
      patterns.push({
        type: 'network_failures',
        count: networkFailures.length,
        samples: networkFailures.slice(0, 5)
      });
    }

    return patterns;
  }

  // Anomaly detection
  detectAnomalies(logs) {
    if (!logs || logs.length < this.trendMinSamples) {
      return [];
    }

    const anomalies = [];

    // Calculate baseline metrics
    const metrics = this.calculateMetrics(logs);

    // Detect anomalies in error rate
    if (metrics.errorRate > metrics.avgErrorRate + this.anomalyThreshold * metrics.errorRateStdDev) {
      anomalies.push({
        type: 'high_error_rate',
        current: metrics.errorRate,
        baseline: metrics.avgErrorRate,
        threshold: metrics.avgErrorRate + this.anomalyThreshold * metrics.errorRateStdDev,
        severity: 'high'
      });
    }

    // Detect anomalies in log volume
    if (metrics.logVolume > metrics.avgLogVolume + this.anomalyThreshold * metrics.logVolumeStdDev) {
      anomalies.push({
        type: 'high_log_volume',
        current: metrics.logVolume,
        baseline: metrics.avgLogVolume,
        threshold: metrics.avgLogVolume + this.anomalyThreshold * metrics.logVolumeStdDev,
        severity: 'medium'
      });
    }

    // Detect anomalies in error types
    const errorTypes = this.categorizeErrors(logs);
    for (const [type, count] of errorTypes) {
      if (count > metrics.avgErrorTypeCount + this.anomalyThreshold * metrics.errorTypeStdDev) {
        anomalies.push({
          type: 'error_type_spike',
          errorType: type,
          current: count,
          baseline: metrics.avgErrorTypeCount,
          threshold: metrics.avgErrorTypeCount + this.anomalyThreshold * metrics.errorTypeStdDev,
          severity: 'medium'
        });
      }
    }

    return anomalies;
  }

  // Trend analysis
  analyzeTrends(logs) {
    if (!logs || logs.length < this.trendMinSamples) {
      return {};
    }

    const trends = {};

    // Group logs by time intervals (1 minute)
    const timeIntervals = new Map();
    for (const log of logs) {
      const timestamp = log.occurredAtMs || new Date(log.occurredAt).getTime();
      const intervalKey = Math.floor(timestamp / 60000); // 1-minute intervals

      if (!timeIntervals.has(intervalKey)) {
        timeIntervals.set(intervalKey, {
          total: 0,
          errors: 0,
          warnings: 0
        });
      }

      const interval = timeIntervals.get(intervalKey);
      interval.total++;
      if (log.level === 'error') interval.errors++;
      if (log.level === 'warn') interval.warnings++;
    }

    // Calculate trends
    const intervals = Array.from(timeIntervals.entries()).sort((a, b) => a[0] - b[0]);

    if (intervals.length >= 2) {
      const firstInterval = intervals[0][1];
      const lastInterval = intervals[intervals.length - 1][1];

      trends.errorRate = {
        start: firstInterval.errors / firstInterval.total,
        end: lastInterval.errors / lastInterval.total,
        change: (lastInterval.errors / lastInterval.total) - (firstInterval.errors / firstInterval.total),
        direction: lastInterval.errors > firstInterval.errors ? 'increasing' : 'decreasing'
      };

      trends.logVolume = {
        start: firstInterval.total,
        end: lastInterval.total,
        change: lastInterval.total - firstInterval.total,
        direction: lastInterval.total > firstInterval.total ? 'increasing' : 'decreasing'
      };
    }

    // Detect emerging patterns
    const recentLogs = logs.slice(-20);
    const recentPatterns = this.detectPatterns(recentLogs);
    if (recentPatterns.length > 0) {
      trends.emergingPatterns = recentPatterns;
    }

    return trends;
  }

  // Helper methods
  calculateMetrics(logs) {
    const now = Date.now();
    const windowStart = now - this.patternWindowMs;

    // Filter logs within window
    const windowLogs = logs.filter(log => {
      const timestamp = log.occurredAtMs || new Date(log.occurredAt).getTime();
      return timestamp >= windowStart;
    });

    // Calculate error rate
    const errorCount = windowLogs.filter(l => l.level === 'error').length;
    const errorRate = windowLogs.length > 0 ? errorCount / windowLogs.length : 0;

    // Calculate log volume
    const logVolume = windowLogs.length;

    // Calculate error types
    const errorTypes = this.categorizeErrors(windowLogs);
    const errorTypeCount = errorTypes.size;

    // Calculate standard deviations (simplified)
    const errorRateStdDev = Math.sqrt(errorRate * (1 - errorRate));
    const logVolumeStdDev = Math.sqrt(logVolume);
    const errorTypeStdDev = Math.sqrt(errorTypeCount);

    return {
      errorRate,
      avgErrorRate: errorRate, // Simplified - in real implementation, use historical data
      errorRateStdDev,
      logVolume,
      avgLogVolume: logVolume, // Simplified
      logVolumeStdDev,
      errorTypeCount,
      avgErrorTypeCount: errorTypeCount, // Simplified
      errorTypeStdDev
    };
  }

  categorizeErrors(logs) {
    const categories = new Map();

    for (const log of logs) {
      if (log.level !== 'error') continue;

      let category = 'unknown';
      const text = log.text || '';

      if (text.includes('TypeError')) category = 'type_error';
      else if (text.includes('ReferenceError')) category = 'reference_error';
      else if (text.includes('SyntaxError')) category = 'syntax_error';
      else if (text.includes('Network')) category = 'network_error';
      else if (text.includes('Timeout')) category = 'timeout_error';
      else if (text.includes('Permission')) category = 'permission_error';
      else if (log.kind === 'unhandledrejection') category = 'unhandled_rejection';
      else if (log.kind === 'window.error') category = 'window_error';

      categories.set(category, (categories.get(category) || 0) + 1);
    }

    return categories;
  }

  // Generate insights for AI
  generateInsights(logs) {
    const insights = [];

    // Detect patterns
    const patterns = this.detectPatterns(logs);
    if (patterns.length > 0) {
      insights.push({
        type: 'patterns',
        description: `Detected ${patterns.length} patterns in logs`,
        patterns: patterns.slice(0, 5),
        severity: patterns.some(p => p.type === 'error_burst') ? 'high' : 'medium'
      });
    }

    // Detect anomalies
    const anomalies = this.detectAnomalies(logs);
    if (anomalies.length > 0) {
      insights.push({
        type: 'anomalies',
        description: `Detected ${anomalies.length} anomalies`,
        anomalies: anomalies.slice(0, 5),
        severity: anomalies.some(a => a.severity === 'high') ? 'high' : 'medium'
      });
    }

    // Analyze trends
    const trends = this.analyzeTrends(logs);
    if (Object.keys(trends).length > 0) {
      insights.push({
        type: 'trends',
        description: 'Detected trends in log data',
        trends,
        severity: 'low'
      });
    }

    // Generate recommendations
    const recommendations = this.generateRecommendations(logs, patterns, anomalies, trends);
    if (recommendations.length > 0) {
      insights.push({
        type: 'recommendations',
        description: 'Generated recommendations based on analysis',
        recommendations,
        severity: 'low'
      });
    }

    return insights;
  }

  generateRecommendations(logs, patterns, anomalies, trends) {
    const recommendations = [];

    // Check for error bursts
    const errorBursts = patterns.filter(p => p.type === 'error_burst');
    if (errorBursts.length > 0) {
      recommendations.push({
        type: 'error_burst',
        description: 'Multiple errors occurred in a short time window',
        action: 'Investigate the root cause of error bursts',
        priority: 'high'
      });
    }

    // Check for repeated errors
    const repeatedErrors = patterns.filter(p => p.type === 'repeated_error');
    if (repeatedErrors.length > 0) {
      recommendations.push({
        type: 'repeated_error',
        description: 'Same error occurred multiple times',
        action: 'Fix the underlying issue causing repeated errors',
        priority: 'high'
      });
    }

    // Check for network failures
    const networkFailures = patterns.filter(p => p.type === 'network_failures');
    if (networkFailures.length > 0) {
      recommendations.push({
        type: 'network_failure',
        description: 'Network requests are failing',
        action: 'Check network connectivity and API endpoints',
        priority: 'medium'
      });
    }

    // Check for high error rate
    const highErrorRate = anomalies.filter(a => a.type === 'high_error_rate');
    if (highErrorRate.length > 0) {
      recommendations.push({
        type: 'high_error_rate',
        description: 'Error rate is unusually high',
        action: 'Investigate recent changes that may have introduced errors',
        priority: 'high'
      });
    }

    // Check for increasing error trend
    if (trends.errorRate?.direction === 'increasing') {
      recommendations.push({
        type: 'increasing_errors',
        description: 'Error rate is increasing over time',
        action: 'Monitor and investigate the cause of increasing errors',
        priority: 'medium'
      });
    }

    return recommendations;
  }

  // Utility methods
  reset() {
    this.patterns.clear();
    this.anomalies = [];
    this.trends.clear();
  }

  getStats() {
    return {
      patterns: this.patterns.size,
      anomalies: this.anomalies.length,
      trends: this.trends.size
    };
  }
}

// Utility function to create a log analyzer
export function createLogAnalyzer(options = {}) {
  return new LogAnalyzer(options);
}

// Utility function to analyze logs and generate insights
export function analyzeLogsForInsights(logs, options = {}) {
  const analyzer = createLogAnalyzer(options);
  return analyzer.generateInsights(logs);
}

// Utility function to detect patterns in logs
export function detectLogPatterns(logs, options = {}) {
  const analyzer = createLogAnalyzer(options);
  return analyzer.detectPatterns(logs);
}

// Utility function to detect anomalies in logs
export function detectLogAnomalies(logs, options = {}) {
  const analyzer = createLogAnalyzer(options);
  return analyzer.detectAnomalies(logs);
}

// Utility function to analyze trends in logs
export function analyzeLogTrends(logs, options = {}) {
  const analyzer = createLogAnalyzer(options);
  return analyzer.analyzeTrends(logs);
}

// Utility function to generate recommendations
export function generateLogRecommendations(logs, options = {}) {
  const analyzer = createLogAnalyzer(options);
  const patterns = analyzer.detectPatterns(logs);
  const anomalies = analyzer.detectAnomalies(logs);
  const trends = analyzer.analyzeTrends(logs);
  return analyzer.generateRecommendations(logs, patterns, anomalies, trends);
}