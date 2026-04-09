import { useEffect } from 'react';
import { useAnalysisStore, useRecommendationStore, useMarketStore, useSettingsStore } from '../stores';
import { debugLog } from '../utils/debug';

/**
 * Development-only hook that watches critical Zustand state changes
 * and logs them to the console for debugging.
 *
 * Usage: call once at the app root (e.g. App.tsx).
 */
export function useDebugWatchers(): void {
  const deepAnalysisStock = useAnalysisStore((s) => s.deepAnalysisStock);
  const selectedDetailStock = useAnalysisStore((s) => s.selectedDetailStock);
  const recommendations = useRecommendationStore((s) => s.recommendations);
  const watchlist = useRecommendationStore((s) => s.watchlist);
  const loading = useRecommendationStore((s) => s.loading);
  const marketOverview = useMarketStore((s) => s.marketOverview);
  const view = useSettingsStore((s) => s.view);

  useEffect(() => {
    debugLog('deepAnalysisStock changed', deepAnalysisStock ? { name: deepAnalysisStock.name, code: deepAnalysisStock.code } : null);
  }, [deepAnalysisStock]);

  useEffect(() => {
    debugLog('selectedDetailStock changed', selectedDetailStock ? { name: selectedDetailStock.name, code: selectedDetailStock.code } : null);
  }, [selectedDetailStock]);

  useEffect(() => {
    debugLog('recommendations changed', { count: recommendations.length });
  }, [recommendations]);

  useEffect(() => {
    debugLog('watchlist changed', { count: watchlist.length });
  }, [watchlist]);

  useEffect(() => {
    debugLog('loading state changed', { loading });
  }, [loading]);

  useEffect(() => {
    debugLog('marketOverview changed', marketOverview ? { indices: marketOverview.indices?.length ?? 0 } : null);
  }, [marketOverview]);

  useEffect(() => {
    debugLog('view changed', { view });
  }, [view]);
}
