"use client";

import { useState, useEffect } from "react";
import { iceServerManager, testTurnConnectivity } from "@/lib/ice-servers";
import {
  ICEServer,
  TurnCredentials,
  ConnectivityResult,
} from "@/lib/ice-servers";

export default function TurnTestPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [iceServers, setIceServers] = useState<ICEServer[]>([]);
  const [testResult, setTestResult] = useState<ConnectivityResult | null>(null);
  const [serverInfo, setServerInfo] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [userId] = useState("test-user-" + Date.now());
  const [meetingId] = useState("test-meeting-" + Date.now());

  useEffect(() => {
    loadICEServers();
    loadServerInfo();
  }, []);

  const loadICEServers = async () => {
    try {
      setIsLoading(true);
      const servers = await iceServerManager.getIceServers(userId, meetingId);
      setIceServers(servers);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load ICE servers"
      );
    } finally {
      setIsLoading(false);
    }
  };

  const loadServerInfo = async () => {
    try {
      const info = await iceServerManager.getServerInfo();
      setServerInfo(info);
    } catch (err) {
      console.error("Failed to load server info:", err);
    }
  };

  const runConnectivityTest = async () => {
    try {
      setIsLoading(true);
      const result = await testTurnConnectivity(userId, meetingId);
      setTestResult(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connectivity test failed");
      setTestResult(null);
    } finally {
      setIsLoading(false);
    }
  };

  const refreshCredentials = async () => {
    try {
      setIsLoading(true);
      // Force refresh by clearing credentials
      (iceServerManager as any).credentials = null;
      await loadICEServers();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to refresh credentials"
      );
    } finally {
      setIsLoading(false);
    }
  };

  const getConnectivityColor = (connectivity: string) => {
    switch (connectivity) {
      case "direct":
        return "text-green-600";
      case "nat":
        return "text-yellow-600";
      case "relay":
        return "text-blue-600";
      case "failed":
        return "text-red-600";
      default:
        return "text-gray-600";
    }
  };

  const getConnectivityIcon = (connectivity: string) => {
    switch (connectivity) {
      case "direct":
        return "🟢";
      case "nat":
        return "🟡";
      case "relay":
        return "🔵";
      case "failed":
        return "🔴";
      default:
        return "⚪";
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">
          TURN/STUN Server Test
        </h1>

        {/* Error Display */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-4 mb-6">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg
                  className="h-5 w-5 text-red-400"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-red-800">Error</h3>
                <div className="mt-2 text-sm text-red-700">{error}</div>
              </div>
            </div>
          </div>
        )}

        {/* Test Controls */}
        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Test Controls
          </h2>
          <div className="flex flex-wrap gap-4">
            <button
              onClick={loadICEServers}
              disabled={isLoading}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {isLoading ? "Loading..." : "Load ICE Servers"}
            </button>
            <button
              onClick={runConnectivityTest}
              disabled={isLoading}
              className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
            >
              {isLoading ? "Testing..." : "Run Connectivity Test"}
            </button>
            <button
              onClick={refreshCredentials}
              disabled={isLoading}
              className="px-4 py-2 bg-yellow-600 text-white rounded-md hover:bg-yellow-700 disabled:opacity-50"
            >
              {isLoading ? "Refreshing..." : "Refresh Credentials"}
            </button>
            <button
              onClick={loadServerInfo}
              disabled={isLoading}
              className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50"
            >
              Load Server Info
            </button>
          </div>
          <div className="mt-4 text-sm text-gray-600">
            <p>
              <strong>Test User ID:</strong> {userId}
            </p>
            <p>
              <strong>Test Meeting ID:</strong> {meetingId}
            </p>
          </div>
        </div>

        {/* ICE Servers */}
        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            ICE Servers ({iceServers.length})
          </h2>
          {iceServers.length > 0 ? (
            <div className="space-y-3">
              {iceServers.map((server, index) => (
                <div
                  key={index}
                  className="border border-gray-200 rounded-md p-3"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium text-gray-900">
                        {server.urls.join(", ")}
                      </div>
                      {server.username && (
                        <div className="text-sm text-gray-600">
                          Username: {server.username.substring(0, 20)}...
                        </div>
                      )}
                      {server.credential && (
                        <div className="text-sm text-gray-600">
                          Credential: {server.credential.substring(0, 20)}...
                        </div>
                      )}
                    </div>
                    <div className="text-sm text-gray-500">
                      {server.username ? "TURN" : "STUN"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500">No ICE servers loaded</p>
          )}
        </div>

        {/* Connectivity Test Results */}
        {testResult && (
          <div className="bg-white shadow rounded-lg p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Connectivity Test Results
            </h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="font-medium">Success:</span>
                <span
                  className={
                    testResult.success ? "text-green-600" : "text-red-600"
                  }
                >
                  {testResult.success ? "✅ Yes" : "❌ No"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-medium">Duration:</span>
                <span>{testResult.duration}ms</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-medium">Candidates Found:</span>
                <span>{testResult.candidates}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-medium">Candidate Types:</span>
                <span>{testResult.candidateTypes.join(", ") || "None"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-medium">Connectivity:</span>
                <span
                  className={`font-medium ${getConnectivityColor(
                    testResult.connectivity
                  )}`}
                >
                  {getConnectivityIcon(testResult.connectivity)}{" "}
                  {testResult.connectivity.toUpperCase()}
                </span>
              </div>
              {testResult.error && (
                <div className="bg-red-50 border border-red-200 rounded-md p-3">
                  <div className="text-sm font-medium text-red-800">Error:</div>
                  <div className="text-sm text-red-700">{testResult.error}</div>
                </div>
              )}
              {testResult.bestCandidate && (
                <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
                  <div className="text-sm font-medium text-blue-800">
                    Best Candidate:
                  </div>
                  <div className="text-sm text-blue-700">
                    Type: {testResult.bestCandidate.type || "Unknown"} |
                    Protocol: {testResult.bestCandidate.protocol || "Unknown"} |
                    Priority: {testResult.bestCandidate.priority || "N/A"}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Server Info */}
        {serverInfo && (
          <div className="bg-white shadow rounded-lg p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Server Information
            </h2>
            <div className="space-y-4">
              <div>
                <h3 className="font-medium text-gray-900 mb-2">
                  Server Version
                </h3>
                <p className="text-gray-600">{serverInfo.server_version}</p>
              </div>
              <div>
                <h3 className="font-medium text-gray-900 mb-2">
                  Supported Protocols
                </h3>
                <div className="flex flex-wrap gap-2">
                  {serverInfo.supported_protocols?.map(
                    (protocol: string, index: number) => (
                      <span
                        key={index}
                        className="px-2 py-1 bg-blue-100 text-blue-800 text-sm rounded"
                      >
                        {protocol}
                      </span>
                    )
                  )}
                </div>
              </div>
              <div>
                <h3 className="font-medium text-gray-900 mb-2">Ports</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  {Object.entries(serverInfo.ports || {}).map(
                    ([key, value]) => (
                      <div key={key} className="flex justify-between">
                        <span className="font-medium">{key}:</span>
                        <span>{String(value)}</span>
                      </div>
                    )
                  )}
                </div>
              </div>
              <div>
                <h3 className="font-medium text-gray-900 mb-2">
                  Supported Codecs
                </h3>
                <div className="flex flex-wrap gap-2">
                  {serverInfo.codecs?.map((codec: string, index: number) => (
                    <span
                      key={index}
                      className="px-2 py-1 bg-green-100 text-green-800 text-sm rounded"
                    >
                      {codec}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="font-medium text-gray-900 mb-2">Features</h3>
                <div className="flex flex-wrap gap-2">
                  {serverInfo.features?.map(
                    (feature: string, index: number) => (
                      <span
                        key={index}
                        className="px-2 py-1 bg-purple-100 text-purple-800 text-sm rounded"
                      >
                        {feature}
                      </span>
                    )
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Instructions */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-blue-900 mb-4">
            Testing Instructions
          </h2>
          <ol className="list-decimal list-inside space-y-2 text-blue-800">
            <li>
              Click "Load ICE Servers" to get TURN credentials from the server
            </li>
            <li>
              Click "Run Connectivity Test" to test STUN/TURN connectivity
            </li>
            <li>Check the results for connection type (Direct/NAT/Relay)</li>
            <li>Use "Refresh Credentials" to get new TURN credentials</li>
            <li>Monitor server information for configuration details</li>
          </ol>
          <div className="mt-4 p-3 bg-blue-100 rounded-md">
            <p className="text-sm text-blue-800">
              <strong>Note:</strong> This test creates temporary TURN
              credentials that expire after 5 minutes. The test simulates WebRTC
              connection establishment without actual media transfer.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
