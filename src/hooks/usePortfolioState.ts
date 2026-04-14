import { useState, useEffect, useCallback } from 'react';
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

/** 클라이언트 Shadow Trade를 서버에 동기화 */
function syncShadowTradeToServer(trade: ShadowTrade): void {
  fetch('/api/auto-trade/shadow-trades', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(trade),
  }).catch((err) => console.error('[Shadow] 서버 동기화 실패:', err));
}

export function usePortfolioState() {
  const { tradeRecords } = useTradeStore();
  const { addShadowTrade: storeAddShadowTrade, updateShadowTrade, shadowTrades } = useShadowTradeStore();

  // 서버 동기화를 포함하는 addShadowTrade 래퍼
  const addShadowTrade = useCallback((trade: ShadowTrade) => {
    storeAddShadowTrade(trade);
    syncShadowTradeToServer(trade);
  }, [storeAddShadowTrade]);

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
  // 서버 스케줄러가 주(主) 청산 루프를 담당하므로, 클라이언트 루프는 보조 역할.
  // 브라우저 열려 있을 때만 작동하며 서버 루프와 병행해도 안전 (멱등 연산).
  const activeTradeCount = shadowTrades.filter((t: ShadowTrade) => t.status === 'PENDING' || t.status === 'ACTIVE').length;
  useEffect(() => {
    if (activeTradeCount === 0) return;
    const activeTrades = shadowTrades.filter((t: ShadowTrade) => t.status === 'PENDING' || t.status === 'ACTIVE');

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
  }, [activeTradeCount]);

  return {
    tradeRecords,
    shadowTrades,
    addShadowTrade,
    updateShadowTrade,
    kisBalance,
    dartAlerts,
  };
}
