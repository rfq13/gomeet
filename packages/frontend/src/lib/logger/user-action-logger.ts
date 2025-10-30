import type { UserActionContext } from "./types";
import { StructuredLogger } from "./structured-logger";

export class UserActionLogger {
  constructor(private structuredLogger: StructuredLogger) {}

  logAction(action: string, context?: Record<string, any>): void {
    const userActionContext: UserActionContext = {
      action,
      timestamp: new Date().toISOString(),
      userId: this.structuredLogger.getContext("userId"),
      sessionId: this.structuredLogger.getContext("sessionId"),
      page: this.getCurrentPage(),
      metadata: context,
    };

    this.structuredLogger.info(`User Action: ${action}`, {
      category: "user_action",
      ...userActionContext,
    });
  }

  logUIInteraction(
    element: string,
    action: string,
    context?: Record<string, any>
  ): void {
    const elementInfo = this.parseElementSelector(element);

    this.structuredLogger.info(`UI Interaction: ${action} on ${element}`, {
      category: "ui_interaction",
      element,
      elementType: elementInfo.type,
      action,
      page: this.getCurrentPage(),
      userId: this.structuredLogger.getContext("userId"),
      sessionId: this.structuredLogger.getContext("sessionId"),
      timestamp: new Date().toISOString(),
      ...context,
    });
  }

  logNavigation(from: string, to: string, method?: string): void {
    this.structuredLogger.info(`Navigation: ${from} → ${to}`, {
      category: "navigation",
      from,
      to,
      method,
      page: to,
      userId: this.structuredLogger.getContext("userId"),
      sessionId: this.structuredLogger.getContext("sessionId"),
      timestamp: new Date().toISOString(),
    });
  }

  logFormInteraction(
    formName: string,
    action: string,
    data?: Record<string, any>
  ): void {
    // Sanitize sensitive data
    const sanitizedData = this.sanitizeFormData(data);

    this.structuredLogger.info(`Form Interaction: ${action} on ${formName}`, {
      category: "form_interaction",
      formName,
      action,
      page: this.getCurrentPage(),
      userId: this.structuredLogger.getContext("userId"),
      sessionId: this.structuredLogger.getContext("sessionId"),
      timestamp: new Date().toISOString(),
      formData: sanitizedData,
    });
  }

  logFeatureUsage(feature: string, context?: Record<string, any>): void {
    this.structuredLogger.info(`Feature Used: ${feature}`, {
      category: "feature_usage",
      feature,
      page: this.getCurrentPage(),
      userId: this.structuredLogger.getContext("userId"),
      sessionId: this.structuredLogger.getContext("sessionId"),
      timestamp: new Date().toISOString(),
      ...context,
    });
  }

  logClick(element: string, context?: Record<string, any>): void {
    this.logUIInteraction(element, "click", context);
  }

  logHover(
    element: string,
    duration?: number,
    context?: Record<string, any>
  ): void {
    this.logUIInteraction(element, "hover", { duration, ...context });
  }

  logFocus(element: string, context?: Record<string, any>): void {
    this.logUIInteraction(element, "focus", context);
  }

  logBlur(element: string, context?: Record<string, any>): void {
    this.logUIInteraction(element, "blur", context);
  }

  logScroll(
    direction: "up" | "down",
    distance: number,
    context?: Record<string, any>
  ): void {
    this.structuredLogger.debug(`Scroll: ${direction} ${distance}px`, {
      category: "scroll",
      direction,
      distance,
      page: this.getCurrentPage(),
      userId: this.structuredLogger.getContext("userId"),
      sessionId: this.structuredLogger.getContext("sessionId"),
      timestamp: new Date().toISOString(),
      ...context,
    });
  }

  logSearch(
    query: string,
    results?: number,
    context?: Record<string, any>
  ): void {
    this.structuredLogger.info(`Search: "${query}"`, {
      category: "search",
      query,
      resultCount: results,
      page: this.getCurrentPage(),
      userId: this.structuredLogger.getContext("userId"),
      sessionId: this.structuredLogger.getContext("sessionId"),
      timestamp: new Date().toISOString(),
      ...context,
    });
  }

  logFileUpload(
    fileName: string,
    fileSize: number,
    status: "started" | "completed" | "failed",
    error?: string
  ): void {
    this.structuredLogger.info(`File Upload: ${fileName} - ${status}`, {
      category: "file_upload",
      fileName,
      fileSize,
      status,
      error,
      page: this.getCurrentPage(),
      userId: this.structuredLogger.getContext("userId"),
      sessionId: this.structuredLogger.getContext("sessionId"),
      timestamp: new Date().toISOString(),
    });
  }

  logDownload(
    fileName: string,
    fileSize?: number,
    context?: Record<string, any>
  ): void {
    this.structuredLogger.info(`Download: ${fileName}`, {
      category: "download",
      fileName,
      fileSize,
      page: this.getCurrentPage(),
      userId: this.structuredLogger.getContext("userId"),
      sessionId: this.structuredLogger.getContext("sessionId"),
      timestamp: new Date().toISOString(),
      ...context,
    });
  }

  logErrorBoundary(
    error: Error,
    errorInfo: any,
    context?: Record<string, any>
  ): void {
    this.structuredLogger.error("Error Boundary triggered", {
      category: "error_boundary",
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      page: this.getCurrentPage(),
      userId: this.structuredLogger.getContext("userId"),
      sessionId: this.structuredLogger.getContext("sessionId"),
      timestamp: new Date().toISOString(),
      ...context,
    });
  }

  logKeyboardShortcut(
    key: string,
    action: string,
    context?: Record<string, any>
  ): void {
    this.structuredLogger.info(`Keyboard Shortcut: ${key}`, {
      category: "keyboard_shortcut",
      key,
      action,
      page: this.getCurrentPage(),
      userId: this.structuredLogger.getContext("userId"),
      sessionId: this.structuredLogger.getContext("sessionId"),
      timestamp: new Date().toISOString(),
      ...context,
    });
  }

  logSessionStart(context?: Record<string, any>): void {
    const sessionId = this.generateSessionId();
    this.structuredLogger.setContext("sessionId", sessionId);

    this.structuredLogger.info("Session started", {
      category: "session",
      action: "start",
      sessionId,
      page: this.getCurrentPage(),
      userId: this.structuredLogger.getContext("userId"),
      timestamp: new Date().toISOString(),
      ...context,
    });
  }

  logSessionEnd(context?: Record<string, any>): void {
    const sessionId = this.structuredLogger.getContext("sessionId");

    this.structuredLogger.info("Session ended", {
      category: "session",
      action: "end",
      sessionId,
      page: this.getCurrentPage(),
      userId: this.structuredLogger.getContext("userId"),
      timestamp: new Date().toISOString(),
      ...context,
    });

    this.structuredLogger.clearContext();
  }

  // Private helper methods
  private getCurrentPage(): string {
    if (typeof window !== "undefined") {
      return window.location.pathname + window.location.search;
    }
    return "unknown";
  }

  private parseElementSelector(selector: string): {
    type: string;
    id?: string;
    class?: string;
  } {
    // Simple CSS selector parsing
    if (selector.startsWith("#")) {
      return { type: "element", id: selector.slice(1) };
    }
    if (selector.startsWith(".")) {
      return { type: "element", class: selector.slice(1) };
    }
    if (selector.includes("[") && selector.includes("]")) {
      return { type: "element" }; // Attribute selector
    }

    // Tag name
    const commonTags = [
      "button",
      "input",
      "select",
      "textarea",
      "div",
      "span",
      "a",
      "img",
    ];
    if (commonTags.includes(selector.toLowerCase())) {
      return { type: selector.toLowerCase() };
    }

    return { type: "element" };
  }

  private sanitizeFormData(
    data?: Record<string, any>
  ): Record<string, any> | undefined {
    if (!data) return undefined;

    const sensitiveFields = [
      "password",
      "passwd",
      "secret",
      "token",
      "key",
      "auth",
      "creditcard",
      "ssn",
      "social",
      "bank",
      "account",
    ];

    const sanitized: Record<string, any> = {};

    for (const [key, value] of Object.entries(data)) {
      const lowerKey = key.toLowerCase();
      const isSensitive = sensitiveFields.some((field) =>
        lowerKey.includes(field)
      );

      if (isSensitive) {
        sanitized[key] = "[REDACTED]";
      } else if (typeof value === "string" && value.length > 100) {
        // Truncate long strings
        sanitized[key] = value.substring(0, 100) + "...";
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Additional methods for compatibility
  logUserAction(
    action: string,
    element?: string,
    additionalContext?: Record<string, any>
  ): void {
    if (element) {
      this.logUIInteraction(element, action, additionalContext);
    } else {
      this.logAction(action, additionalContext);
    }
  }

  initialize(): void {
    // Set up automatic user action tracking
    if (typeof window !== "undefined") {
      this.setupGlobalClickHandlers();
      this.setupNavigationHandler();
    }
  }

  destroy(): void {
    // Clean up event listeners
    if (typeof window !== "undefined") {
      this.removeGlobalHandlers();
    }
  }

  private setupGlobalClickHandlers(): void {
    // Add global click handler for tracking user interactions
    document.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      if (target) {
        const selector = this.getElementSelector(target);
        this.logClick(selector);
      }
    });
  }

  private setupNavigationHandler(): void {
    // Track page navigation
    if (typeof window !== "undefined" && window.history) {
      const originalPushState = window.history.pushState;
      const originalReplaceState = window.history.replaceState;

      window.history.pushState = (...args) => {
        const result = originalPushState.apply(window.history, args);
        this.logNavigation(
          window.location.pathname,
          args[2] as string,
          "pushState"
        );
        return result;
      };

      window.history.replaceState = (...args) => {
        const result = originalReplaceState.apply(window.history, args);
        this.logNavigation(
          window.location.pathname,
          args[2] as string,
          "replaceState"
        );
        return result;
      };

      window.addEventListener("popstate", () => {
        this.logNavigation(
          window.location.pathname,
          window.location.pathname,
          "popstate"
        );
      });
    }
  }

  private removeGlobalHandlers(): void {
    // Clean up event listeners if needed
    // This would need to track the specific handlers added
  }

  private getElementSelector(element: HTMLElement): string {
    if (element.id) {
      return `#${element.id}`;
    }

    if (element.className) {
      return `.${element.className.split(" ").join(".")}`;
    }

    return element.tagName.toLowerCase();
  }
}
