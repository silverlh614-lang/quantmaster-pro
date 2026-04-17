import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchCurrentPrice } from '../services/stockService';
import { resolveShadowTrade } from '../services/autoTrading';
import { useTradeStore } from '../stores';
import { useShadowTradeStore } from '../stores/useShadowTradeStore';
import type { ShadowTrade } from '../types/quant';
import { autoTradeApi, kisApi } from '../api';
import type { DartAlert } from '../api';
import { usePolledFetch } from './usePolledFetch';

const FIVE_MINUTES = 5 * 60 * 1000;

/** 클라이언트 Shadow Trade를 서버에 동기화 */
function syncShadowTradeToServer(trade: ShadowTrade): void {
  autoTradeApi.syncShadowTrade(trade).catch((err) => console.error('[Shadow] 서버 동기화 실패:', err));
}

export function usePortfolioState() {
  const { tradeRecords } = useTradeStore();
  const { addShadowTrade: storeAddShadowTrade, updateShadowTrade, shadowTrades } = useShadowTradeStore();

  // 서버 동기화를 포함하는 addShadowTrade 래퍼
  const addShadowTrade = useCallback((trade: ShadowTrade) => {
    storeAddShadowTrade(trade);
    syncShadowTradeToServer(trade);
  }, [storeAddShadowTrade]);

  // ── KIS Balance (초기 1회 로드만 — 잔고는 자주 변하지 않음) ────────────
  const [kisBalance, setKisBalance] = useState<number>(100_000_000);
  useEffect(() => {
    kisApi.getBalance()
      .then(data => {
        const cash = Number(data.output2?.[0]?.dnca_tot_amt ?? data.output?.dnca_tot_amt ?? 0);
        if (cash > 0) setKisBalance(cash);
      })
      .catch((err) => console.error('[ERROR] KIS 잔고 조회 실패:', err));
  }, []);

  // ── DART Alerts — 공시 알림은 장외에도 들어오므로 alwaysPoll. ─────────
  const [dartAlerts, setDartAlerts] = useState<DartAlert[]>([]);
  usePolledFetch(
    () => autoTradeApi.getDartAlerts().then(setDartAlerts).catch((err) => console.error('[ERROR] DART 알림 조회 실패:', err)),
    { intervalMs: FIVE_MINUTES, alwaysPoll: true },
  );

  // ── Shadow Trade Resolution ─────────────────────────────────────────────
  // 서버 스케줄러가 주(主) 청산 루프를 담당하므로, 클라이언트 루프는 보조 역할.
  // 브라우저 열려 있을 때만 작동하며 서버 루프와 병행해도 안전 (멱등 연산).
  // usePolledFetch 는 안정적 fetcher 를 가정하므로, 최신 shadowTrades 를
  // ref 로 읽어 폴링 인터벌 재생성을 막는다.
  const shadowTradesRef = useRef(shadowTrades);
  shadowTradesRef.current = shadowTrades;

  usePolledFetch(async () => {
    const active = shadowTradesRef.current.filter(
      (t: ShadowTrade) => t.status === 'PENDING' || t.status === 'ACTIVE',
    );
    if (active.length === 0) return;
    for (const trade of active) {
      try {
        const price = await fetchCurrentPrice(trade.stockCode);
        if (!price) continue;
        const updates = resolveShadowTrade(trade, price);
        if (updates && Object.keys(updates).length > 0) updateShadowTrade(trade.id, updates);
      } catch (e) {
        console.error(`[Shadow] ${trade.stockCode} resolve 실패:`, e);
      }
    }
  }, { intervalMs: FIVE_MINUTES, alwaysPoll: true });

  return {
    tradeRecords,
    shadowTrades,
    addShadowTrade,
    updateShadowTrade,
    kisBalance,
    dartAlerts,
  };
}
