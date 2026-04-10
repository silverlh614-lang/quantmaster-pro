import { useState, useEffect } from 'react';
import { fetchCurrentPrice } from '../services/stockService';
import { resolveShadowTrade } from '../services/autoTrading';
import { useTradeStore } from '../stores';
import { useShadowTradeStore } from '../stores/useShadowTradeStore';
import type { ShadowTrade } from '../types/quant';

interface DartAlert {
  corp_name: string;
  stock_code: string;
  report_nm: string;
  rcept_dt: string;
  sentiment: string;
}

export function usePortfolioState() {
  const { tradeRecords } = useTradeStore();
  const { addShadowTrade, updateShadowTrade, shadowTrades } = useShadowTradeStore();

  // ── KIS Balance ─────────────────────────────────────────────────────────
  const [kisBalance, setKisBalance] = useState<number>(100_000_000);
  useEffect(() => {
    fetch('/api/kis/balance')
      .then(res => res.json())
      .then(data => {
        const cash = Number(data.output2?.[0]?.dnca_tot_amt ?? data.output?.dnca_tot_amt ?? 0);
        if (cash > 0) setKisBalance(cash);
      })
      .catch((err) => console.error('[ERROR] KIS 잔고 조회 실패:', err));
  }, []);

  // ── DART Alerts ─────────────────────────────────────────────────────────
  const [dartAlerts, setDartAlerts] = useState<DartAlert[]>([]);
  useEffect(() => {
    const fetchDart = () => {
      fetch('/api/auto-trade/dart-alerts').then(r => r.json()).then(setDartAlerts).catch((err) => console.error('[ERROR] DART 알림 조회 실패:', err));
    };
    fetchDart();
    const interval = setInterval(fetchDart, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // ── Shadow Trade Resolution ─────────────────────────────────────────────
  useEffect(() => {
    const activeTrades = shadowTrades.filter((t: ShadowTrade) => t.status === 'PENDING' || t.status === 'ACTIVE');
    if (activeTrades.length === 0) return;

    const resolveTrades = async () => {
      for (const trade of activeTrades) {
        try {
          const price = await fetchCurrentPrice(trade.stockCode);
          if (!price) continue;
          const updates = resolveShadowTrade(trade, price);
          if (updates && Object.keys(updates).length > 0) updateShadowTrade(trade.id, updates);
        } catch (e) {
          console.error(`[Shadow] ${trade.stockCode} resolve 실패:`, e);
        }
      }
    };

    resolveTrades();
    const interval = setInterval(resolveTrades, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [shadowTrades.filter((t: ShadowTrade) => t.status === 'PENDING' || t.status === 'ACTIVE').length]);

  return {
    tradeRecords,
    shadowTrades,
    addShadowTrade,
    updateShadowTrade,
    kisBalance,
    dartAlerts,
  };
}
