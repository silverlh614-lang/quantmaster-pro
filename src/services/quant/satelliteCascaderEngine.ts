/**
 * satelliteCascaderEngine.ts — 위성 종목 연쇄 추적 시스템 (Satellite Stock Cascader)
 *
 * 핵심 개념:
 *   주도주가 Gate 3까지 통과해 매수 진입되면, 동일 섹터 내 지연 반응 종목(Laggard)을
 *   자동으로 추적해 2차·3차 진입 기회를 시스템적으로 포착한다.
 *
 * 지연 진입 신호 조건:
 *   1. 주도주 대비 RS 20% 이상 낮은 상태 (rsDelta ≤ -20)
 *   2. 최근 7일 RS 추이가 양수 (따라잡기 시작)
 *   3. 주도주 본격 상승 후 4~8주 구간 (역사적 평균 패턴)
 *
 * 거래량 확인:
 *   거래량 배율 ≥ 1.3이면 신호 강도 상승
 */

import type {
  SatelliteStock,
  SatelliteCascaderInput,
  SatelliteCascaderResult,
  SatelliteStockInput,
} from '../../types/satellite';

// ─── 상수 ──────────────────────────────────────────────────────────────────────

/** 지연 진입 신호를 위한 최소 RS 갭 (주도주 대비 %) */
const LAGGARD_RS_GAP = -20;

/** 따라잡기 추이의 최소 임계값 (RS 점수 포인트) */
const RS_TREND_MIN = 0.5;

/** 역사적 패턴: 2차 수혜주 진입 윈도우 (주) */
const ENTRY_WINDOW_START = 4;
const ENTRY_WINDOW_END = 8;

/** 거래량 확인 배율 기준 */
const VOLUME_CONFIRM_MULTIPLIER = 1.3;

// ─── 유틸 ──────────────────────────────────────────────────────────────────────

function calcWeeksElapsed(entryDateIso: string): number {
  const ms = Date.now() - new Date(entryDateIso).getTime();
  return Math.max(0, parseFloat((ms / (1000 * 60 * 60 * 24 * 7)).toFixed(1)));
}

function classifyEntryWindow(weeks: number): SatelliteStock['expectedEntryWindow'] {
  if (weeks < ENTRY_WINDOW_START) return 'TOO_EARLY';
  if (weeks <= ENTRY_WINDOW_END) return 'ENTRY_WINDOW';
  return 'LATE';
}

function evaluateSatellite(
  input: SatelliteStockInput,
  leaderRsScore: number,
  leaderSector: string,
  weeksElapsed: number,
): SatelliteStock {
  const rsDelta = parseFloat((input.rsScore - leaderRsScore).toFixed(1));
  const entryWindow = classifyEntryWindow(weeksElapsed);

  // 지연 진입 신호: RS 갭이 충분히 크고, 따라잡기 추이 시작, 진입 윈도우 내
  const laggardSignal =
    rsDelta <= LAGGARD_RS_GAP &&
    input.rsTrend >= RS_TREND_MIN &&
    entryWindow === 'ENTRY_WINDOW';

  return {
    code: input.code,
    name: input.name,
    sector: leaderSector,
    rsScore: input.rsScore,
    rsDelta,
    rsTrend: input.rsTrend,
    weeksAfterLeader: weeksElapsed,
    laggardSignal,
    expectedEntryWindow: entryWindow,
    volumeMultiple: input.volumeMultiple,
  };
}

// ─── 메인 평가 함수 ────────────────────────────────────────────────────────────

export function evaluateSatelliteCascader(
  input: SatelliteCascaderInput,
): SatelliteCascaderResult {
  const weeksElapsed = calcWeeksElapsed(input.leaderEntryDate);

  const satellites = input.satellites
    .map((s) =>
      evaluateSatellite(s, input.leaderRsScore, input.leaderSector, weeksElapsed),
    )
    .sort((a, b) => {
      // 지연 진입 신호 우선, 그 다음 RS 점수 내림차순
      if (a.laggardSignal !== b.laggardSignal) return a.laggardSignal ? -1 : 1;
      return b.rsScore - a.rsScore;
    });

  const activeSignalCount = satellites.filter((s) => s.laggardSignal).length;
  const entryWindowCount = satellites.filter(
    (s) => s.expectedEntryWindow === 'ENTRY_WINDOW',
  ).length;

  let summary: string;
  if (weeksElapsed < ENTRY_WINDOW_START) {
    summary = `주도주 진입 후 ${weeksElapsed.toFixed(1)}주 경과 — 2차 수혜주 진입 윈도우(4~8주)까지 ${(ENTRY_WINDOW_START - weeksElapsed).toFixed(1)}주 남음. 관찰 중.`;
  } else if (weeksElapsed <= ENTRY_WINDOW_END) {
    if (activeSignalCount > 0) {
      const volumeConfirmed = satellites.filter(
        (s) => s.laggardSignal && s.volumeMultiple >= VOLUME_CONFIRM_MULTIPLIER,
      ).length;
      summary = `진입 윈도우 활성(${weeksElapsed.toFixed(1)}주 경과) — 지연 진입 신호 ${activeSignalCount}건 포착, 거래량 확인 ${volumeConfirmed}건. 매수 검토.`;
    } else {
      summary = `진입 윈도우 활성(${weeksElapsed.toFixed(1)}주 경과) — RS 따라잡기 신호 미포착. 위성 종목 모니터링 지속.`;
    }
  } else {
    summary = `진입 윈도우 초과(${weeksElapsed.toFixed(1)}주 경과) — 2차 수혜주 상승 가능성 감소. 신규 진입 자제 권고.`;
  }

  return {
    leader: {
      code: input.leaderCode,
      name: input.leaderName,
      sector: input.leaderSector,
      rsScore: input.leaderRsScore,
      entryDate: input.leaderEntryDate,
      weeksElapsed,
    },
    satellites,
    activeSignalCount,
    entryWindowCount,
    summary,
    calculatedAt: new Date().toISOString(),
  };
}
