import type { PerformanceContext } from "./types";
import { StructuredLogger } from "./structured-logger";

export class PerformanceLogger {
  private timers: Map<string, number> = new Map();
  private performanceObservers: PerformanceObserver[] = [];

  constructor(private structuredLogger: StructuredLogger) {
    this.initializePerformanceObservers();
  }

  private initializePerformanceObservers(): void {
    if (typeof window === "undefined" || !window.PerformanceObserver) {
      return;
    }

    // Observe navigation timing
    try {
      const navObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        entries.forEach((entry) => {
          if (entry.entryType === "navigation") {
            this.logNavigationPerformance(entry as PerformanceNavigationTiming);
          }
        });
      });
      navObserver.observe({ entryTypes: ["navigation"] });
      this.performanceObservers.push(navObserver);
    } catch (error) {
      this.structuredLogger.warn("Failed to initialize navigation observer", {
        error: (error as Error).message,
      });
    }

    // Observe resource timing
    try {
      const resourceObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        entries.forEach((entry) => {
          if (entry.entryType === "resource") {
            this.logResourcePerformance(entry as PerformanceResourceTiming);
          }
        });
      });
      resourceObserver.observe({ entryTypes: ["resource"] });
      this.performanceObservers.push(resourceObserver);
    } catch (error) {
      this.structuredLogger.warn("Failed to initialize resource observer", {
        error: (error as Error).message,
      });
    }

    // Observe paint timing
    try {
      const paintObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        entries.forEach((entry) => {
          if (entry.entryType === "paint") {
            this.logPaintPerformance(entry as PerformancePaintTiming);
          }
        });
      });
      paintObserver.observe({ entryTypes: ["paint"] });
      this.performanceObservers.push(paintObserver);
    } catch (error) {
      this.structuredLogger.warn("Failed to initialize paint observer", {
        error: (error as Error).message,
      });
    }

    // Observe long tasks
    try {
      const longTaskObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        entries.forEach((entry) => {
          if (entry.entryType === "longtask") {
            this.logLongTask(entry as PerformanceEntry);
          }
        });
      });
      longTaskObserver.observe({ entryTypes: ["longtask"] });
      this.performanceObservers.push(longTaskObserver);
    } catch (error) {
      this.structuredLogger.warn("Failed to initialize long task observer", {
        error: (error as Error).message,
      });
    }
  }

  logMetric(
    operation: string,
    duration: number,
    context?: Record<string, any>
  ): void {
    const performanceContext: PerformanceContext = {
      operation,
      duration,
      startTime: Date.now() - duration,
      endTime: Date.now(),
      type: "custom",
      metadata: context,
    };

    this.structuredLogger.info(`Performance: ${operation}`, {
      category: "performance",
      ...performanceContext,
      userId: this.structuredLogger.getContext("userId"),
      sessionId: this.structuredLogger.getContext("sessionId"),
    });

    // Log warning for slow operations
    if (duration > this.getThreshold(operation)) {
      this.structuredLogger.warn(`Slow operation detected: ${operation}`, {
        category: "performance_warning",
        operation,
        duration,
        threshold: this.getThreshold(operation),
        ...context,
      });
    }
  }

  startTimer(operation: string): () => void {
    const startTime = performance.now();
    this.timers.set(operation, startTime);

    return () => {
      const endTime = performance.now();
      const duration = endTime - startTime;
      this.timers.delete(operation);
      this.logMetric(operation, duration);
    };
  }

  logPageLoad(context?: Record<string, any>): void {
    if (
      typeof window === "undefined" ||
      !window.performance ||
      !window.performance.timing
    ) {
      return;
    }

    const timing = window.performance.timing;
    const navigationStart = timing.navigationStart;
    const loadEventEnd = timing.loadEventEnd;

    if (loadEventEnd === 0) {
      // Page not fully loaded yet
      return;
    }

    const pageLoadTime = loadEventEnd - navigationStart;
    const domContentLoaded = timing.domContentLoadedEventEnd - navigationStart;
    const firstByte = timing.responseStart - navigationStart;

    this.structuredLogger.info("Page load metrics", {
      category: "performance",
      operation: "page_load",
      duration: pageLoadTime,
      type: "navigation",
      metadata: {
        domContentLoaded,
        firstByte,
        dnsLookup: timing.domainLookupEnd - timing.domainLookupStart,
        tcpConnect: timing.connectEnd - timing.connectStart,
        request: timing.responseStart - timing.requestStart,
        response: timing.responseEnd - timing.responseStart,
        domProcessing: timing.domComplete - timing.domLoading,
        ...context,
      },
      userId: this.structuredLogger.getContext("userId"),
      sessionId: this.structuredLogger.getContext("sessionId"),
    });
  }

  logResourceLoad(resource: string, duration: number, size?: number): void {
    this.structuredLogger.debug(`Resource loaded: ${resource}`, {
      category: "performance",
      operation: "resource_load",
      duration,
      type: "resource",
      metadata: {
        resource,
        size,
      },
    });
  }

  logMemoryUsage(): void {
    if (
      typeof window === "undefined" ||
      !(window as any).performance ||
      !(window as any).performance.memory
    ) {
      return;
    }

    const memory = (window as any).performance.memory;

    this.structuredLogger.debug("Memory usage", {
      category: "performance",
      operation: "memory_usage",
      type: "custom",
      metadata: {
        usedJSHeapSize: memory.usedJSHeapSize,
        totalJSHeapSize: memory.totalJSHeapSize,
        jsHeapSizeLimit: memory.jsHeapSizeLimit,
        usedPercentage:
          ((memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100).toFixed(2) +
          "%",
      },
    });
  }

  logNetworkPerformance(context?: Record<string, any>): void {
    if (
      typeof window === "undefined" ||
      !(window as any).performance ||
      !(window as any).performance.getEntriesByType
    ) {
      return;
    }

    const resources = (window as any).performance.getEntriesByType(
      "resource"
    ) as PerformanceResourceTiming[];
    const networkResources = resources.filter(
      (resource) =>
        resource.initiatorType === "xmlhttprequest" ||
        resource.initiatorType === "fetch" ||
        resource.initiatorType === "script" ||
        resource.initiatorType === "stylesheet"
    );

    if (networkResources.length === 0) {
      return;
    }

    const totalSize = networkResources.reduce(
      (sum, resource) => sum + (resource.transferSize || 0),
      0
    );
    const totalTime = networkResources.reduce(
      (sum, resource) => sum + resource.duration,
      0
    );
    const averageTime = totalTime / networkResources.length;

    this.structuredLogger.info("Network performance summary", {
      category: "performance",
      operation: "network_summary",
      duration: averageTime,
      type: "custom",
      metadata: {
        resourceCount: networkResources.length,
        totalSize,
        totalTime,
        averageTime,
        ...context,
      },
    });
  }

  private logNavigationPerformance(entry: PerformanceNavigationTiming): void {
    const metrics = {
      dnsLookup: entry.domainLookupEnd - entry.domainLookupStart,
      tcpConnect: entry.connectEnd - entry.connectStart,
      request: entry.responseStart - entry.requestStart,
      response: entry.responseEnd - entry.responseStart,
      domProcessing: entry.domComplete - entry.fetchStart,
      domContentLoaded: entry.domContentLoadedEventEnd - entry.fetchStart,
      pageLoad: entry.loadEventEnd - entry.fetchStart,
    };

    this.structuredLogger.info("Navigation performance", {
      category: "performance",
      operation: "navigation",
      duration: entry.loadEventEnd - entry.fetchStart,
      type: "navigation",
      metadata: metrics,
    });
  }

  private logResourcePerformance(entry: PerformanceResourceTiming): void {
    const metrics = {
      dnsLookup: entry.domainLookupEnd - entry.domainLookupStart,
      tcpConnect: entry.connectEnd - entry.connectStart,
      request: entry.responseStart - entry.requestStart,
      response: entry.responseEnd - entry.responseStart,
      size: entry.transferSize,
      cached: entry.transferSize === 0 && entry.decodedBodySize > 0,
    };

    this.structuredLogger.debug(`Resource performance: ${entry.name}`, {
      category: "performance",
      operation: "resource",
      duration: entry.duration,
      type: "resource",
      metadata: {
        name: entry.name,
        initiatorType: entry.initiatorType,
        ...metrics,
      },
    });
  }

  private logPaintPerformance(entry: PerformancePaintTiming): void {
    this.structuredLogger.info(`Paint timing: ${entry.name}`, {
      category: "performance",
      operation: "paint",
      duration: entry.startTime,
      type: "paint",
      metadata: {
        name: entry.name,
        timestamp: entry.startTime,
      },
    });
  }

  private logLongTask(entry: PerformanceEntry): void {
    this.structuredLogger.warn("Long task detected", {
      category: "performance_warning",
      operation: "long_task",
      duration: entry.duration,
      type: "custom",
      metadata: {
        startTime: entry.startTime,
        name: entry.name,
      },
    });
  }

  private getThreshold(operation: string): number {
    const thresholds: Record<string, number> = {
      api_call: 2000, // 2 seconds
      page_load: 3000, // 3 seconds
      render: 100, // 100ms
      database_query: 1000, // 1 second
      file_upload: 10000, // 10 seconds
      default: 1000, // 1 second
    };

    return thresholds[operation] || thresholds.default;
  }

  measureFPS(duration: number = 1000): void {
    if (typeof window === "undefined") return;

    let frameCount = 0;
    let lastTime = performance.now();

    const countFrame = () => {
      frameCount++;
      const currentTime = performance.now();

      if (currentTime - lastTime >= duration) {
        const fps = Math.round((frameCount * 1000) / (currentTime - lastTime));

        this.structuredLogger.debug(`FPS: ${fps}`, {
          category: "performance",
          operation: "fps_measurement",
          duration: currentTime - lastTime,
          type: "custom",
          metadata: {
            fps,
            frameCount,
            measurementDuration: duration,
          },
        });

        // Log warning for low FPS
        if (fps < 30) {
          this.structuredLogger.warn("Low FPS detected", {
            category: "performance_warning",
            operation: "fps_warning",
            fps,
            threshold: 30,
          });
        }

        return;
      }

      requestAnimationFrame(countFrame);
    };

    requestAnimationFrame(countFrame);
  }

  destroy(): void {
    // Clean up performance observers
    this.performanceObservers.forEach((observer) => {
      observer.disconnect();
    });
    this.performanceObservers = [];

    // Clear timers
    this.timers.clear();
  }
}
