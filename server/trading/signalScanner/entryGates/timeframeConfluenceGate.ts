// @responsibility Multi-Timeframe Signal Confluence 게이트 — 30분/일/주봉 일목+MA20 정렬 합치도 검증
/**
 * ADR-0067 (PR-Q, 페어 B #2):
 * 사용자 분석 — 같은 SWING 후보가 30분/일/주봉에서 동시 정렬될 때가 진짜 고승률.
 * 본 게이트는 ctx.timeframeConfluence 에 주입된 정렬 boolean 카운트:
 *
 *   3/3 → PASS + STRONG (confluence=3, 강한 신호)
 *   2/3 → PASS + STANDARD (confluence=2, CONVICTION 권장)
 *   1/3 → PASS + WARN (confluence=1, PROBING 권장)
 *   0/3 → FAIL (다중 시간프레임 부정렬)
 *   데이터 부재 → PASS (skip)
 *
 * 데이터 주입 wiring (perSymbolEvaluation 의 stock 객체에 timeframe 정렬 첨부)
 * 은 후속 PR. 본 모듈은 차단 로직 + 메시지 SSOT 만.
 *
 * 환경변수 ENTRY_TIMEFRAME_CONFLUENCE_DISABLED=true → 항상 PASS.
 */
import type { EntryGate, TimeframeAlignment } from './types.js';

/** 본 게이트가 차단하는 최저 confluence 임계 — 0/3 미만 = 모두 미정렬 */
export const CONFLUENCE_BLOCK_THRESHOLD = 0;
/** PROBING 권장 임계 (1/3 통과) */
export const CONFLUENCE_PROBING_THRESHOLD = 1;
/** STANDARD 권장 임계 (2/3 통과) */
export const CONFLUENCE_STANDARD_THRESHOLD = 2;

function isDisabled(): boolean {
  if (typeof process === 'undefined' || !process.env) return false;
  return process.env.ENTRY_TIMEFRAME_CONFLUENCE_DISABLED === 'true';
}

/**
 * 정의된 timeframe 중 정렬 통과 카운트 + 평가 가능 timeframe 총 개수.
 * undefined 인 timeframe 은 분모에서 제외 — 부분 데이터에 안전.
 */
export function countTimeframeAlignment(
  tf: TimeframeAlignment | undefined,
): { passedCount: number; totalCount: number } {
  if (!tf) return { passedCount: 0, totalCount: 0 };
  let passed = 0;
  let total = 0;
  for (const v of [tf.daily, tf.weekly, tf.intraday30m]) {
    if (typeof v === 'boolean') {
      total += 1;
      if (v) passed += 1;
    }
  }
  return { passedCount: passed, totalCount: total };
}

export const timeframeConfluenceGate: EntryGate = (ctx) => {
  // ENV 무력화 → 항상 PASS
  if (isDisabled()) {
    return { pass: true };
  }

  const { passedCount, totalCount } = countTimeframeAlignment(ctx.timeframeConfluence);

  // 데이터 부재 (totalCount=0) → 게이트 skip (wiring 전 안전 fallback)
  if (totalCount === 0) {
    return { pass: true };
  }

  const stockName = ctx.stock?.name ?? ctx.stock?.code ?? '?';

  // 0/N → 차단
  if (passedCount <= CONFLUENCE_BLOCK_THRESHOLD) {
    return {
      pass: false,
      logMessage: `[AutoTrade] ${stockName} 다중 시간프레임 부정렬 (confluence=${passedCount}/${totalCount})`,
      stageLog: { key: 'timeframeConfluence', value: `FAIL(${passedCount}/${totalCount})` },
      counter: 'gateMisses',
      pushTrace: true,
    };
  }

  // 통과 — confluence 수치를 후속 sizingDecider 가 사용 (현재는 로그만)
  let recommendation: string;
  if (passedCount >= CONFLUENCE_STANDARD_THRESHOLD) {
    recommendation = `confluence=${passedCount}/${totalCount} — CONVICTION 권장`;
  } else if (passedCount >= CONFLUENCE_PROBING_THRESHOLD) {
    recommendation = `confluence=${passedCount}/${totalCount} — PROBING 권장`;
  } else {
    recommendation = `confluence=${passedCount}/${totalCount}`;
  }

  return {
    pass: true,
    passLogMessage: `[AutoTrade] ${stockName} 다중 시간프레임 ${recommendation}`,
  };
};
