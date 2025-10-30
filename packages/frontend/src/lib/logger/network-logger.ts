import type { LogEntry } from "./types";
import { StructuredLogger } from "./structured-logger";

interface NetworkContext {
  url: string;
  method: string;
  statusCode?: number;
  duration?: number;
  requestSize?: number;
  responseSize?: number;
  cached?: boolean;
  error?: string;
  retryCount?: number;
}

interface NetworkConfig {
  logAllRequests: boolean;
  logFailedRequests: boolean;
  logSlowRequests: boolean;
  slowRequestThreshold: number; // ms
  maxRequestBodySize: number; // bytes
  maxResponseBodySize: number; // bytes
  sanitizeHeaders: boolean;
  headersToSanitize: string[];
}

export class NetworkLogger {
  private config: NetworkConfig;
  private originalFetch: typeof fetch;
  private originalXHROpen: typeof XMLHttpRequest.prototype.open;
  private originalXHRSend: typeof XMLHttpRequest.prototype.send;

  constructor(
    private structuredLogger: StructuredLogger,
    config: Partial<NetworkConfig> = {}
  ) {
    this.config = {
      logAllRequests: true,
      logFailedRequests: true,
      logSlowRequests: true,
      slowRequestThreshold: 2000,
      maxRequestBodySize: 1024 * 1024, // 1MB
      maxResponseBodySize: 1024 * 1024, // 1MB
      sanitizeHeaders: true,
      headersToSanitize: ["authorization", "cookie", "x-api-key"],
      ...config,
    };

    this.originalFetch = window.fetch;
    this.originalXHROpen = XMLHttpRequest.prototype.open;
    this.originalXHRSend = XMLHttpRequest.prototype.send;
  }

  initialize(): void {
    this.interceptFetch();
    this.interceptXHR();
  }

  destroy(): void {
    window.fetch = this.originalFetch;
    XMLHttpRequest.prototype.open = this.originalXHROpen;
    XMLHttpRequest.prototype.send = this.originalXHRSend;
  }

  private interceptFetch(): void {
    const self = this;

    window.fetch = async function (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> {
      const startTime = performance.now();
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method || "GET";

      let requestSize = 0;
      if (init?.body) {
        requestSize = self.calculateSize(init.body);
      }

      let response: Response;
      let error: Error | undefined;

      try {
        response = await self.originalFetch.call(this, input, init);
      } catch (e) {
        error = e as Error;
        response = new Response(null, {
          status: 0,
          statusText: "Network Error",
        });
      }

      const endTime = performance.now();
      const duration = endTime - startTime;
      const responseSize = parseInt(
        response.headers.get("content-length") || "0"
      );

      const context: NetworkContext = {
        url: self.sanitizeUrl(url),
        method,
        statusCode: response.status,
        duration,
        requestSize,
        responseSize,
        cached: self.isCachedResponse(response),
        error: error?.message,
      };

      self.logNetworkRequest(context);

      if (error) {
        throw error;
      }

      return response;
    };
  }

  private interceptXHR(): void {
    const self = this;

    XMLHttpRequest.prototype.open = function (
      method: string,
      url: string | URL,
      async?: boolean,
      username?: string | null,
      password?: string | null
    ) {
      this._method = method;
      this._url = url.toString();
      this._startTime = performance.now();

      return self.originalXHROpen.call(
        this,
        method,
        url,
        async ?? true,
        username,
        password
      );
    };

    XMLHttpRequest.prototype.send = function (
      body?: Document | XMLHttpRequestBodyInit | null
    ) {
      const xhr = this;
      const requestSize = body ? self.calculateSize(body) : 0;

      const originalOnReadyStateChange = xhr.onreadystatechange;
      xhr.onreadystatechange = function () {
        if (xhr.readyState === XMLHttpRequest.DONE) {
          const endTime = performance.now();
          const duration = endTime - (xhr._startTime || 0);
          const responseSize = parseInt(
            xhr.getResponseHeader("content-length") || "0"
          );

          const context: NetworkContext = {
            url: self.sanitizeUrl(xhr._url || ""),
            method: xhr._method || "GET",
            statusCode: xhr.status,
            duration,
            requestSize,
            responseSize: parseInt(
              xhr.getResponseHeader("content-length") || "0"
            ),
            cached: self.isCachedXHRResponse(xhr),
          };

          self.logNetworkRequest(context);
        }

        if (originalOnReadyStateChange) {
          return originalOnReadyStateChange.call(
            this,
            event || new Event("readystatechange")
          );
        }
      };

      return self.originalXHRSend.call(this, body);
    };
  }

  private logNetworkRequest(context: NetworkContext): void {
    const shouldLog =
      this.config.logAllRequests ||
      (this.config.logFailedRequests &&
        (context.statusCode! >= 400 || context.error)) ||
      (this.config.logSlowRequests &&
        context.duration! > this.config.slowRequestThreshold);

    if (!shouldLog) {
      return;
    }

    let level: "debug" | "info" | "warn" | "error" = "info";

    if (context.error || (context.statusCode && context.statusCode >= 500)) {
      level = "error";
    } else if (context.statusCode && context.statusCode >= 400) {
      level = "warn";
    } else if (
      context.duration &&
      context.duration > this.config.slowRequestThreshold
    ) {
      level = "warn";
    }

    const logEntry = {
      level,
      message: `Network ${context.method} ${context.url}`,
      category: "network" as const,
      operation: "http_request",
      timestamp: new Date().toISOString(),
      context: {
        ...context,
        userAgent: navigator.userAgent,
        sessionId: this.structuredLogger.getContext("sessionId"),
        userId: this.structuredLogger.getContext("userId"),
      },
    };

    this.structuredLogger.info(logEntry.message, logEntry);
  }

  private sanitizeUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      // Remove sensitive query parameters
      const sensitiveParams = ["token", "key", "password", "secret"];
      sensitiveParams.forEach((param) => {
        urlObj.searchParams.delete(param);
      });
      return urlObj.toString();
    } catch {
      return url;
    }
  }

  private calculateSize(data: any): number {
    if (!data) return 0;

    if (typeof data === "string") {
      return new Blob([data]).size;
    }

    if (data instanceof FormData) {
      let size = 0;
      data.forEach((value) => {
        size += new Blob([value]).size;
      });
      return size;
    }

    if (data instanceof Blob) {
      return data.size;
    }

    return new Blob([JSON.stringify(data)]).size;
  }

  private isCachedResponse(response: Response): boolean {
    return (
      response.headers.get("x-from-cache") === "true" ||
      response.headers.get("cache-control")?.includes("hit") ||
      false
    );
  }

  private isCachedXHRResponse(xhr: XMLHttpRequest): boolean {
    return (
      xhr.getResponseHeader("x-from-cache") === "true" ||
      xhr.getResponseHeader("cache-control")?.includes("hit") ||
      false
    );
  }

  // Utility methods for custom logging
  logApiCall(
    endpoint: string,
    method: string,
    statusCode: number,
    duration: number,
    additionalContext?: Record<string, any>
  ): void {
    const context: NetworkContext = {
      url: this.sanitizeUrl(endpoint),
      method,
      statusCode,
      duration,
    };

    this.logNetworkRequest({
      ...context,
      ...additionalContext,
    });
  }

  logWebSocketEvent(
    event: "connect" | "disconnect" | "message" | "error",
    url: string,
    additionalContext?: Record<string, any>
  ): void {
    const logEntry = {
      level: "info" as const,
      message: `WebSocket ${event}: ${url}`,
      category: "network" as const,
      operation: "websocket_event",
      timestamp: new Date().toISOString(),
      context: {
        url: this.sanitizeUrl(url),
        event,
        sessionId: this.structuredLogger.getContext("sessionId"),
        userId: this.structuredLogger.getContext("userId"),
        ...additionalContext,
      },
    };

    this.structuredLogger.info(logEntry.message, logEntry);
  }

  logConnectionQuality(
    url: string,
    metrics: {
      latency: number;
      bandwidth?: number;
      packetLoss?: number;
      jitter?: number;
    }
  ): void {
    const logEntry = {
      level: "info" as const,
      message: `Connection quality metrics: ${url}`,
      category: "network" as const,
      operation: "connection_quality",
      timestamp: new Date().toISOString(),
      context: {
        url: this.sanitizeUrl(url),
        metrics,
        sessionId: this.structuredLogger.getContext("sessionId"),
        userId: this.structuredLogger.getContext("userId"),
      },
    };

    this.structuredLogger.info(logEntry.message, logEntry);
  }
}

// Extend XMLHttpRequest interface to store custom properties
declare global {
  interface XMLHttpRequest {
    _method?: string;
    _url?: string;
    _startTime?: number;
  }
}
