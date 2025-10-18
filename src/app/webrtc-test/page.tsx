"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { runWebRTCTests, WebRTCTestUtils } from "@/lib/webrtc-test-utils";

interface TestResult {
  testName: string;
  expected: any;
  actual: any;
  passed: boolean;
}

interface TestSuite {
  stateValidation: TestResult[];
  signalingRole: TestResult[];
  iceCandidateBuffering: TestResult[];
}

export default function WebRTCTestPage() {
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<TestSuite | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runTests = async () => {
    setIsRunning(true);
    setError(null);
    setResults(null);

    try {
      console.log("[WebRTC Test Page] Starting WebRTC tests...");
      const testResults = await runWebRTCTests();
      setResults(testResults as TestSuite);
      console.log("[WebRTC Test Page] Tests completed:", testResults);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Unknown error occurred";
      setError(errorMessage);
      console.error("[WebRTC Test Page] Test error:", err);
    } finally {
      setIsRunning(false);
    }
  };

  const runIndividualTest = async (testName: string) => {
    setIsRunning(true);
    setError(null);

    try {
      let testResult: TestResult[] = [];

      switch (testName) {
        case "stateValidation":
          testResult = await WebRTCTestUtils.testStateValidation();
          break;
        case "signalingRole":
          testResult = WebRTCTestUtils.testSignalingRoleDetermination();
          break;
        case "iceCandidateBuffering":
          testResult = await WebRTCTestUtils.testIceCandidateBuffering();
          break;
        default:
          throw new Error(`Unknown test: ${testName}`);
      }

      setResults((prev) =>
        prev
          ? {
              ...prev,
              [testName]: testResult,
            }
          : {
              stateValidation: testName === "stateValidation" ? testResult : [],
              signalingRole: testName === "signalingRole" ? testResult : [],
              iceCandidateBuffering:
                testName === "iceCandidateBuffering" ? testResult : [],
            }
      );

      console.log(`[WebRTC Test Page] ${testName} test completed:`, testResult);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Unknown error occurred";
      setError(errorMessage);
      console.error(`[WebRTC Test Page] ${testName} test error:`, err);
    } finally {
      setIsRunning(false);
    }
  };

  const getTotalTests = () => {
    if (!results) return 0;
    return Object.values(results).flat().length;
  };

  const getPassedTests = () => {
    if (!results) return 0;
    return Object.values(results)
      .flat()
      .filter((r) => r.passed).length;
  };

  const TestResultCard = ({
    title,
    results: testResults,
  }: {
    title: string;
    results: TestResult[];
  }) => (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          {title}
          <Badge
            variant={
              testResults.every((r) => r.passed) ? "default" : "destructive"
            }
          >
            {testResults.filter((r) => r.passed).length}/{testResults.length}{" "}
            Passed
          </Badge>
        </CardTitle>
        <CardDescription>
          {testResults.every((r) => r.passed)
            ? "All tests passed"
            : "Some tests failed"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {testResults.map((result, index) => (
            <div
              key={index}
              className="flex items-center justify-between p-2 border rounded"
            >
              <span className="text-sm font-medium">{result.testName}</span>
              <div className="flex items-center space-x-2">
                <span className="text-xs text-muted-foreground">
                  Expected: {JSON.stringify(result.expected)}, Actual:{" "}
                  {JSON.stringify(result.actual)}
                </span>
                <Badge variant={result.passed ? "default" : "destructive"}>
                  {result.passed ? "✓" : "✗"}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold">WebRTC Testing Suite</h1>
        <p className="text-muted-foreground">
          Test WebRTC state management and ICE candidate handling functionality
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Test Controls</CardTitle>
          <CardDescription>
            Run comprehensive tests or individual test suites
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={runTests}
              disabled={isRunning}
              className="min-w-[120px]"
            >
              {isRunning ? "Running..." : "Run All Tests"}
            </Button>
            <Button
              variant="outline"
              onClick={() => runIndividualTest("stateValidation")}
              disabled={isRunning}
            >
              Test State Validation
            </Button>
            <Button
              variant="outline"
              onClick={() => runIndividualTest("signalingRole")}
              disabled={isRunning}
            >
              Test Signaling Role
            </Button>
            <Button
              variant="outline"
              onClick={() => runIndividualTest("iceCandidateBuffering")}
              disabled={isRunning}
            >
              Test ICE Buffering
            </Button>
          </div>

          {results && (
            <div className="mt-4 p-4 bg-muted rounded-lg">
              <div className="text-center">
                <div className="text-2xl font-bold">
                  {getPassedTests()}/{getTotalTests()} Tests Passed
                </div>
                <div className="text-sm text-muted-foreground">
                  {getPassedTests() === getTotalTests()
                    ? "✅ All tests passed!"
                    : "❌ Some tests failed"}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {results && (
        <div className="space-y-6">
          <h2 className="text-2xl font-semibold">Test Results</h2>

          <TestResultCard
            title="State Validation Tests"
            results={results.stateValidation}
          />

          <TestResultCard
            title="Signaling Role Tests"
            results={results.signalingRole}
          />

          <TestResultCard
            title="ICE Candidate Buffering Tests"
            results={results.iceCandidateBuffering}
          />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Manual Testing Instructions</CardTitle>
          <CardDescription>
            How to test WebRTC functionality manually
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h4 className="font-semibold mb-2">1. Console Testing:</h4>
            <p className="text-sm text-muted-foreground">
              Open browser console and run:{" "}
              <code className="bg-muted px-1 rounded">runWebRTCTests()</code>
            </p>
          </div>

          <div>
            <h4 className="font-semibold mb-2">2. Meeting Page Testing:</h4>
            <p className="text-sm text-muted-foreground">
              Navigate to a meeting page and monitor console logs for WebRTC
              errors
            </p>
          </div>

          <div>
            <h4 className="font-semibold mb-2">
              3. Multi-Participant Testing:
            </h4>
            <p className="text-sm text-muted-foreground">
              Open multiple browser tabs with the same meeting to test peer
              connections
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
