import { useEffect } from 'react';
import { toast } from 'sonner';
import {
  getMarketOverview,
  syncMarketOverviewIndices,
  type MarketOverview,
} from '../services/stockService';
import { useMarketStore } from '../stores';

export function useMarketData() {
  const {
    marketOverview, setMarketOverview,
    loadingMarket, setLoadingMarket,
    syncStatus,
  } = useMarketStore();

  // ── Initial Market Sync ─────────────────────────────────────────────────
  useEffect(() => {
    const initialSync = async () => {
      const stored = localStorage.getItem('k-stock-market-overview');
      if (stored) {
        try {
          const overview = JSON.parse(stored) as MarketOverview;
          const updated = await syncMarketOverviewIndices(overview);
          setMarketOverview(updated);
        } catch (e) {
          console.error('Failed to parse stored market overview', e);
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
