/**
 * @responsibility KIS 전일종가 기반 장전 갭 추정 - 2%/30% 임계로 PROCEED/WARN/SKIP 분류
 *
 * ADR-0004: Yahoo ADR 역산 폐기 대체 경로.
 * preMarketOrderPrep() 가 각 워치리스트 종목에 대해 probe 를 호출하고
 * decision 에 따라 주문 진행/경보/스킵을 결정한다.
 *
 * 결정 규칙:
 *   - fetchKisPrevClose 실패       → SKIP_NO_DATA
 *   - tradingDate 2영업일 이상 과거 → SKIP_STALE
 *   - |gapPct| >= 30              → SKIP_DATA_ERROR (명백한 데이터 오류)
 *   - |gapPct| >= 2               → WARN (진행 — 갭 경보만 부착)
 *   - 그 외                        → PROCEED
 */

import { fetchKisPrevClose } from '../clients/kisClient.js';

// ── 임계값 ────────────────────────────────────────────────────────────────────

export const GAP_WARN_PCT = 2;
export const GAP_DATA_ERROR_PCT = 30;
/** tradingDate 가 오늘 KST 기준 N영업일 이상 과거면 stale 로 간주. */
export const MAX_STALENESS_BUSINESS_DAYS = 2;

// ── 타입 ──────────────────────────────────────────────────────────────────────

export interface GapProbeInput {
  stockCode:  string;
  entryPrice: number;
}

export type GapProbeDecision =
  | 'PROCEED'
  | 'WARN'
  | 'SKIP_DATA_ERROR'
  | 'SKIP_STALE'
  | 'SKIP_NO_DATA';

export interface GapProbeResult {
  stockCode:   string;
  prevClose:   number | null;
  /** (entryPrice - prevClose) / prevClose * 100 — null 이면 계산 불가. */
  gapPct:      number | null;
  decision:    GapProbeDecision;
  reason?:     string;
  /** KRX 영업일 (YYYY-MM-DD) — SKIP_STALE 사유 재구성·텔레그램 메시지에 사용. */
  tradingDate?: string;
}

// ── 영업일 계산 ──────────────────────────────────────────────────────────────

/**
 * 오늘 KST 기준 tradingDate 와의 영업일 격차 (오늘=0, 어제=1, 그저께=2, ...).
 * 토·일은 건너뛴다. 한국 공휴일은 별도 달력 없이 주말만 반영 — 공휴일 당일은
 * "어제"처럼 보이지만 실제로는 2영업일 전일 수 있으므로 경계 오차 1일 허용.
 */
export function businessDaysBetween(tradingDate: string, now: Date = new Date()): number {
  // KST 오늘 YYYY-MM-DD
  const todayKstStr = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (tradingDate === todayKstStr) return 0;

  // 주말 제외 카운트 — 단순 루프로 충분 (최대 ~10일 탐색).
  const [ty, tm, td] = tradingDate.split('-').map(Number);
  const tradingMs = Date.UTC(ty, (tm ?? 1) - 1, td ?? 1);
  // todayKstStr 자체를 UTC 자정으로 해석해 두 UTC 자정 사이의 달력일 수 계산.
  const [cy, cm, cd] = todayKstStr.split('-').map(Number);
  const todayMs = Date.UTC(cy, (cm ?? 1) - 1, cd ?? 1);
  const calendarDiff = Math.round((todayMs - tradingMs) / (24 * 60 * 60 * 1000));
  if (calendarDiff <= 0) return 0;

  let businessDays = 0;
  for (let i = 1; i <= calendarDiff; i++) {
    const d = new Date(tradingMs + i * 24 * 60 * 60 * 1000);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) businessDays += 1;
  }
  return businessDays;
}

// ── 메인 probe ────────────────────────────────────────────────────────────────

/**
 * preMarket 경로에서 각 종목의 entryPrice 대비 전일종가 갭을 평가한다.
 * 호출측은 `result.decision` 으로 분기:
 *   - PROCEED         → 주문 진행
 *   - WARN            → 주문 진행하되 Telegram 메시지에 갭 경보 첨부
 *   - SKIP_*          → 해당 종목 건너뛰기 + watchlist skipReason 기록
 */
export async function probePreMarketGap(input: GapProbeInput): Promise<GapProbeResult> {
  const { stockCode, entryPrice } = input;

  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    return {
      stockCode,
      prevClose: null,
      gapPct: null,
      decision: 'SKIP_NO_DATA',
      reason: `entryPrice 무효 (${entryPrice})`,
    };
  }

  const prev = await fetchKisPrevClose(stockCode).catch(() => null);
  if (!prev || prev.prevClose <= 0) {
    return {
      stockCode,
      prevClose: null,
      gapPct: null,
      decision: 'SKIP_NO_DATA',
      reason: 'KIS 전일종가 조회 실패',
    };
  }

  const stalenessDays = businessDaysBetween(prev.tradingDate);
  if (stalenessDays >= MAX_STALENESS_BUSINESS_DAYS) {
    return {
      stockCode,
      prevClose: prev.prevClose,
      gapPct: null,
      decision: 'SKIP_STALE',
      reason: `전일종가 ${stalenessDays}영업일 전 (${prev.tradingDate})`,
      tradingDate: prev.tradingDate,
    };
  }

  const gapPct = ((entryPrice - prev.prevClose) / prev.prevClose) * 100;
  const absGap = Math.abs(gapPct);

  if (absGap >= GAP_DATA_ERROR_PCT) {
    return {
      stockCode,
      prevClose: prev.prevClose,
      gapPct,
      decision: 'SKIP_DATA_ERROR',
      reason: `|Gap|=${absGap.toFixed(1)}% >= ${GAP_DATA_ERROR_PCT}% — 데이터 오류 의심`,
      tradingDate: prev.tradingDate,
    };
  }

  if (absGap >= GAP_WARN_PCT) {
    return {
      stockCode,
      prevClose: prev.prevClose,
      gapPct,
      decision: 'WARN',
      reason: `|Gap|=${absGap.toFixed(1)}% (경보 — 진행)`,
      tradingDate: prev.tradingDate,
    };
  }

  return {
    stockCode,
    prevClose: prev.prevClose,
    gapPct,
    decision: 'PROCEED',
    tradingDate: prev.tradingDate,
  };
}
