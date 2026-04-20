/**
 * thresholdSearchLoop.ts — Phase 5-⑪ 빈스캔 5회 → 자동 임계치 탐색 루프.
 *
 * 기존 adaptiveScanScheduler 는 빈스캔 5회 누적 시 ①간격만 ×2 확대하고
 * ②"Gate 임계치 점검 필요" 진단 메시지만 출력했다. 실제 조정은 수동으로만 가능.
 *
 * 이 모듈은 5회 누적 시점에 다음을 자동 실행한다:
 *   1) 워치리스트 gate 분포 히스토그램 계산
 *   2) 임계치를 0.5pt 일시 하향한 섀도우 드라이런 수행
 *   3) 드라이런에서 ≥5건 포착되면 "하향 제안" 을 Telegram 으로 전송
 *      (최종 적용은 기존 Decision Broker 버튼 — 인간 승인 유지)
 *
 * 과적합 방지:
 *   - 세션당 최대 1회 실행 (_sessionExecuted)
 *   - 제안 하향 폭은 1pt 까지 (user spec)
 */

export const THRESHOLD_SEARCH_DRY_DELTA = -0.5;
export const THRESHOLD_SEARCH_MAX_TOTAL_DELTA = -1.0;
export const THRESHOLD_SEARCH_MIN_CAPTURES_FOR_PROPOSAL = 5;

export interface GateScoreBinCounts {
  '<4': number;
  '4-5': number;
  '5-6': number;
  '6-7': number;
  '7-8': number;
  '8+': number;
}

/**
 * gateScore 배열을 0.5pt 버킷으로 히스토그램화.
 * 빈 배열이면 모든 버킷 0.
 */
export function buildGateHistogram(scores: number[]): GateScoreBinCounts {
  const h: GateScoreBinCounts = { '<4': 0, '4-5': 0, '5-6': 0, '6-7': 0, '7-8': 0, '8+': 0 };
  for (const s of scores) {
    if (!Number.isFinite(s)) continue;
    if (s < 4) h['<4']++;
    else if (s < 5) h['4-5']++;
    else if (s < 6) h['5-6']++;
    else if (s < 7) h['6-7']++;
    else if (s < 8) h['7-8']++;
    else h['8+']++;
  }
  return h;
}

/**
 * 히스토그램을 Telegram 메시지로 포맷 (HTML).
 */
export function formatGateHistogram(h: GateScoreBinCounts, total: number): string {
  const bar = (n: number) => '█'.repeat(Math.min(20, n)) || '·';
  return (
    `Gate Score 분포 (n=${total})\n` +
    `  <4   : ${bar(h['<4'])}  ${h['<4']}\n` +
    `  4-5  : ${bar(h['4-5'])}  ${h['4-5']}\n` +
    `  5-6  : ${bar(h['5-6'])}  ${h['5-6']}\n` +
    `  6-7  : ${bar(h['6-7'])}  ${h['6-7']}\n` +
    `  7-8  : ${bar(h['7-8'])}  ${h['7-8']}\n` +
    `  8+   : ${bar(h['8+'])}  ${h['8+']}`
  );
}

/**
 * 후보 gate score 들을 상상된 임계치(기준 - |delta|)로 가정할 때 통과할 건수.
 *   delta 는 음수 — 예: -0.5 는 "임계치 0.5pt 하향"
 */
export function projectCapturesAtLoweredThreshold(
  scores: number[],
  baselineThreshold: number,
  delta: number,
): number {
  const projected = baselineThreshold + delta;
  return scores.filter((s) => Number.isFinite(s) && s >= projected).length;
}

export interface ThresholdProposal {
  /** 이번 주기에 실행되어야 하는지 */
  shouldPropose: boolean;
  /** 제안 delta (예: -0.5) — shouldPropose 가 true 일 때만 의미 */
  proposedDelta: number;
  /** 드라이런에서 확보 가능한 건수 */
  projectedCaptures: number;
  /** 이유 (운영 로그 및 Telegram) */
  reason: string;
  /** gate 분포 스냅샷 */
  histogram: GateScoreBinCounts;
  /** 총 평가 표본 수 */
  total: number;
}

/**
 * 순수 의사결정 — 임계치 하향 제안 생성.
 * delta 는 기본 THRESHOLD_SEARCH_DRY_DELTA(=-0.5pt). 현재 누적 delta 가 이미 -1pt
 * 에 도달했으면 shouldPropose=false.
 */
export function buildThresholdProposal(params: {
  scores: number[];
  baselineThreshold: number;
  currentDelta: number; // 현재까지 적용된 누적 델타(음수)
  dryDelta?: number;
}): ThresholdProposal {
  const dryDelta = params.dryDelta ?? THRESHOLD_SEARCH_DRY_DELTA;
  const histogram = buildGateHistogram(params.scores);
  const total = params.scores.length;

  // 이미 누적 한도(-1pt)에 도달하면 더는 하향 제안하지 않음
  const wouldBeTotal = params.currentDelta + dryDelta;
  if (wouldBeTotal < THRESHOLD_SEARCH_MAX_TOTAL_DELTA) {
    return {
      shouldPropose: false, proposedDelta: dryDelta, projectedCaptures: 0,
      reason: `누적 델타 한도 초과 방지 (현재 ${params.currentDelta.toFixed(2)} + 제안 ${dryDelta} < ${THRESHOLD_SEARCH_MAX_TOTAL_DELTA})`,
      histogram, total,
    };
  }

  const captures = projectCapturesAtLoweredThreshold(params.scores, params.baselineThreshold, dryDelta);
  if (captures < THRESHOLD_SEARCH_MIN_CAPTURES_FOR_PROPOSAL) {
    return {
      shouldPropose: false, proposedDelta: dryDelta, projectedCaptures: captures,
      reason: `섀도우 드라이런 포착 ${captures}건 < ${THRESHOLD_SEARCH_MIN_CAPTURES_FOR_PROPOSAL}건 — 하향 효과 미미, 제안 보류`,
      histogram, total,
    };
  }

  return {
    shouldPropose: true, proposedDelta: dryDelta, projectedCaptures: captures,
    reason: `임계치 ${params.baselineThreshold.toFixed(1)} → ${(params.baselineThreshold + dryDelta).toFixed(1)} 하향 시 ${captures}건 추가 포착 예상`,
    histogram, total,
  };
}

// ── 세션별 실행 제한 ──────────────────────────────────────────────────────────
// adaptiveScanScheduler 가 이 모듈을 호출할 때 세션당 1회만 실행되도록 가드.

let _sessionExecutedAtMs = 0;

/**
 * 같은 "세션"(KST 일자 기준) 안에서 이미 실행됐으면 true.
 */
export function alreadyExecutedThisSession(now = Date.now()): boolean {
  if (_sessionExecutedAtMs === 0) return false;
  const kstNow = new Date(now + 9 * 3_600_000);
  const kstLast = new Date(_sessionExecutedAtMs + 9 * 3_600_000);
  return kstNow.toISOString().slice(0, 10) === kstLast.toISOString().slice(0, 10);
}

export function markSessionExecuted(now = Date.now()): void {
  _sessionExecutedAtMs = now;
}

export function _resetThresholdSearchSession(): void {
  _sessionExecutedAtMs = 0;
}
