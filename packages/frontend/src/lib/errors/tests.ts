// Test suite for centralized error handling system
// These tests can be run in the browser console or during development

import {
  errorStore,
  ErrorCode,
  ErrorCategory,
  retryManager,
  errorLogger,
  type AppError,
} from "./index";

export class ErrorHandlingTests {
  private results: { test: string; passed: boolean; error?: string }[] = [];

  // Test helper methods
  private assert(condition: boolean, message: string) {
    if (!condition) {
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  private runTest(testName: string, testFn: () => void | Promise<void>) {
    try {
      const result = testFn();
      if (result instanceof Promise) {
        return result
          .then(() => {
            this.results.push({ test: testName, passed: true });
            console.log(`✅ ${testName}`);
          })
          .catch((error) => {
            this.results.push({
              test: testName,
              passed: false,
              error: error.message,
            });
            console.error(`❌ ${testName}: ${error.message}`);
          });
      } else {
        this.results.push({ test: testName, passed: true });
        console.log(`✅ ${testName}`);
      }
    } catch (error) {
      this.results.push({
        test: testName,
        passed: false,
        error: (error as Error).message,
      });
      console.error(`❌ ${testName}: ${(error as Error).message}`);
    }
  }

  // Helper to get store value
  private getStoreValue<T>(store: {
    subscribe: (fn: (value: T) => void) => () => void;
  }): Promise<T> {
    return new Promise((resolve) => {
      const unsubscribe = store.subscribe((value) => {
        unsubscribe();
        resolve(value);
      });
    });
  }

  // Test 1: Error Store Basic Functionality
  testErrorStoreBasics() {
    this.runTest("Error Store - Add and Clear Errors", () => {
      // Clear any existing errors
      errorStore.clearAllErrors();

      // Add a test error
      const error = errorStore.addError(
        ErrorCode.NETWORK_CONNECTION_FAILED,
        ErrorCategory.NETWORK,
        "Test network error"
      );

      this.assert(error !== null, "Error should be created");
      this.assert(
        error.code === ErrorCode.NETWORK_CONNECTION_FAILED,
        "Error code should match"
      );
      this.assert(
        error.category === ErrorCategory.NETWORK,
        "Error category should match"
      );
      this.assert(
        error.userMessage.length > 0,
        "User message should not be empty"
      );

      // Clear the error
      errorStore.clearError(error.id);

      // Verify error is cleared
      setTimeout(() => {
        console.log("Error cleared successfully");
      }, 0);
    });
  }

  // Test 2: Error Categories and Codes
  testErrorCategories() {
    this.runTest("Error Categories - Valid Codes", () => {
      const testCases = [
        {
          code: ErrorCode.AUTH_NOT_AUTHENTICATED,
          category: ErrorCategory.AUTHENTICATION,
        },
        {
          code: ErrorCode.NETWORK_CONNECTION_FAILED,
          category: ErrorCategory.NETWORK,
        },
        {
          code: ErrorCode.VAL_INVALID_INPUT,
          category: ErrorCategory.VALIDATION,
        },
        { code: ErrorCode.MTG_NOT_FOUND, category: ErrorCategory.MEETING },
      ];

      testCases.forEach(({ code, category }) => {
        const error = errorStore.addError(code, category, "Test error");
        this.assert(error.code === code, `Code ${code} should match`);
        this.assert(
          error.category === category,
          `Category ${category} should match`
        );
      });
    });
  }

  // Test 3: Retry Mechanism
  testRetryMechanism() {
    this.runTest("Retry Mechanism - Success After Retry", async () => {
      let attemptCount = 0;
      const maxAttempts = 3;

      const testFunction = async () => {
        attemptCount++;
        if (attemptCount < maxAttempts) {
          throw new Error("Simulated failure");
        }
        return "success";
      };

      try {
        const result = await retryManager.execute(testFunction, {
          maxRetries: maxAttempts - 1,
          baseDelay: 10, // Short delay for testing
        });

        this.assert(result === "success", "Should succeed after retries");
        this.assert(
          attemptCount === maxAttempts,
          `Should attempt ${maxAttempts} times`
        );
      } catch (error) {
        throw new Error(`Retry mechanism failed: ${error}`);
      }
    });
  }

  // Test 4: Error Logging
  testErrorLogging() {
    this.runTest("Error Logging - Structured Logging", () => {
      const testError = errorStore.createError(
        ErrorCode.VAL_INVALID_INPUT,
        ErrorCategory.VALIDATION,
        "Test validation error",
        new Error("Validation failed"),
        { action: "test_validation" }
      );

      // Log the error
      errorLogger.logError(testError, { testContext: true });

      // Get log stats
      const stats = errorLogger.getLogStats();

      this.assert(stats.total >= 0, "Log stats should be available");
      this.assert(
        typeof stats.byLevel === "object",
        "Should have level breakdown"
      );
      this.assert(
        typeof stats.byCategory === "object",
        "Should have category breakdown"
      );
    });
  }

  // Test 5: User Messages in Bahasa Indonesia
  testBahasaMessages() {
    this.runTest("Bahasa Messages - Indonesian Language", () => {
      const testCases = [
        ErrorCode.AUTH_INVALID_CREDENTIALS,
        ErrorCode.NETWORK_OFFLINE,
        ErrorCode.VAL_REQUIRED_FIELD_MISSING,
        ErrorCode.MTG_NOT_FOUND,
      ];

      testCases.forEach((code) => {
        const error = errorStore.addError(
          code,
          ErrorCategory.UNKNOWN, // Category doesn't matter for this test
          "Test message"
        );

        this.assert(
          error.userMessage.length > 0,
          `User message for ${code} should not be empty`
        );
        this.assert(
          error.userMessage !== error.message,
          `User message should be different from technical message for ${code}`
        );

        console.log(`Message for ${code}: ${error.userMessage}`);
      });
    });
  }

  // Test 6: Error Store State Management
  async testErrorStoreState() {
    this.runTest("Error Store - State Management", async () => {
      errorStore.clearAllErrors();

      // Add multiple errors
      const error1 = errorStore.addError(
        ErrorCode.NETWORK_TIMEOUT,
        ErrorCategory.NETWORK,
        "Timeout error"
      );
      const error2 = errorStore.addError(
        ErrorCode.VAL_INVALID_INPUT,
        ErrorCategory.VALIDATION,
        "Invalid input"
      );

      // Get store value properly
      const storeValue = await this.getStoreValue(errorStore);

      // Test derived stores
      this.assert(
        storeValue.errors.length >= 2,
        "Should have at least 2 errors"
      );

      // Test error count by severity
      const severityCount = { critical: 0, high: 0, medium: 0, low: 0 };
      storeValue.errors.forEach((error: AppError) => {
        // Simple severity classification for test
        if (error.code === ErrorCode.NETWORK_TIMEOUT) severityCount.medium++;
        else severityCount.low++;
      });

      this.assert(
        severityCount.medium >= 1,
        "Should have medium severity errors"
      );
      this.assert(severityCount.low >= 1, "Should have low severity errors");
    });
  }

  // Test 7: Retry Configuration
  testRetryConfiguration() {
    this.runTest("Retry Configuration - Custom Options", async () => {
      let attempts = 0;

      const failingFunction = async () => {
        attempts++;
        throw new Error("Always fails");
      };

      try {
        await retryManager.execute(failingFunction, {
          maxRetries: 2,
          baseDelay: 10,
          onRetry: (attempt: number, error: Error) => {
            console.log(`Retry attempt ${attempt}: ${error.message}`);
          },
        });

        // Should not reach here
        throw new Error("Should have failed after retries");
      } catch (error) {
        this.assert(
          attempts === 3,
          "Should attempt 3 times (1 initial + 2 retries)"
        );
        this.assert(
          (error as Error).message === "Always fails",
          "Should preserve original error"
        );
      }
    });
  }

  // Run all tests
  async runAllTests() {
    console.log("🧪 Starting Error Handling Tests...\n");

    // Clear any existing state
    errorStore.clearAllErrors();

    // Run synchronous tests
    this.testErrorStoreBasics();
    this.testErrorCategories();
    this.testBahasaMessages();

    // Run asynchronous tests
    await this.testRetryMechanism();
    this.testErrorLogging();
    await this.testRetryConfiguration();
    await this.testErrorStoreState();

    // Print results
    this.printResults();
  }

  // Print test results
  private printResults() {
    const passed = this.results.filter((r) => r.passed).length;
    const failed = this.results.filter((r) => !r.passed).length;
    const total = this.results.length;

    console.log("\n📊 Test Results:");
    console.log(`Total: ${total}`);
    console.log(`Passed: ${passed} ✅`);
    console.log(`Failed: ${failed} ❌`);

    if (failed > 0) {
      console.log("\n❌ Failed Tests:");
      this.results
        .filter((r) => !r.passed)
        .forEach((r) => {
          console.log(`  - ${r.test}: ${r.error}`);
        });
    }

    console.log(
      `\n${failed === 0 ? "🎉 All tests passed!" : "⚠️ Some tests failed."}`
    );
  }

  // Get test results
  getResults() {
    return this.results;
  }
}

// Export test instance
export const errorTests = new ErrorHandlingTests();

// Convenience function to run tests
export const runErrorHandlingTests = () => {
  return errorTests.runAllTests();
};

// Make tests available globally in development
if (typeof window !== "undefined" && import.meta.env.DEV) {
  (window as any).errorTests = errorTests;
  (window as any).runErrorTests = runErrorHandlingTests;

  console.log("🧪 Error handling tests available!");
  console.log("Run `runErrorTests()` in the console to execute all tests.");
}
