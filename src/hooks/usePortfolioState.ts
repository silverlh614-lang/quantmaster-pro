import { useState, useEffect } from 'react';
import { useTradeStore } from '../stores';
import { useShadowTradeStore } from '../stores/useShadowTradeStore';
import { autoTradeApi, kisApi } from '../api';
import type { DartAlert } from '../api';
import { usePolledFetch } from './usePolledFetch';

const FIVE_MINUTES = 5 * 60 * 1000;

/**
 * 자동매매·포트폴리오 주변 원격 상태(DART 알림 / KIS 잔고)와 Shadow Trade
 * 캐시 hydrate 를 관리하는 훅. 대시보드 단에서 한 번만 호출하면 된다.
 *
 * Shadow trade mutation·resolve 는 더 이상 여기서 다루지 않는다
 * (서버 스케줄러가 단일 진실 원천, 스토어 내부에서 서버 동기화 처리).
 */
export function usePortfolioState() {
  const { tradeRecords } = useTradeStore();
  const { shadowTrades, addShadowTrade, updateShadowTrade, hydrateFromServer } =
    useShadowTradeStore();

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

  // ── Shadow Trade 캐시 hydrate ─────────────────────────────────────────
  // 서버 스케줄러가 결정권자 → 클라이언트 스토어는 읽기 중심 캐시.
  // 5분 주기로 서버 상태를 반영해 UI 와 자동매매 사이의 drift 를 차단한다.
  usePolledFetch(() => hydrateFromServer(), { intervalMs: FIVE_MINUTES, alwaysPoll: true });

  return {
    tradeRecords,
    shadowTrades,
    /** 로컬 + 서버 동기화 (스토어 내부에서 처리). */
    addShadowTrade,
    /** 낙관적 UI 패치용. 다음 hydrate 에서 서버 상태로 덮임. */
    updateShadowTrade,
    kisBalance,
    dartAlerts,
  };
}
