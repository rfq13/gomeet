/**
 * Safe localStorage utilities for client-side storage access
 * Handles SSR and edge cases where localStorage might not be available
 */

/**
 * Safely get an item from localStorage
 * @param key - The key to retrieve
 * @returns The stored value or null if not available
 */
export function safeGetLocalStorageItem(key: string): string | null {
  try {
    // Check if we're in a browser environment and localStorage is available
    if (
      typeof window !== "undefined" &&
      typeof localStorage !== "undefined" &&
      typeof localStorage.getItem === "function"
    ) {
      return localStorage.getItem(key);
    }
  } catch (error) {
    console.warn(
      `[Storage Utils] Error getting localStorage item "${key}":`,
      error
    );
  }
  return null;
}

/**
 * Safely set an item in localStorage
 * @param key - The key to set
 * @param value - The value to store
 * @returns True if successful, false otherwise
 */
export function safeSetLocalStorageItem(key: string, value: string): boolean {
  try {
    // Check if we're in a browser environment and localStorage is available
    if (
      typeof window !== "undefined" &&
      typeof localStorage !== "undefined" &&
      typeof localStorage.setItem === "function"
    ) {
      localStorage.setItem(key, value);
      return true;
    }
  } catch (error) {
    console.warn(
      `[Storage Utils] Error setting localStorage item "${key}":`,
      error
    );
  }
  return false;
}

/**
 * Safely remove an item from localStorage
 * @param key - The key to remove
 * @returns True if successful, false otherwise
 */
export function safeRemoveLocalStorageItem(key: string): boolean {
  try {
    // Check if we're in a browser environment and localStorage is available
    if (
      typeof window !== "undefined" &&
      typeof localStorage !== "undefined" &&
      typeof localStorage.removeItem === "function"
    ) {
      localStorage.removeItem(key);
      return true;
    }
  } catch (error) {
    console.warn(
      `[Storage Utils] Error removing localStorage item "${key}":`,
      error
    );
  }
  return false;
}

/**
 * Check if localStorage is available and functional
 * @returns True if localStorage is available, false otherwise
 */
export function isLocalStorageAvailable(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      typeof localStorage !== "undefined" &&
      typeof localStorage.getItem === "function" &&
      typeof localStorage.setItem === "function" &&
      typeof localStorage.removeItem === "function"
    );
  } catch (error) {
    return false;
  }
}
