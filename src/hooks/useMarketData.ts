// @responsibility useMarketData React hook
import { useEffect } from 'react';
import { toast } from 'sonner';
import {
  getMarketOverview,
  syncMarketOverviewIndices,
} from '../services/stockService';
import { fetchMarketIndicators } from '../services/stock/marketOverview';
import { useMarketStore } from '../stores';

export function useMarketData() {
  const {
    marketOverview, setMarketOverview,
    loadingMarket, setLoadingMarket,
    syncStatus, setStaleFields,
  } = useMarketStore();

  // ADR-0069: /api/market-indicators 응답 헤더 X-Field-Stale 을 store 에 영속.
  // 부팅 + 5분 폴링 (장중 신선도 추적). UI 배지 컴포넌트가 store 를 직접 read.
  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      const result = await fetchMarketIndicators();
      if (!cancelled) setStaleFields(result.staleFields ?? []);
    };
    sync();
    const id = setInterval(sync, 5 * 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [setStaleFields]);

  // ── Initial Market Sync ─────────────────────────────────────────────────
  // If marketOverview is already hydrated from zustand persist, refresh indices.
  // If no data exists at all, trigger a full fetch automatically.
  useEffect(() => {
    const initialSync = async () => {
      const currentOverview = useMarketStore.getState().marketOverview;
      if (currentOverview) {
        try {
          const updated = await syncMarketOverviewIndices(currentOverview);
          setMarketOverview(updated);
        } catch (e) {
          console.error('Failed to sync market indices on startup', e);
        }
      }
    };
    initialSync();
  }, []);

  const handleFetchMarketOverview = async (force = false) => {
    if (loadingMarket) return;

    if (!force && marketOverview) {
      const last = new Date(marketOverview.lastUpdated).getTime();
      const diff = (Date.now() - last) / (1000 * 60);
      if (diff < 5) return;
      if (diff < 30) {
        setLoadingMarket(true);
        try {
          const updated = await syncMarketOverviewIndices(marketOverview);
          setMarketOverview(updated);
          return;
        } catch (e) {
          console.error('Failed to sync indices, falling back to full fetch', e);
        } finally {
          setLoadingMarket(false);
        }
      }
    }

    setLoadingMarket(true);
    try {
      const data = await getMarketOverview();
      if (data) setMarketOverview(data);
    } catch (err: any) {
      console.error('Failed to fetch market overview:', err);
      const errObj = err?.error || err;
      const message = errObj?.message || err?.message || '';
      const status = errObj?.status || err?.status;
      const code = errObj?.code || err?.code;
      const isRateLimit = message.includes('429') || status === 429 || code === 429 || status === 'RESOURCE_EXHAUSTED' || message.includes('quota');
      if (isRateLimit) toast.error('시장 개요 로드 실패: API 할당량 초과');
    } finally {
      setLoadingMarket(false);
    }
  };

  return { marketOverview, loadingMarket, syncStatus, handleFetchMarketOverview };
}
