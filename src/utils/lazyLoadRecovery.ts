// @responsibility Recover stale deployment assets with a persistent reload limit.
const RELOAD_KEY = 'qm-asset-reload';

export function isAssetLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading chunk .+ failed|Unable to preload CSS/i.test(message);
}

export function reloadPage(): void { window.location.reload(); }

export function installLazyLoadRecovery(buildId: string): () => void {
  const recover = (event: Event) => {
    const error = (event as Event & { payload?: unknown }).payload;
    if (!isAssetLoadError(error) || !navigator.onLine) return;
    try {
      if (sessionStorage.getItem(RELOAD_KEY) === buildId) return;
      sessionStorage.setItem(RELOAD_KEY, buildId);
    } catch (storageError) {
      // Without a durable tab marker an automatic reload could loop; keep manual recovery available.
      console.warn('[AssetRecovery] Automatic reload unavailable:', storageError);
      return;
    }
    event.preventDefault();
    reloadPage();
  };
  window.addEventListener('vite:preloadError', recover);
  return () => window.removeEventListener('vite:preloadError', recover);
}
