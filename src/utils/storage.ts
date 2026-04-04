/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Safely retrieves and parses a value from localStorage.
 * If parsing fails or the key doesn't exist, it returns the fallback value.
 * 
 * @param key The localStorage key to retrieve
 * @param fallback The value to return if retrieval or parsing fails
 * @returns The parsed value or the fallback
 */
export function safeGet<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    
    const parsed = JSON.parse(raw);
    return parsed as T;
  } catch (error) {
    console.error(`Error parsing localStorage key "${key}":`, error);
    // Optionally remove the corrupted key to prevent future errors
    try {
      localStorage.removeItem(key);
    } catch (e) {
      // Ignore errors during removal
    }
    return fallback;
  }
}

/**
 * Safely saves a value to localStorage.
 * 
 * @param key The localStorage key to save to
 * @param value The value to save
 */
export function safeSet<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;
  
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`Error saving to localStorage key "${key}":`, error);
  }
}
