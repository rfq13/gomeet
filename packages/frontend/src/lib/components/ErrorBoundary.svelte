<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { errorStore, currentError } from '$lib/stores/error.store';
  import { X, AlertTriangle, RefreshCw, Info, AlertCircle } from 'lucide-svelte';
  import type { ErrorNotification } from '$lib/errors/types';

  export let fallback: any = null;
  export let showErrorDetails = false;
  export let maxErrors = 5;
  export let position: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' = 'top-right';
  
  let hasError = false;
  let error: Error | null = null;
  let errorId: string | null = null;
  let notifications: ErrorNotification[] = [];
  let unsubscribe: (() => void) | null = null;

  // Position classes
  const positionClasses = {
    'top-right': 'top-4 right-4',
    'top-left': 'top-4 left-4', 
    'bottom-right': 'bottom-4 right-4',
    'bottom-left': 'bottom-4 left-4'
  };

  // Get icon based on notification type
  const getIcon = (type: string) => {
    switch (type) {
      case 'error': return AlertCircle;
      case 'warning': return AlertTriangle;
      case 'info': return Info;
      default: return AlertCircle;
    }
  };

  // Get notification style classes
  const getNotificationClasses = (type: string) => {
    const baseClasses = 'p-4 rounded-lg shadow-lg border transition-all duration-300 transform';
    
    switch (type) {
      case 'error':
        return `${baseClasses} bg-red-50 border-red-200 text-red-800`;
      case 'warning':
        return `${baseClasses} bg-yellow-50 border-yellow-200 text-yellow-800`;
      case 'info':
        return `${baseClasses} bg-blue-50 border-blue-200 text-blue-800`;
      default:
        return `${baseClasses} bg-gray-50 border-gray-200 text-gray-800`;
    }
  };

  // Handle error boundary
  const handleError = (err: Error, errorInfo?: any) => {
    hasError = true;
    error = err;
    
    // Log to error store
    const appError = errorStore.addError(
      'UNKNOWN_ERROR' as any,
      'UNKNOWN' as any,
      err.message,
      err,
      { component: 'ErrorBoundary' }
    );
    
    errorId = appError.id;
    
    // Create notification
    const notification = errorStore.createNotification(appError);
    addNotification(notification);
  };

  // Add notification to list
  const addNotification = (notification: ErrorNotification) => {
    notifications = [notification, ...notifications].slice(0, maxErrors);
    
    // Auto-remove non-persistent notifications
    if (!notification.persistent && notification.duration) {
      setTimeout(() => {
        removeNotification(notification.id);
      }, notification.duration);
    }
  };

  // Remove notification
  const removeNotification = (id: string) => {
    notifications = notifications.filter(n => n.id !== id);
    errorStore.clearError(id);
  };

  // Retry action
  const handleRetry = (notification: ErrorNotification) => {
    const retryAction = notification.actions?.find(a => a.label === 'Coba Lagi');
    if (retryAction) {
      retryAction.action();
    }
  };

  // Clear all notifications
  const clearAll = () => {
    notifications.forEach(n => errorStore.clearError(n.id));
    notifications = [];
  };

  // Reset error boundary
  const reset = () => {
    hasError = false;
    error = null;
    errorId = null;
  };

  // Subscribe to error store
  onMount(() => {
    unsubscribe = errorStore.subscribe((state) => {
      // Add new errors to notifications
      state.errors.forEach(appError => {
        if (errorStore.shouldShowNotification(appError)) {
          const existingNotification = notifications.find(n => n.id === appError.id);
          if (!existingNotification) {
            const notification = errorStore.createNotification(appError);
            addNotification(notification);
          }
        }
      });
    });
  });

  onDestroy(() => {
    if (unsubscribe) unsubscribe();
  });

  // Error boundary catch
  $: if ($currentError && $currentError.id !== errorId) {
    handleError(new Error($currentError.message), { error: $currentError });
  }
</script>

<!-- Error Notifications -->
<div 
  class="fixed z-50 space-y-2 {positionClasses[position]}"
  style="max-width: 400px;"
>
  {#each notifications as notification (notification.id)}
    {@const IconComponent = getIcon(notification.type)}
    <div class={getNotificationClasses(notification.type)}>
      <div class="flex items-start">
        <IconComponent class="h-5 w-5 flex-shrink-0 mt-0.5" />
        
        <div class="ml-3 flex-1">
          <h4 class="text-sm font-medium">
            {notification.title}
          </h4>
          <p class="text-sm mt-1 opacity-90">
            {notification.message}
          </p>
          
          {#if showErrorDetails && error && error.stack}
            <details class="mt-2">
              <summary class="text-xs cursor-pointer opacity-70 hover:opacity-100">
                Detail Error
              </summary>
              <pre class="text-xs mt-1 p-2 bg-black/10 rounded overflow-auto max-h-32">
                {error.stack}
              </pre>
            </details>
          {/if}
          
          {#if notification.actions && notification.actions.length > 0}
            <div class="flex gap-2 mt-3">
              {#each notification.actions as action}
                <button
                  class="text-xs px-3 py-1 rounded transition-colors {
                    action.variant === 'primary' 
                      ? 'bg-blue-600 text-white hover:bg-blue-700' 
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }"
                  on:click={action.action}
                >
                  {action.label}
                </button>
              {/each}
            </div>
          {/if}
        </div>
        
        <button
          class="ml-3 flex-shrink-0 p-1 rounded hover:bg-black/10 transition-colors"
          on:click={() => removeNotification(notification.id)}
          aria-label="Tutup notifikasi"
        >
          <X class="h-4 w-4" />
        </button>
      </div>
    </div>
  {/each}
  
  {#if notifications.length > 1}
    <button
      class="text-xs text-gray-500 hover:text-gray-700 transition-colors w-full text-center py-1"
      on:click={clearAll}
    >
      Hapus Semua ({notifications.length})
    </button>
  {/if}
</div>

<!-- Fallback UI when component has error -->
{#if hasError && fallback}
  <div class="p-6 border border-red-200 rounded-lg bg-red-50">
    <div class="flex items-center mb-4">
      <AlertTriangle class="h-5 w-5 text-red-600 mr-2" />
      <h3 class="text-lg font-medium text-red-800">
        Terjadi Kesalahan
      </h3>
    </div>
    
    <p class="text-red-700 mb-4">
      {error?.message || 'Komponen mengalami error yang tidak diketahui.'}
    </p>
    
    {#if showErrorDetails && error?.stack}
      <details class="mb-4">
        <summary class="cursor-pointer text-sm text-red-600 hover:text-red-800">
          Lihat Detail Error
        </summary>
        <pre class="mt-2 p-3 bg-red-100 rounded text-xs overflow-auto max-h-48">
          {error.stack}
        </pre>
      </details>
    {/if}
    
    <div class="flex gap-2">
      <button
        class="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors flex items-center"
        on:click={reset}
      >
        <RefreshCw class="h-4 w-4 mr-2" />
        Coba Lagi
      </button>
      
      <button
        class="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition-colors"
        on:click={() => removeNotification(errorId!)}
      >
        Tutup
      </button>
    </div>
  </div>
{/if}

<!-- Slot for normal content -->
{#if !hasError}
  <slot />
{/if}