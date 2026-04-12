/**
 * useAutoSync.ts — 글로벌 스캔 보고서 자동 동기화 훅
 *
 * 서버의 /api/market/global-scan 엔드포인트를 폴링해
 * 매일 KST 06:00에 생성된 간밤 시장 분석 보고서를 가져온다.
 *
 * 사용 예:
 *   const { report, loading, refresh } = useAutoSync();
 */

import { useState, useEffect, useCallback } from 'react';

export interface GlobalSymbolResult {
  symbol:    string;
  label:     string;
  price:     number | null;
  changePct: number | null;
}

export interface SectorAlert {
  symbol:       string;
  label:        string;
  changePct:    number;
  direction:    'BULLISH' | 'BEARISH';
  koreaSectors: string;
  leadDays:     string;
  alertType:    'EWY_FOREIGN' | 'SECTOR_FLOW';  // Layer 13 | Layer 14
}

export interface GlobalScanReport {
  createdAt:    string;
  symbols:      GlobalSymbolResult[];
  vix:          number | null;
  aiSummary:    string | null;
  sectorAlerts: SectorAlert[];  // Layer 13·14 경보 목록
}

const POLL_INTERVAL_MS = 10 * 60 * 1000; // 10분 간격 폴링

export function useAutoSync() {
  const [report,  setReport]  = useState<GlobalScanReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/market/global-scan');
      if (res.status === 404) {
        // 보고서 미생성 (KST 06:00 이전) — 에러 아님
        setReport(null);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: GlobalScanReport = await res.json();
      setReport(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : '글로벌 스캔 조회 실패');
    } finally {
      setLoading(false);
    }
  }, []);

  // 마운트 시 즉시 조회 + 10분 간격 폴링
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return { report, loading, error, refresh };
}
