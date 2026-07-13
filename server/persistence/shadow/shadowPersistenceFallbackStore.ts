// @responsibility In-memory fallback store for shadow persistence payloads.

const fallbackStore = new Map<string, unknown>();

function cloneValue<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

export function putShadowPersistenceFallback<T>(source: string, data: T): void {
  fallbackStore.set(source, cloneValue(data));
}

export function getShadowPersistenceFallback<T>(source: string): T | undefined {
  if (!fallbackStore.has(source)) return undefined;
  return cloneValue(fallbackStore.get(source) as T);
}

export function deleteShadowPersistenceFallback(source: string): void {
  fallbackStore.delete(source);
}

export function clearShadowPersistenceFallbacks(): void {
  fallbackStore.clear();
}
