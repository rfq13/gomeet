<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { webSocketStore } from "$lib/stores";
  import type { WebSocketState } from "$lib/stores";
  
  // Derived stores
  const connectionHealth = webSocketStore.connectionHealth;
  const connectionSuccessRate = webSocketStore.connectionSuccessRate;
  const currentLatency = webSocketStore.currentLatency;

  // Props
  export let showDetails = false;
  export let showStats = true;
  export let compact = false;
  export let autoRefresh = true;
  export let refreshInterval = 1000; // 1 second

  // Local state
  let wsState: WebSocketState;
  let intervalId: NodeJS.Timeout | null = null;
  let isExpanded = false;

  // Subscribe to WebSocket store
  const unsubscribe = webSocketStore.subscribe((state) => {
    wsState = state;
  });

  // Auto refresh setup
  onMount(() => {
    if (autoRefresh) {
      intervalId = setInterval(() => {
        // Force reactivity update
        wsState = { ...wsState };
      }, refreshInterval);
    }
  });

  // Cleanup
  onDestroy(() => {
    unsubscribe();
    if (intervalId) {
      clearInterval(intervalId);
    }
  });

  // Helper functions
  function getConnectionStatusColor(state: string): string {
    switch (state) {
      case "connected":
        return "text-green-600 bg-green-100";
      case "connecting":
      case "reconnecting":
        return "text-yellow-600 bg-yellow-100";
      case "error":
        return "text-red-600 bg-red-100";
      case "disconnected":
        return "text-gray-600 bg-gray-100";
      default:
        return "text-gray-600 bg-gray-100";
    }
  }

  function getConnectionHealthColor(health: string): string {
    switch (health) {
      case "healthy":
        return "text-green-600";
      case "recovering":
        return "text-yellow-600";
      case "unhealthy":
        return "text-red-600";
      default:
        return "text-gray-600";
    }
  }

  function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  }

  function formatTimestamp(timestamp: string): string {
    return new Date(timestamp).toLocaleTimeString();
  }

  function toggleExpanded() {
    isExpanded = !isExpanded;
  }

  function clearLogs() {
    webSocketStore.config.clearEventLog();
  }

  function resetStats() {
    webSocketStore.config.resetStats();
  }

  function forceReconnect() {
    // This would need to be implemented in the integration layer
    console.log("Force reconnect requested");
  }
</script>

{#if compact}
  <!-- Compact view -->
  <div class="flex items-center space-x-2 text-sm">
    <div class="flex items-center space-x-1">
      <div class={`w-2 h-2 rounded-full ${wsState.isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
      <span class="font-medium">{wsState.connectionState}</span>
    </div>
    {#if wsState.isConnected}
      <span class="text-gray-500">• {wsState.stats.averageLatency.toFixed(0)}ms</span>
    {/if}
    {#if wsState.reconnectAttempts > 0}
      <span class="text-yellow-600">• Retry {wsState.reconnectAttempts}/{wsState.maxReconnectAttempts}</span>
    {/if}
  </div>
{:else}
  <!-- Full view -->
  <div class="bg-white border border-gray-200 rounded-lg shadow-sm">
    <!-- Header -->
    <div class="p-4 border-b border-gray-200">
      <div class="flex items-center justify-between">
        <div class="flex items-center space-x-3">
          <div class="flex items-center space-x-2">
            <div class={`w-3 h-3 rounded-full ${wsState.isConnected ? 'bg-green-500' : wsState.connectionState === 'connecting' || wsState.connectionState === 'reconnecting' ? 'bg-yellow-500' : 'bg-red-500'}`}></div>
            <h3 class="text-lg font-semibold text-gray-900">WebSocket Connection</h3>
          </div>
          <span class={`px-2 py-1 text-xs font-medium rounded-full ${getConnectionStatusColor(wsState.connectionState)}`}>
            {wsState.connectionState}
          </span>
        </div>
        <button
          on:click={toggleExpanded}
          class="text-gray-500 hover:text-gray-700 focus:outline-none"
        >
          <svg
            class="w-5 h-5 transform transition-transform {isExpanded ? 'rotate-180' : ''}"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Basic info -->
    <div class="p-4 space-y-3">
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div>
          <span class="text-gray-500">Status:</span>
          <span class={`ml-2 font-medium ${getConnectionHealthColor($connectionHealth)}`}>
            {$connectionHealth}
          </span>
        </div>
        <div>
          <span class="text-gray-500">Success Rate:</span>
          <span class="ml-2 font-medium">{$connectionSuccessRate}%</span>
        </div>
        <div>
          <span class="text-gray-500">Latency:</span>
          <span class="ml-2 font-medium">{$currentLatency.toFixed(0)}ms</span>
        </div>
        <div>
          <span class="text-gray-500">Messages:</span>
          <span class="ml-2 font-medium">{wsState.stats.totalMessagesSent}/{wsState.stats.totalMessagesReceived}</span>
        </div>
      </div>

      {#if wsState.lastError}
        <div class="bg-red-50 border border-red-200 rounded-md p-3">
          <div class="flex items-center">
            <svg class="w-4 h-4 text-red-400 mr-2" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />
            </svg>
            <span class="text-sm text-red-800">{wsState.lastError}</span>
          </div>
        </div>
      {/if}

      {#if wsState.reconnectAttempts > 0}
        <div class="bg-yellow-50 border border-yellow-200 rounded-md p-3">
          <div class="flex items-center justify-between">
            <div class="flex items-center">
              <svg class="w-4 h-4 text-yellow-400 mr-2 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span class="text-sm text-yellow-800">
                Reconnecting... Attempt {wsState.reconnectAttempts}/{wsState.maxReconnectAttempts}
              </span>
            </div>
          </div>
        </div>
      {/if}
    </div>

    <!-- Expanded details -->
    {#if isExpanded}
      <div class="border-t border-gray-200">
        <!-- Connection details -->
        {#if showDetails}
          <div class="p-4 border-b border-gray-200">
            <h4 class="text-sm font-medium text-gray-900 mb-3">Connection Details</h4>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <div>
                <span class="text-gray-500">Meeting ID:</span>
                <span class="ml-2 font-mono">{wsState.meetingId || 'N/A'}</span>
              </div>
              <div>
                <span class="text-gray-500">Client ID:</span>
                <span class="ml-2 font-mono text-xs">{wsState.clientId || 'N/A'}</span>
              </div>
              <div>
                <span class="text-gray-500">URL:</span>
                <span class="ml-2 font-mono text-xs break-all">{wsState.url || 'N/A'}</span>
              </div>
              <div>
                <span class="text-gray-500">Reconnection:</span>
                <span class="ml-2">{wsState.isReconnectionEnabled ? 'Enabled' : 'Disabled'}</span>
              </div>
            </div>
          </div>
        {/if}

        <!-- Statistics -->
        {#if showStats}
          <div class="p-4 border-b border-gray-200">
            <div class="flex items-center justify-between mb-3">
              <h4 class="text-sm font-medium text-gray-900">Statistics</h4>
              <button
                on:click={resetStats}
                class="text-xs text-gray-500 hover:text-gray-700"
              >
                Reset
              </button>
            </div>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div>
                <span class="text-gray-500">Total Attempts:</span>
                <span class="ml-2 font-medium">{wsState.stats.totalAttempts}</span>
              </div>
              <div>
                <span class="text-gray-500">Successful:</span>
                <span class="ml-2 font-medium text-green-600">{wsState.stats.successfulConnections}</span>
              </div>
              <div>
                <span class="text-gray-500">Failed:</span>
                <span class="ml-2 font-medium text-red-600">{wsState.stats.failedConnections}</span>
              </div>
              <div>
                <span class="text-gray-500">Reconnections:</span>
                <span class="ml-2 font-medium text-yellow-600">{wsState.stats.reconnectionAttempts}</span>
              </div>
              <div>
                <span class="text-gray-500">Duration:</span>
                <span class="ml-2 font-medium">{formatDuration(wsState.stats.connectionDuration)}</span>
              </div>
              <div>
                <span class="text-gray-500">Last Connected:</span>
                <span class="ml-2 font-medium">
                  {wsState.stats.lastConnectedAt ? formatTimestamp(wsState.stats.lastConnectedAt) : 'Never'}
                </span>
              </div>
              <div>
                <span class="text-gray-500">Last Disconnected:</span>
                <span class="ml-2 font-medium">
                  {wsState.stats.lastDisconnectedAt ? formatTimestamp(wsState.stats.lastDisconnectedAt) : 'Never'}
                </span>
              </div>
              <div>
                <span class="text-gray-500">Avg Latency:</span>
                <span class="ml-2 font-medium">{wsState.stats.averageLatency.toFixed(0)}ms</span>
              </div>
            </div>
          </div>
        {/if}

        <!-- Event log -->
        <div class="p-4">
          <div class="flex items-center justify-between mb-3">
            <h4 class="text-sm font-medium text-gray-900">Event Log</h4>
            <button
              on:click={clearLogs}
              class="text-xs text-gray-500 hover:text-gray-700"
            >
              Clear
            </button>
          </div>
          <div class="max-h-48 overflow-y-auto bg-gray-50 rounded-md p-3">
            {#if wsState.eventLog.length === 0}
              <p class="text-sm text-gray-500 text-center">No events logged</p>
            {:else}
              <div class="space-y-2">
                {#each wsState.eventLog.slice().reverse() as event}
                  <div class="text-xs border-b border-gray-200 pb-1">
                    <div class="flex items-center justify-between">
                      <span class="font-medium text-gray-700">{event.eventType}</span>
                      <span class="text-gray-500">{formatTimestamp(event.timestamp)}</span>
                    </div>
                    <div class="text-gray-600 mt-1">
                      State: {event.connectionState}
                      {#if event.error}
                        <span class="text-red-600 ml-2">Error: {event.error}</span>
                      {/if}
                    </div>
                    {#if event.details}
                      <div class="text-gray-500 mt-1">
                        {JSON.stringify(event.details)}
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        </div>

        <!-- Actions -->
        <div class="p-4 border-t border-gray-200 bg-gray-50">
          <div class="flex space-x-2">
            <button
              on:click={forceReconnect}
              class="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Force Reconnect
            </button>
            <button
              on:click={clearLogs}
              class="px-3 py-1 text-sm bg-gray-600 text-white rounded hover:bg-gray-700"
            >
              Clear Logs
            </button>
            <button
              on:click={resetStats}
              class="px-3 py-1 text-sm bg-gray-600 text-white rounded hover:bg-gray-700"
            >
              Reset Stats
            </button>
          </div>
        </div>
      </div>
    {/if}
  </div>
{/if}
