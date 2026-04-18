/**
 * emptyScanPostmortem.ts — 정상성/병리 자가판별기
 *
 * 빈 스캔 3회 누적 시마다 자동 실행하여 "이 상황이 기능인지 버그인지"를
 * 엔진 스스로 판정한다. 단순 백오프보다 먼저 원인을 구분하여 HEALTHY_REJECTION
 * (레짐에 따른 정상 거부)과 PATHOLOGICAL_BLOCK(게이트 과도 타이트 등 병리)
 * 을 분리한다.
 *
 * 입력:
 *   - 최근 3회 스캔의 trace 묶음 (scanTracer)
 *   - 현재 live regime (regimeBridge)
 *   - gate audit 당일 집계 (gateAuditRepo)
 *
 * 판정 규칙:
 *   1) RISK_OFF (R5_CAUTION / R6_DEFENSE) AND scanCandidates == 0
 *      → HEALTHY_REJECTION: 레짐이 거부한 것. 백오프 대신 대기가 맞음.
 *   2) RISK_ON (R1_TURBO / R2_BULL / R3_EARLY) AND
 *      gateReached > 0 AND (gateFail / gateReached) > 0.95
 *      → PATHOLOGICAL_BLOCK: 시장은 열려있는데 게이트가 닫혀있다.
 *   3) 그 외: 지배 원인(dominantCause)을 산출 — Yahoo 장애, 특정 조건 과도 타이트,
 *      RRR 미달 등을 스캔 trace + gate audit top-blocker 교차로 추정.
 */

import type { RegimeLevel } from '../../src/types/core.js';
import { loadMacroState } from '../persistence/macroStateRepo.js';
import { getLiveRegime } from '../trading/regimeBridge.js';
import {
  loadTodayScanTraces,
  type ScanTrace,
} from '../trading/scanTracer.js';
import { loadGateAudit } from '../persistence/gateAuditRepo.js';

// ── 타입 ──────────────────────────────────────────────────────────────────────

export type PostmortemVerdict = 'HEALTHY_REJECTION' | 'PATHOLOGICAL_BLOCK' | 'INDETERMINATE';

export type DominantCause =
  | 'REGIME_RISK_OFF'
  | 'YAHOO_DOWN'
  | 'GATE_TIGHT'
  | 'PRICE_FAIL'
  | 'RRR_INSUFFICIENT'
  | 'NO_CANDIDATES'
  | 'UNKNOWN';

export type RecommendedAction =
  | 'HOLD_AND_WAIT'      // 레짐에 맞는 정상 거부 — 대기.
  | 'LOOSEN_GATE'        // 게이트 타이트니스 완화 고려.
  | 'CHECK_DATA_SOURCE'  // Yahoo 등 외부 데이터 소스 점검.
  | 'INSPECT_CANDIDATES' // 후보 자체가 안 들어옴 — Stage1 점검.
  | 'NONE';

export interface PostmortemReport {
  verdict: PostmortemVerdict;
  dominantCause: DominantCause;
  recommendedAction: RecommendedAction;
  regime: RegimeLevel;
  metrics: {
    scanCandidates: number;
    gateReached: number;
    gateFail: number;
    gateFailRatio: number;  // 0~1
    yahooFail: number;
    priceFail: number;
    rrrFail: number;
    buyExecuted: number;
  };
  topBlockerCondition: string | null;
  topBlockerFailRate: number;  // 0~1
  reason: string;
  analyzedAt: string;  // ISO
}

// ── 레짐 분류 ─────────────────────────────────────────────────────────────────

const RISK_OFF_REGIMES: readonly RegimeLevel[] = ['R5_CAUTION', 'R6_DEFENSE'];
const RISK_ON_REGIMES:  readonly RegimeLevel[] = ['R1_TURBO', 'R2_BULL', 'R3_EARLY'];

function isRiskOff(r: RegimeLevel): boolean { return RISK_OFF_REGIMES.includes(r); }
function isRiskOn(r: RegimeLevel):  boolean { return RISK_ON_REGIMES.includes(r); }

// ── 누적 상태: 빈 스캔 3회 도달 시에만 포스트모템 수행 ───────────────────────

let _emptyScanCount = 0;
let _lastReport: PostmortemReport | null = null;

const POSTMORTEM_TRIGGER_EVERY = 3;

/** 외부에서 빈 스캔 발생을 통지. 3회마다 자동 분석 수행. */
export function notifyEmptyScan(): PostmortemReport | null {
  _emptyScanCount++;
  if (_emptyScanCount % POSTMORTEM_TRIGGER_EVERY !== 0) return null;
  const report = runPostmortem();
  _lastReport = report;
  return report;
}

/** 신호가 발생하면 카운터 리셋. */
export function resetEmptyScanCounter(): void {
  _emptyScanCount = 0;
}

/** 최근 리포트 조회 (진단 API 용). */
export function getLastPostmortemReport(): PostmortemReport | null {
  return _lastReport;
}

/** 테스트·진단용 카운터 값. */
export function getEmptyScanCount(): number {
  return _emptyScanCount;
}

// ── 유틸: 최근 N회 스캔 trace 묶음 ──────────────────────────────────────────

/**
 * 오늘 trace 중 최근 구간을 추출한다.
 * scanTracer는 스캔 배치 경계를 명시적으로 저장하지 않으므로, 한 배치가
 * 통상 20~80 종목이라는 점에 기대어 마지막 RECENT_TRACE_WINDOW 개를 근사치로 사용한다.
 * (빈 스캔 3회 트리거 시점의 "직전 3회" 샘플과 대체로 일치.)
 */
const RECENT_TRACE_WINDOW = 240;
function recentTraces(all: ScanTrace[]): ScanTrace[] {
  if (all.length <= RECENT_TRACE_WINDOW) return all;
  return all.slice(-RECENT_TRACE_WINDOW);
}

// ── 지배 원인 + 추천 액션 결정 ────────────────────────────────────────────────

interface Metrics {
  scanCandidates: number;
  gateReached:   number;
  gateFail:      number;
  gateFailRatio: number;
  yahooFail:     number;
  priceFail:     number;
  rrrFail:       number;
  buyExecuted:   number;
}

function summarize(traces: ScanTrace[]): Metrics {
  let priceFail = 0, rrrFail = 0, gateFail = 0, yahooFail = 0, buyExecuted = 0;
  for (const t of traces) {
    if (t.stages.buy === 'SHADOW' || t.stages.buy === 'LIVE') { buyExecuted++; continue; }
    if (t.stages.price?.startsWith('FAIL'))                   { priceFail++;   continue; }
    if (t.stages.rrr?.startsWith('FAIL'))                     { rrrFail++;     continue; }
    if (t.stages.gate?.startsWith('FAIL(yahoo'))              { yahooFail++;   continue; }
    if (t.stages.gate?.startsWith('FAIL'))                    { gateFail++;    continue; }
  }
  const scanCandidates = traces.length;
  const gateReached    = scanCandidates - yahooFail;
  const gateFailRatio  = gateReached > 0 ? gateFail / gateReached : 0;
  return { scanCandidates, gateReached, gateFail, gateFailRatio, yahooFail, priceFail, rrrFail, buyExecuted };
}

function findTopBlocker(): { key: string | null; failRate: number } {
  const audit = loadGateAudit();
  let worstKey: string | null = null;
  let worstRate = 0;
  for (const [key, s] of Object.entries(audit)) {
    const total = s.passed + s.failed;
    if (total < 5) continue; // 샘플 부족 — 무시
    const rate = s.failed / total;
    if (rate > worstRate) {
      worstRate = rate;
      worstKey = key;
    }
  }
  return { key: worstKey, failRate: worstRate };
}

// ── 메인 분석 ─────────────────────────────────────────────────────────────────

/**
 * 현재 상태의 스냅샷 기반 포스트모템 실행.
 * 외부에서 직접 호출 가능 (예: 진단 API).
 */
export function runPostmortem(): PostmortemReport {
  const regime   = getLiveRegime(loadMacroState());
  const traces   = recentTraces(loadTodayScanTraces());
  const metrics  = summarize(traces);
  const blocker  = findTopBlocker();

  // ── 판정 ────────────────────────────────────────────────────────────────
  let verdict: PostmortemVerdict;
  let cause:   DominantCause;
  let action:  RecommendedAction;
  let reason:  string;

  if (isRiskOff(regime) && metrics.scanCandidates === 0) {
    verdict = 'HEALTHY_REJECTION';
    cause   = 'REGIME_RISK_OFF';
    action  = 'HOLD_AND_WAIT';
    reason  = `${regime} 레짐 — 매수 거부는 설계대로의 기능 동작. 백오프 불필요, 대기.`;
  } else if (isRiskOn(regime) && metrics.gateReached > 0 && metrics.gateFailRatio > 0.95) {
    verdict = 'PATHOLOGICAL_BLOCK';
    cause   = 'GATE_TIGHT';
    action  = 'LOOSEN_GATE';
    reason  = (
      `${regime}에서 gateFail/gateReached=${(metrics.gateFailRatio * 100).toFixed(1)}% — ` +
      `레짐은 매수 가능인데 게이트가 과도하게 타이트. 임계치 완화 검토.` +
      (blocker.key ? ` 가장 타이트한 조건: ${blocker.key} (실패율 ${(blocker.failRate * 100).toFixed(1)}%).` : '')
    );
  } else if (metrics.scanCandidates > 0 && metrics.yahooFail === metrics.scanCandidates) {
    verdict = 'PATHOLOGICAL_BLOCK';
    cause   = 'YAHOO_DOWN';
    action  = 'CHECK_DATA_SOURCE';
    reason  = 'Yahoo API가 모든 후보에서 실패 — 외부 데이터 소스 장애.';
  } else if (metrics.scanCandidates === 0) {
    // 레짐이 RISK_ON/NEUTRAL인데도 후보 자체가 없음 — Stage1 점검 필요
    verdict = isRiskOn(regime) || regime === 'R4_NEUTRAL' ? 'PATHOLOGICAL_BLOCK' : 'INDETERMINATE';
    cause   = 'NO_CANDIDATES';
    action  = 'INSPECT_CANDIDATES';
    reason  = `${regime}인데 스캔 후보 0개 — Stage1 / 워치리스트 공급 점검.`;
  } else if (metrics.priceFail > metrics.gateFail && metrics.priceFail > metrics.rrrFail) {
    verdict = 'INDETERMINATE';
    cause   = 'PRICE_FAIL';
    action  = 'CHECK_DATA_SOURCE';
    reason  = `가격 조회 실패가 지배적 (${metrics.priceFail}/${metrics.scanCandidates}) — 시세 공급 점검.`;
  } else if (metrics.rrrFail > metrics.gateFail) {
    verdict = 'INDETERMINATE';
    cause   = 'RRR_INSUFFICIENT';
    action  = 'NONE';
    reason  = `RRR 미달이 지배적 (${metrics.rrrFail}/${metrics.scanCandidates}) — 목표가/손절가 계산 정상성 검토.`;
  } else {
    verdict = 'INDETERMINATE';
    cause   = 'UNKNOWN';
    action  = 'NONE';
    reason  = `명확한 지배 원인 미탐지 — scan=${metrics.scanCandidates}, gateFail=${metrics.gateFail}/${metrics.gateReached}.`;
  }

  return {
    verdict,
    dominantCause: cause,
    recommendedAction: action,
    regime,
    metrics,
    topBlockerCondition: blocker.key,
    topBlockerFailRate:  blocker.failRate,
    reason,
    analyzedAt: new Date().toISOString(),
  };
}

/** 테스트용: 내부 상태 초기화. */
export function resetPostmortemState(): void {
  _emptyScanCount = 0;
  _lastReport = null;
}
