import { useCallback, useEffect, useState } from 'react';
import { fetchAutoTradingDashboard } from '../services/autoTrading/autoTradingApi';
import { mapAutoTradingDashboard } from '../services/autoTrading/autoTradingMapper';
import type { AutoTradingDashboardState } from '../services/autoTrading/autoTradingTypes';

interface UseAutoTradingDashboardResult {
  data: AutoTradingDashboardState | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useAutoTradingDashboard(): UseAutoTradingDashboardResult {
  const [data, setData] = useState<AutoTradingDashboardState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const raw = await fetchAutoTradingDashboard();
      const mapped = mapAutoTradingDashboard(raw);
      setData(mapped);
    } catch (err) {
      console.error(err);
      setError('자동매매 대시보드를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    data,
    loading,
    error,
    refresh,
  };
}
