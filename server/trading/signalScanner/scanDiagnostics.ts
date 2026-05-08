/**
 * @responsibility 스캔 진단 — ScanSummary·연속 제로 카운트·scan traces 영속화
 *
 * ADR-0001 (개정 2026-04-25) 의 7모듈 중 진단 단계. 기존 signalScanner.ts 의
 * 모듈 전역 상태를 본 파일 내부로 캡슐화한다.
 *
 * 외부 노출 API (barrel re-export 대상):
 *   - ScanSummary 타입
 *   - getLastBuySignalAt() / getLastScanSummary() / getConsecutiveZeroScans()
 *   - setLastBuySignalAt() / createScanCounters() / persistScanResults()
 */

import { sendTelegramAlert } from '../../alerts/telegramClient.js';
import { appendScanTraces, type ScanTrace } from '../scanTracer.js';
import {
  classifyEmptyScanReason,
  describeEmptyScanReason,
  type EmptyScanReason,
} from './emptyScanClassifier.js';
import { evaluateR3Sanity } from './r3SanityCheck.js';
import { activateR3SanityBlock } from '../../persistence/r3SanityBlockRepo.js';
// ADR-0401: R3 Sanity 단계형 state machine — 단일 스캔 1회 위반으로 hard latch 차단.
import {
  evaluateR3ViolationState,
  type R3ViolationStateResult,
} from './r3ViolationStateMachine.js';
import type { WatchlistEntry } from '../../persistence/watchlistRepo.js';
// ADR-0412: Frozen Quote Detector — 입력 데이터 오염 + Holiday-aware streak skip 진단 표시.
import type { FrozenQuoteResult } from './frozenQuoteDetector.js';
import type { StreakSkipReason } from './r3StreakSkipPolicy.js';
// ADR-0448 Phase 0 — R3 Noise Governor compact line + wiring helper + decision type.
import {
  formatR3NoiseGovernorCompactLine,
  type R3NoiseGovernorDecision,
} from './r3NoiseGovernor.js';
import { buildR3NoiseDecision } from './r3NoiseGovernorWiring.js';
// ADR-0449 — Pre-Breakout WAIT Liveness Policy: 7-state 분류 SSOT.
import {
  formatPreBreakoutWaitSummarySection,
  summarizePreBreakoutWaitDecisions,
  type PreBreakoutWaitDecision,
  type PreBreakoutWaitSummary,
} from './preBreakoutWaitPolicy.js';
// ADR-0414 — Price Integrity Checker + Correction Overlay (Stage 1 Read-Only Mode).
// Stage 1: diagnostics only — corrected 값 LIVE 매수 판단 사용 0건 (절대 원칙 #3).
import type { PriceIntegrityStatus } from './priceIntegrityChecker.js';
import type { PriceCorrectionType } from './priceCorrectionEngine.js';
// ADR-0420 — Fresh Scan Blocker Attribution: GATE1_PASS_ZERO 조건별 분해 진단 SSOT.
import {
  type ConditionBlockerBucket,
  type FreshAttributionOutputItem,
  type FreshScanBlockerAttribution,
  accumulateFreshAttribution,
  buildFreshScanBlockerAttribution,
  formatFreshAttributionSection,
} from './freshScanBlockerAttribution.js';
// ADR-0422 — Gate2 / NO_LEADERSHIP fresh attribution: Gate1 생존 후보 → Gate2 분해 진단.
import {
  type Gate2AttributionOutputItem,
  type Gate2BlockerBucket,
  type Gate2FreshAttribution,
  accumulateGate2Attribution,
  buildGate2FreshAttribution,
  buildSectorEnergyDiagnostic,
  formatGate2AttributionSection,
} from './gate2LeadershipAttribution.js';
// ADR-0423 — SectorEnergy 데이터 진실성 진단 (indexCode coverage / symmetry / fallback 분해).
//   `evaluateSectorEnergyQualityDiagnostic` SSOT 결과를 영속 + /scan_blockers 표시.
//   기존 sectorEnergyQuality / validSectorCount / sectorEnergyReasons 와 *책임 분리*
//   (이전 = 단일 라벨 + free-text reasons / 본 진단 = 구조화 reason union + leadershipConfidence).
import {
  type SectorEnergyQualityDiagnostic,
  formatSectorEnergyQualityDiagnosticSection,
} from '../../clients/sectorEnergyQualityDiagnostic.js';
// ADR-0425 — Gate Decision Router (hard block vs soft degrade separation).
//   Router 결과를 ScanSummary 옵셔널 필드로 영속 + /scan_blockers 표시.
//   Gate threshold/weights/order policy 무수정 — decision semantics 분리만.
import {
  type GateDecisionRouterResult,
  deriveGateDecisionRouterResult,
  formatGateDecisionRouterSection,
} from './gateDecisionRouter.js';
// ADR-0426 — R3_EARLY Provisional Shadow Lane.
//   Router SOFT_DEGRADE/WATCH_ONLY 시점 + Gate1 생존자 → provisional shadow 후보 생성.
//   LIVE 매매 본체 0줄 변경, KIS 주문 import 0건. 학습 샘플 보존.
import {
  type ProvisionalShadowCandidate,
  type ProvisionalShadowSectionInput,
  formatProvisionalShadowSection,
  summarizeProvisionalShadowCandidates,
} from './provisionalShadowLane.js';
// ADR-0430 — Counterfactual Shadow Learning Lane.
//   SELL_ONLY/HARD_BLOCK 에서도 학습 표본 보존. ADR-0427 provisional 와 분리.
//   별도 ledger (counterfactual-shadow-learning-ledger.json), virtual account 무관.
import {
  type CounterfactualShadowLearningCandidate,
  type CounterfactualShadowSectionInput,
  formatCounterfactualShadowLearningSection,
  summarizeCounterfactualShadowLearningCandidates,
} from './counterfactualShadowLearningLane.js';
// ADR-0436 — Gate Eligibility Split 진단 섹션 (별도 파일, ADR-0133 1500줄 한계).
import { formatGateEligibilitySplitSection } from './gateEligibilitySection.js';
export { formatGateEligibilitySplitSection } from './gateEligibilitySection.js';

export interface WaitDistribution {
  dataHold: number;
  preBreakout: number;
  gateFail: number;
  sizingBlocked: number;
  driftRemove: number;
  corpAction: number;
  volumeDrop: number;
  other: number;
}

export interface GatePassDistribution {
  gate1Pass: number;
  gate2Pass: number;
  gate3Pass: number;
  lastTriggerPass: number;
}

export interface MacroGateState {
  emergencyStop: boolean;
  autoTradeEnabled: boolean;
  regime: string;
  kellyMultiplierFromRegime: number;
  fomcPhase: string;
  fomcKellyMultiplier: number;
  finalKellyMultiplier: number;
  vixGatingActive: boolean;
  bearDefenseMode: boolean;
  mhsBelow30: boolean;
  watchlistEmpty: boolean;
  sellOnlyMode: boolean;
}

export interface ScanSummary {
  time: string;
  candidates: number;
  trackB: number;
  swing: number;
  catalyst: number;
  momentum: number;
  yahooFails: number;
  gateMisses: number;
  rrrMisses: number;
  entries: number;
  waitDistribution?: WaitDistribution;
  macroGateState?: MacroGateState;
  emptyScanReason?: EmptyScanReason;
  gatePassDistribution?: GatePassDistribution;
  sectorEnergyQuality?: 'OK' | 'PARTIAL' | 'STALE' | 'DEGRADED' | 'FAILED';
  validSectorCount?: number;
  sectorEnergyReasons?: string[];
  /**
   * ADR-0401 — 직전 스캔의 R3 Sanity state machine 결과 (옵셔널).
   * `/r3_status` 명령 + /scan_blockers 에서 운영자 노출.
   * Persist 시 정상 분기 (state ≠ CLEAN) 만 기록 — CLEAN 시 undefined.
   */
  r3ViolationState?: R3ViolationStateResult;
  /**
   * ADR-0412 — Frozen Quote Detector 결과 (옵셔널).
   * 입력 데이터 품질 진단. dataQuality !== 'OK' 시 /scan_blockers 노출.
   * 매수 직접 차단 0건 — R3 guard + streak skip 에 합성 (절대 원칙 #3).
   */
  frozenQuote?: FrozenQuoteResult;
  /**
   * ADR-0412 — R3 streak +1 skip 결과 (옵셔널).
   * Holiday/blocked-day/frozen quote 시 skip — 영속 streak 무영향.
   */
  r3StreakSkipped?: { skipped: boolean; reason?: StreakSkipReason };
  /**
   * ADR-0420 — Fresh Scan Blocker Attribution snapshot (옵셔널, 후방호환).
   *
   * 직전 단일 스캔 단위의 조건별 status 분해. last 7 days 누적 audit 과 분리.
   * gate1Pass=0 + candidates>0 시점에서 운영자에게 GATE1_PASS_ZERO 상세 (failed /
   * unavailable / error 분리 + Top blockers + diagnosis) 즉시 노출.
   */
  freshConditionAttribution?: FreshScanBlockerAttribution;
  /**
   * ADR-0422 — Gate2 / NO_LEADERSHIP fresh attribution snapshot (옵셔널, 후방호환).
   *
   * Gate1 생존 후보 (gate1Pass>0) → Gate2 분해 — STALE / WAIT 카운터 분리 +
   * sectorEnergy 진단 + blockReasons (Gate 재검증/Pre-breakout/Sizing/Drift) +
   * 9분기 진단 (TRUE_NO_LEADERSHIP / SECTOR_DATA_STALE_DOMINANT / DATA_UNAVAILABLE /
   * EVALUATOR_ERROR / PRE_BREAKOUT_WAIT / GATE_RECHECK / MIXED / NO_GATE1_SURVIVORS /
   * UNKNOWN). gate1Pass>0 + gate2Pass=0 시점에 운영자에게 NO_LEADERSHIP 분해 노출.
   */
  freshGate2Attribution?: Gate2FreshAttribution;
  /**
   * ADR-0423 — SectorEnergy 데이터 진실성 진단 snapshot (옵셔널, 후방호환).
   *
   * 기존 `sectorEnergyQuality?` / `validSectorCount?` / `sectorEnergyReasons?` 의 *구조화* 격상.
   * indexCodeCoverage / missingIndexCodeCount / symmetryValidationPassed / fallbackUsed /
   * shouldBlockLeadershipConfidence / operatorMessage 추가. 12-value reason union 분해.
   *
   * /scan_blockers SectorEnergy 진단 섹션에서 자동 노출. 부재 시 기존 sectorEnergyQuality
   * 라벨만 표시 (후방호환).
   */
  sectorEnergyQualityDiagnostic?: SectorEnergyQualityDiagnostic;
  /**
   * ADR-0425 — Gate Decision Router 결과 snapshot (옵셔널, 후방호환).
   *
   * 7-tier severity (HARD_BLOCK/TRUE_WEAKNESS/SOFT_DEGRADE/WATCH_ONLY/SHADOW_ENTRY_ALLOWED/
   * REDUCED_ENTRY_CANDIDATE/FULL_ENTRY_CANDIDATE) + lanes (live/paper/shadow/watch) +
   * 17-value reason union + 8-value label + operatorMessage.
   *
   * `freshConditionAttribution` (ADR-0420) + `freshGate2Attribution` (ADR-0422) +
   * `sectorEnergyQualityDiagnostic` (ADR-0423) + blockReasons (sizing/preBreakout/
   * gateRecheck/drift) + macroGateState risk flags 입력으로 합성.
   *
   * 사용자 §F — /scan_blockers 에 router severity / lanes / reasons / operatorMessage 표시.
   */
  gateDecisionRouter?: GateDecisionRouterResult;
  /**
   * ADR-0426 — R3_EARLY Provisional Shadow Lane summary (옵셔널, 후방호환).
   *
   * R3_EARLY + Gate1 생존자 + SOFT_DEGRADE 시점에 provisional shadow 후보 생성 결과.
   * eligible / created / topReasons / dominantLabel 합산. 호출자 (signalScanner) 가
   * 종목별 후보 평가 결과를 `summarizeProvisionalShadowCandidates` 로 합성하여 전달.
   *
   * 사용자 §E — /scan_blockers 에 R3 Provisional Shadow Lane 섹션 자동 노출.
   * 부재 시 기존 router/sectorEnergy 섹션만 표시 (후방호환).
   */
  provisionalShadowLane?: ProvisionalShadowSectionInput;
  /**
   * ADR-0430 — Counterfactual Shadow Learning Lane snapshot (옵셔널, 후방호환).
   *
   * SELL_ONLY / HARD_BLOCK 시점 학습 표본. ADR-0427 provisionalShadowLane 과 분리:
   *   - provisional = SOFT_DEGRADE/WATCH_ONLY (실매수 차단 + Shadow 보존)
   *   - counterfactual = HARD_BLOCK fallback (실매수+가상체결+일반 shadow 모두 차단,
   *     별도 학습 ledger 만 영속)
   *
   * /scan_blockers 에 Counterfactual Shadow Learning 섹션 자동 노출.
   */
  counterfactualShadowLearning?: CounterfactualShadowSectionInput;
  /**
   * ADR-0414 §6 — Price Integrity 종목별 분류 진단 (옵셔널, Stage 1 Read-Only).
   *
   * **ADR-0412 `frozenQuote?` 와 책임 분리** — frozenQuote 는 *전체 스캔의 frozen 비율*,
   * priceIntegrity 는 *종목별 stale/frozen/mismatch/reverse_gap 분류*.
   *
   * `topAffected` 는 OK 외 status 종목 Top N (진단·UI 입력).
   * 본 PR (Stage 1) 에서 호출자 0건 dead code — Stage 2/3 후속 PR 에서 wiring.
   */
  priceIntegrity?: {
    totalSamples: number;
    statusCounts: Record<PriceIntegrityStatus, number>;
    topAffected: Array<{ symbol: string; status: PriceIntegrityStatus }>;
  };
  /**
   * ADR-0414 §6 — Price Correction Overlay 진단 (옵셔널, Stage 1 Read-Only).
   *
   * **Stage 1 Read-Only Mode** — `correctionType` 분포 + averageConfidence 만 영속.
   * Stage 2/3 진입 시 corrected 사용처 wiring 후속 PR.
   */
  priceCorrection?: {
    totalSamples: number;
    correctionTypeCounts: Record<PriceCorrectionType, number>;
    averageConfidence: number;
    dropGapCalculationCount: number;
    shadowOnlySuggestedCount: number;
  };
  /**
   * ADR-0436 — Gate Eligibility Split (LIVE_ELIGIBLE vs SHADOW_OBSERVABLE).
   *
   * 6 옵셔널 카운터 (후방호환). buyListLoop wiring 이 종목별 `classifyGateEligibility`
   * 호출 후 본 카운터에 누적 → persistScanResults 가 ScanSummary 로 propagate.
   *
   * 사용자 핵심 원칙 — *"실매수 후보 0 ≠ 학습/관측 후보 0"*:
   *   - liveEligibleCount > 0: 실매수 후보 존재
   *   - shadowObservableCount > 0: 학습/관측 후보 존재 (DATA_UNAVAILABLE/PROVIDER_DEGRADED 우세)
   *   - dataUnavailableBlockedCount: SUPPLY/INVESTOR_FLOW/EARNINGS DATA_UNAVAILABLE
   *   - providerDegradedObservableCount: SECTOR_DATA_STALE/DEGRADED + PRICE_DATA_DEGRADED
   *   - trueGateFailCount: TRUE_GATE_FAIL + INSUFFICIENT_SCORE (진짜 임계 미달)
   *   - hardRiskBlockedCount: RISK_BLOCK + MACRO_BLOCK (하드 차단)
   *
   * R3 Sanity wiring (scanDiagnostics 본체) — `shadowObservableCount > 0` 시
   * GATE1_PASS_ZERO streak 누적 차단 (학습 후보 존재 = 시스템 결함 아님).
   */
  liveEligibleCount?: number;
  shadowObservableCount?: number;
  dataUnavailableBlockedCount?: number;
  providerDegradedObservableCount?: number;
  trueGateFailCount?: number;
  hardRiskBlockedCount?: number;
  /** ADR-0448 Phase 0 — R3 Noise Governor decision snapshot (옵셔널, 후방호환). */
  r3NoiseDecision?: R3NoiseGovernorDecision;
  /** ADR-0449 — Pre-Breakout WAIT 7-state 분류 summary (옵셔널, 후방호환). */
  preBreakoutWaitSummary?: PreBreakoutWaitSummary;
}

let _lastBuySignalAt = 0;
let _consecutiveZeroScans = 0;
let _lastScanSummary: ScanSummary | null = null;

export function getLastBuySignalAt(): number { return _lastBuySignalAt; }
export function getLastScanSummary(): ScanSummary | null { return _lastScanSummary; }
export function getConsecutiveZeroScans(): number { return _consecutiveZeroScans; }

export function setLastBuySignalAt(ts: number): void { _lastBuySignalAt = ts; }

export interface ScanCounters {
  yahooFails: number;
  gateMisses: number;
  rrrMisses: number;
  entries: number;
  counterfactualRecordedToday: number;
  pendingTraces: ScanTrace[];
  waitDataHold: number;
  waitPreBreakout: number;
  waitGateFail: number;
  waitSizingBlocked: number;
  waitDriftRemove: number;
  waitDriftCorpAction: number;
  waitVolumeDrop: number;
  waitOther: number;
  gate1Pass: number;
  gate2Pass: number;
  gate3Pass: number;
  lastTriggerPass: number;
  /**
   * ADR-0420 — Fresh Scan Blocker Attribution 누적기 (single scan snapshot).
   *
   * 조건별 status 카운트 (passed/failed/unavailable/error/skipped) 를 단일 스캔 동안
   * 누적. persistScanResults 에서 `buildFreshScanBlockerAttribution` 으로 최종 snapshot
   * 생성 후 ScanSummary.freshConditionAttribution 에 영속.
   *
   * last 7 days 누적 audit (gateAuditRepo) 와 분리된 fresh-only 자료 (사용자 명시
   * 핵심 불변식 #4).
   */
  freshConditionBuckets: Map<string, ConditionBlockerBucket>;
  /**
   * ADR-0422 — Gate2 fresh attribution 누적기 (Gate1 생존 후보 → Gate2 분해).
   *
   * `accumulateGate2ConditionOutputs(counters, gate1SurvivorOutputs, blockReasons)`
   * 를 호출자 (buyListLoop) 가 Gate1 통과 후 Gate2 평가 시점에 사용. STALE / WAIT
   * 카운터 분리 + sectorEnergy STALE 진단 + blockReasons 매핑.
   *
   * `freshConditionBuckets` 와 책임 분리 — fresh = 전체 outputs / gate2 = Gate1 생존 후보.
   */
  gate2ConditionBuckets: Map<string, Gate2BlockerBucket>;
  /**
   * ADR-0427 — R3_EARLY Provisional Shadow Lane 누적기 (옵셔널, 후방호환).
   *
   * 사용자 §F — eligible / created / skipped / skipReasons 카운트.
   * buyListLoop 가 후보별 deriveR3ProvisionalShadowCandidate + recordR3ProvisionalShadowCandidate
   * 호출 후 결과를 본 카운터에 누적. persistScanResults 가 ScanSummary.provisionalShadowLane 으로
   * 합성 (ADR-0426 summarizeProvisionalShadowCandidates 와 책임 분리 — 본 카운터는
   * *영속 실행 결과* 집계, summarize 헬퍼는 *후보 metadata* 합성).
   */
  provisionalShadowEligible: number;
  provisionalShadowCreated: number;
  provisionalShadowSkipped: number;
  provisionalShadowSkipReasons: Record<string, number>;
  /** Top reasons / dominant label 합성을 위한 후보 누적. */
  provisionalShadowCandidates: ProvisionalShadowCandidate[];
  /**
   * ADR-0430 — Counterfactual Shadow Learning Lane 누적기 (옵셔널 후방호환).
   *
   * SELL_ONLY / HARD_BLOCK 시점 학습 표본 카운트. ADR-0427 provisional 카운터와 분리 —
   * provisional = SOFT_DEGRADE/WATCH_ONLY 보존 / counterfactual = HARD_BLOCK fallback.
   *
   * 우선순위 (사용자 §J):
   *   1. FULL/normal shadow path
   *   2. Provisional shadow path (ADR-0426)
   *   3. Counterfactual learning-only path (ADR-0430)
   * 둘 다 동시 생성 금지 — 호출자 (buyListLoop) 가 Provisional null 반환 시점에만 호출.
   */
  counterfactualShadowEligible: number;
  counterfactualShadowCreated: number;
  counterfactualShadowSkipped: number;
  counterfactualShadowSkipReasons: Record<string, number>;
  /** Top blockedBy / dominant label 합성을 위한 후보 누적. */
  counterfactualShadowCandidates: CounterfactualShadowLearningCandidate[];
  /**
   * ADR-0436 — Gate Eligibility Split 카운터 (옵셔널, 후방호환).
   *
   * buyListLoop 가 후보별 `classifyGateEligibility` 호출 후 결과를 본 카운터에 누적.
   * persistScanResults 가 ScanSummary 로 propagate.
   *
   * 사용자 핵심 원칙 — *"실매수 후보 0 ≠ 학습/관측 후보 0"*:
   *   - shadowObservableCount > 0 시 R3 Sanity GATE1_PASS_ZERO streak 누적 차단
   *   - DATA_UNAVAILABLE/PROVIDER_DEGRADED 우세 시 EmptyScanPostmortem 액션 분리
   */
  liveEligibleCount: number;
  shadowObservableCount: number;
  dataUnavailableBlockedCount: number;
  providerDegradedObservableCount: number;
  trueGateFailCount: number;
  hardRiskBlockedCount: number;
  /**
   * ADR-0449 — Pre-Breakout WAIT 후보별 decision 누적기 (옵셔널 후방호환).
   *
   * buyListLoop 의 pre-breakout WAIT site 가 `evaluatePreBreakoutWait()` 호출 후 결과를 본
   * 배열에 push. persistScanResults 가 `summarizePreBreakoutWaitDecisions` 으로 합성하여
   * ScanSummary.preBreakoutWaitSummary 영속.
   *
   * 핵심 불변식: 모든 decision 의 `increaseFailCount: false` (literal type 강제, ADR-0115 보호).
   */
  preBreakoutWaitDecisions: PreBreakoutWaitDecision[];
}

export function createScanCounters(): ScanCounters {
  return {
    yahooFails: 0,
    gateMisses: 0,
    rrrMisses: 0,
    entries: 0,
    counterfactualRecordedToday: 0,
    pendingTraces: [],
    waitDataHold: 0,
    waitPreBreakout: 0,
    waitGateFail: 0,
    waitSizingBlocked: 0,
    waitDriftRemove: 0,
    waitDriftCorpAction: 0,
    waitVolumeDrop: 0,
    waitOther: 0,
    gate1Pass: 0,
    gate2Pass: 0,
    gate3Pass: 0,
    lastTriggerPass: 0,
    // ADR-0420 — fresh attribution 누적기 빈 Map 초기화. persistScanResults 에서 build.
    freshConditionBuckets: new Map(),
    // ADR-0422 — Gate2 attribution 누적기 빈 Map 초기화 (Gate1 생존 후보만 누적).
    gate2ConditionBuckets: new Map(),
    // ADR-0430 — Counterfactual Shadow Learning Lane 카운터 초기화.
    counterfactualShadowEligible: 0,
    counterfactualShadowCreated: 0,
    counterfactualShadowSkipped: 0,
    counterfactualShadowSkipReasons: {},
    counterfactualShadowCandidates: [],
    // ADR-0427 — Provisional Shadow Lane 카운터 초기화.
    provisionalShadowEligible: 0,
    provisionalShadowCreated: 0,
    provisionalShadowSkipped: 0,
    provisionalShadowSkipReasons: {},
    provisionalShadowCandidates: [],
    // ADR-0436 — Gate Eligibility Split 6 카운터 초기화 (옵셔널이지만 명시 0).
    liveEligibleCount: 0,
    shadowObservableCount: 0,
    dataUnavailableBlockedCount: 0,
    providerDegradedObservableCount: 0,
    trueGateFailCount: 0,
    hardRiskBlockedCount: 0,
    // ADR-0449 — Pre-Breakout WAIT decisions 누적기 빈 배열 초기화.
    preBreakoutWaitDecisions: [],
  };
}

/**
 * ADR-0420 — fresh attribution 누적기 호출 헬퍼.
 *
 * 호출자(buyListLoop 의 reCheckGate 평가 site)가 단일 후보 `gate.outputs` 를 본 함수로
 * 전달 → counters.freshConditionBuckets 에 conditionKey 별 status 카운트 누적.
 *
 * try/catch 격리 권장 — fresh attribution 실패 시에도 매수 흐름 차단 안 함.
 *
 * 외부 부작용 0 (Map mutate 만).
 */
export function accumulateFreshConditionOutputs(
  counters: ScanCounters,
  outputs: FreshAttributionOutputItem[],
): void {
  accumulateFreshAttribution(counters.freshConditionBuckets, outputs);
}

/**
 * ADR-0422 — Gate2 attribution 누적기 호출 헬퍼.
 *
 * 호출자 (buyListLoop) 가 *Gate1 생존 후보* 의 평가 outputs 만 본 함수로 전달.
 * STALE / WAIT 카운터 분리 + 호출자 측 wait marker 신호 가능 (pre-breakout WAIT 등).
 *
 * try/catch 격리 권장 — Gate2 attribution 실패 시에도 매수 흐름 차단 안 함.
 *
 * 외부 부작용 0 (Map mutate 만).
 */
export function accumulateGate2ConditionOutputs(
  counters: ScanCounters,
  outputs: Gate2AttributionOutputItem[],
): void {
  accumulateGate2Attribution(counters.gate2ConditionBuckets, outputs);
}

/**
 * ADR-0436 — Gate Eligibility Split 카운터 누적 헬퍼 SSOT.
 *
 * 호출자(buyListLoop)가 종목별 `classifyGateEligibility` 결과를 본 함수로 전달.
 * 6 카운터 자동 누적: liveEligible / shadowObservable / dataUnavailableBlocked /
 * providerDegradedObservable / trueGateFail / hardRiskBlocked.
 *
 * try/catch 격리 권장 — accumulator 실패가 매수 흐름 차단 안 함.
 *
 * 외부 부작용 0 — counters mutate 만, KIS 주문 함수 import 0건.
 */
export function accumulateGateEligibility(
  counters: ScanCounters,
  result: { liveEligible: boolean; shadowObservable: boolean; liveBlockReasons: string[]; dataUnavailableReasons: string[]; degradedProviderReasons: string[] },
): void {
  if (result.liveEligible) {
    counters.liveEligibleCount += 1;
  }
  if (result.shadowObservable) {
    counters.shadowObservableCount += 1;
  }
  if (result.dataUnavailableReasons.length > 0) {
    counters.dataUnavailableBlockedCount += 1;
  }
  if (result.degradedProviderReasons.length > 0) {
    counters.providerDegradedObservableCount += 1;
  }
  // Hard risk = MACRO_BLOCK + RISK_BLOCK (학습 표본 오염 차단 분기)
  if (
    result.liveBlockReasons.includes('MACRO_BLOCK') ||
    result.liveBlockReasons.includes('RISK_BLOCK')
  ) {
    counters.hardRiskBlockedCount += 1;
  }
  // True gate fail = TRUE_GATE_FAIL + INSUFFICIENT_SCORE (진짜 임계 미달)
  if (
    result.liveBlockReasons.includes('TRUE_GATE_FAIL') ||
    result.liveBlockReasons.includes('INSUFFICIENT_SCORE')
  ) {
    counters.trueGateFailCount += 1;
  }
}

export function buildGatePassDistribution(counters: ScanCounters): GatePassDistribution {
  return {
    gate1Pass: counters.gate1Pass,
    gate2Pass: counters.gate2Pass,
    gate3Pass: counters.gate3Pass,
    lastTriggerPass: counters.lastTriggerPass,
  };
}

export function buildWaitDistribution(counters: ScanCounters): WaitDistribution {
  return {
    dataHold: counters.waitDataHold,
    preBreakout: counters.waitPreBreakout,
    gateFail: counters.waitGateFail,
    sizingBlocked: counters.waitSizingBlocked,
    driftRemove: counters.waitDriftRemove,
    corpAction: counters.waitDriftCorpAction,
    volumeDrop: counters.waitVolumeDrop,
    other: counters.waitOther,
  };
}

export function buildMacroGateState(input: {
  emergencyStop: boolean;
  autoTradeEnabled: boolean;
  regime: string;
  regimeKelly: number;
  fomcPhase: string;
  fomcKelly: number;
  finalKelly: number;
  vixGatingActive: boolean;
  bearDefenseMode: boolean;
  mhsBelow30: boolean;
  watchlistEmpty: boolean;
  sellOnlyMode: boolean;
}): MacroGateState {
  return {
    emergencyStop: input.emergencyStop,
    autoTradeEnabled: input.autoTradeEnabled,
    regime: input.regime,
    kellyMultiplierFromRegime: input.regimeKelly,
    fomcPhase: input.fomcPhase,
    fomcKellyMultiplier: input.fomcKelly,
    finalKellyMultiplier: input.finalKelly,
    vixGatingActive: input.vixGatingActive,
    bearDefenseMode: input.bearDefenseMode,
    mhsBelow30: input.mhsBelow30,
    watchlistEmpty: input.watchlistEmpty,
    sellOnlyMode: input.sellOnlyMode,
  };
}

export function formatScanBlockersMessage(summary: ScanSummary | null): string {
  if (!summary) {
    return '📊 <b>[매수 차단 사유]</b>\n━━━━━━━━━━━━━━━━\n진단 데이터 없음 (스캔 미실행).';
  }

  const wd = summary.waitDistribution;
  const mg = summary.macroGateState;
  const lines: string[] = [];
  lines.push(`📊 <b>[매수 차단 사유 분포]</b> 직전 스캔 (${summary.time})`);
  lines.push('━━━━━━━━━━━━━━━━');

  if (mg) {
    lines.push('');
    lines.push('🛑 <b>거시 게이트:</b>');
    lines.push(`  • emergencyStop: ${mg.emergencyStop ? '<b>ON ⚠️</b>' : 'off'}`);
    lines.push(`  • autoTradeEnabled: ${mg.autoTradeEnabled ? 'on' : '<b>OFF ⚠️</b>'}`);
    lines.push(`  • 레짐: ${mg.regime} (Kelly ×${mg.kellyMultiplierFromRegime.toFixed(2)})`);
    lines.push(`  • FOMC: ${mg.fomcPhase} (Kelly ×${mg.fomcKellyMultiplier.toFixed(2)}) → 결합 ×${mg.finalKellyMultiplier.toFixed(2)}`);
    if (mg.vixGatingActive) lines.push(`  • VIX 게이팅: <b>ON ⚠️</b>`);
    if (mg.bearDefenseMode) lines.push(`  • bearDefenseMode: <b>ON ⚠️</b>`);
    if (mg.mhsBelow30) lines.push(`  • MHS<30: <b>ON ⚠️</b>`);
    if (mg.sellOnlyMode) lines.push(`  • SELL_ONLY: <b>ON ⚠️</b> (점심/장외 시간대)`);
    if (mg.watchlistEmpty) lines.push(`  • 워치리스트: <b>0개 ⚠️</b>`);
  }

  if (summary.sectorEnergyQuality !== undefined) {
    lines.push('');
    lines.push('🌐 <b>섹터 에너지 데이터 품질:</b>');
    // ADR-0396 (= 사용자 명시 ADR-0371): 5단계 union — DEGRADED 신규 마커 추가.
    const qualityIcon =
      summary.sectorEnergyQuality === 'OK' ? '✅'
      : summary.sectorEnergyQuality === 'PARTIAL' ? '🟡'
      : summary.sectorEnergyQuality === 'STALE' ? '🟠'
      : summary.sectorEnergyQuality === 'DEGRADED' ? '🔶'
      : '❌';
    lines.push(`  • dataQuality: ${qualityIcon} <b>${summary.sectorEnergyQuality}</b>`);
    if (summary.validSectorCount !== undefined) {
      lines.push(`  • validSectorCount: ${summary.validSectorCount}/12`);
    }
    if (summary.sectorEnergyReasons && summary.sectorEnergyReasons.length > 0) {
      lines.push(`  • reasons: ${summary.sectorEnergyReasons.slice(0, 3).join('; ')}`);
    }
    // ADR-0396: FAILED 외 DEGRADED 도 DATA_INVALID 후보 (emptyScanClassifier wiring 정합).
    if (summary.sectorEnergyQuality === 'FAILED' || summary.sectorEnergyQuality === 'DEGRADED') {
      lines.push(`  • <i>${summary.sectorEnergyQuality} → emptyScanReason DATA_INVALID 자동 가중 (ADR-0127/0396)</i>`);
    }
  }

  lines.push('');
  lines.push(`📋 <b>종목별 차단</b> (후보 ${summary.candidates}개):`);
  lines.push(`  • 진입: <b>${summary.entries}개</b>`);
  if (wd) {
    if (wd.dataHold > 0) lines.push(`  • DATA_HOLD: ${wd.dataHold}개 ⚠️`);
    if (wd.gateFail > 0) lines.push(`  • Gate 재검증 미달: ${wd.gateFail}개`);
    if (wd.preBreakout > 0) lines.push(`  • Pre-breakout WAIT: ${wd.preBreakout}개`);
    if (wd.sizingBlocked > 0) lines.push(`  • Sizing BLOCKED: ${wd.sizingBlocked}개 ⚠️`);
    if (wd.volumeDrop > 0) lines.push(`  • 거래량 급감: ${wd.volumeDrop}개`);
    if (wd.driftRemove > 0) lines.push(`  • Drift REMOVE: ${wd.driftRemove}개`);
    if (wd.corpAction > 0) lines.push(`  • Corporate Action: ${wd.corpAction}개`);
    if (wd.other > 0) lines.push(`  • 기타: ${wd.other}개`);
  } else {
    lines.push(`  • Gate 미달: ${summary.gateMisses}개 (waitDistribution 미수집)`);
    lines.push(`  • Yahoo 실패: ${summary.yahooFails}개`);
    lines.push(`  • RRR 미달: ${summary.rrrMisses}개`);
  }

  // ADR-0412 — Frozen Quote 진단 + R3 streak skip 라인 (R3 state machine 노출 *전*).
  const frozenSection = formatFrozenQuoteSection(summary.frozenQuote);
  if (frozenSection) {
    lines.push(frozenSection);
  }
  const streakSkipLine = formatR3StreakSkipLine(summary.r3StreakSkipped);
  if (streakSkipLine) {
    lines.push('');
    lines.push(streakSkipLine);
  }

  // ADR-0414 — Price Integrity + Correction Overlay (Stage 1 Read-Only).
  // 진단 only — corrected 값 LIVE 매수 판단 사용 0건 (절대 원칙 #3).
  const priceIntegritySection = formatPriceIntegritySection(summary.priceIntegrity);
  if (priceIntegritySection) {
    lines.push(priceIntegritySection);
  }
  const priceCorrectionSection = formatPriceCorrectionOverlaySection(summary.priceCorrection);
  if (priceCorrectionSection) {
    lines.push(priceCorrectionSection);
  }

  // ADR-0401 — R3 Sanity state machine 결과 노출 (CLEAN 외 분기에서만).
  if (summary.r3ViolationState && summary.r3ViolationState.state !== 'CLEAN') {
    const r3 = summary.r3ViolationState;
    const stateIcon: Record<typeof r3.state, string> = {
      CLEAN: '✅',
      WARNING: '🟡',
      ELEVATED: '🟠',
      SHADOW_ONLY: '⚫️',
      HARD_BLOCK: '🚨',
    };
    lines.push('');
    lines.push(`${stateIcon[r3.state]} <b>R3 Sanity 단계 (ADR-0401):</b> ${r3.state}`);
    lines.push(
      `  • 누적 ${r3.consecutiveCount}회 / 임계 hard ${r3.profile.hardBlockAt} (regime ${r3.regime})`,
    );
    if (r3.guardReasons.length > 0) {
      lines.push(`  • guard 활성: ${r3.guardReasons.slice(0, 2).join('; ')}`);
    }
    if (r3.state === 'HARD_BLOCK') {
      lines.push('  • <code>/r3_unblock</code> 으로 해제');
    } else if (r3.state === 'SHADOW_ONLY') {
      lines.push('  • ephemeral — 다음 정상 스캔 시 자동 회복');
    }
  }

  lines.push('');
  if (summary.emptyScanReason) {
    const desc = describeEmptyScanReason(summary.emptyScanReason);
    lines.push(`💡 <b>빈스캔 원인 (ADR-0119):</b> ${summary.emptyScanReason}`);
    lines.push(`  • ${desc.label}`);
    lines.push(`  • ${desc.advice}`);
  } else if (summary.entries > 0) {
    lines.push(`✅ <b>매수 발생:</b> ${summary.entries}개 (분류 대상 아님)`);
  } else {
    lines.push('💡 <b>빈스캔 원인:</b> 분류 데이터 부족 (waitDistribution 미수집)');
  }

  // ADR-0420 — Fresh Scan Blocker Attribution (GATE1_PASS_ZERO 상세) 노출.
  // gate1Pass=0 + candidates>0 시점에만 노출 (formatFreshAttributionSection 내부 필터).
  // last 7 days /gate_audit 와 *분리* (사용자 명시 핵심 불변식 #4).
  const freshSection = formatFreshAttributionSection(summary.freshConditionAttribution);
  if (freshSection) {
    lines.push('');
    lines.push(freshSection);
  }

  // ADR-0422 — Gate2 / NO_LEADERSHIP fresh attribution 노출.
  // gate1Pass>0 + gate2Pass=0 시점에만 노출 (formatGate2AttributionSection 내부 필터).
  // gate1Pass=0 시점은 ADR-0420 GATE1_PASS_ZERO 분석이 우선 (책임 분리).
  const gate2Section = formatGate2AttributionSection(summary.freshGate2Attribution);
  if (gate2Section) {
    lines.push('');
    lines.push(gate2Section);
  }

  // ADR-0423 — SectorEnergy 데이터 진실성 진단 (indexCode coverage / symmetry / fallback 분해).
  // 기존 sectorEnergyQuality 라벨만으로는 SECTOR_DATA_STALE_DOMINANT 의 *진짜 원인* 인식 불가.
  // 본 섹션은 reasons 분해 + leadershipConfidence 차단 결정 + operatorAction 안내.
  // ADR-0422 Gate2 섹션의 sectorEnergy 표시(요약) 와 *책임 분리* — 본 섹션은 *원인 분해 상세*.
  const sectorEnergySection = formatSectorEnergyQualityDiagnosticSection(summary.sectorEnergyQualityDiagnostic);
  if (sectorEnergySection) {
    lines.push('');
    lines.push(sectorEnergySection);
  }

  // ADR-0425 — Gate Decision Router (hard block vs soft degrade separation).
  // 사용자 §F — Router 결과 (severity / lanes / reasons / operatorMessage) 노출.
  // Gate threshold 변경 0 — decision semantics 분리만. Shadow/Watch 학습 후보 보존.
  const routerSection = formatGateDecisionRouterSection(summary.gateDecisionRouter);
  if (routerSection) {
    lines.push('');
    lines.push(routerSection);
  }

  // ADR-0436 — Gate Eligibility Split (LIVE_ELIGIBLE vs SHADOW_OBSERVABLE).
  // 사용자 §5 — 실매수 후보 vs 학습/관측 후보 분리 표시. shadowObservableCount=undefined
  // 시 미노출 (ENV OFF 또는 ADR-0436 미작동 — 후방호환). 부재 시 진단 메시지 무영향.
  const gateEligibilitySection = formatGateEligibilitySplitSection(summary);
  if (gateEligibilitySection) {
    lines.push('');
    lines.push(gateEligibilitySection);
  }

  // ADR-0426 — R3_EARLY Provisional Shadow Lane.
  // 사용자 §E — eligible / created / topReasons / dominantLabel 노출.
  // R3_EARLY + Gate1 생존자 + SOFT_DEGRADE 시점에 학습 샘플 보존 lane.
  // LIVE 매매 본체 영향 0 — 후보 metadata 만 영속.
  const provisionalSection = formatProvisionalShadowSection(summary.provisionalShadowLane);
  if (provisionalSection) {
    lines.push('');
    lines.push(provisionalSection);
  }

  // ADR-0430 — Counterfactual Shadow Learning Lane.
  // SELL_ONLY/HARD_BLOCK 시점 학습 표본 분리 표시. ADR-0427 provisional 다음 노출.
  // 매매 정책 변경 0건 — 학습 ledger 진단만.
  const counterfactualSection = formatCounterfactualShadowLearningSection(
    summary.counterfactualShadowLearning,
  );
  if (counterfactualSection) {
    lines.push('');
    lines.push(counterfactualSection);
  }

  // ADR-0448 Phase 0 — R3 Noise Governor compact line.
  //   Gate1 통과 0건 시점의 cause 분류 (TRUE_GATE1_ZERO / SELL_ONLY / LUNCH_BREAK /
  //   DATA_UNAVAILABLE / SECTOR_ENERGY_DIAGNOSTIC_BLOCKED / PROVIDER_DEGRADED /
  //   SHADOW_OBSERVABLE_EXISTS / UNKNOWN) + streakImpact (0/1) + liveBlockPreserved=true.
  //   부재 시 미노출 (gate1Pass>0 또는 ENV DISABLED — 후방호환).
  if (summary.r3NoiseDecision) {
    lines.push('');
    lines.push(formatR3NoiseGovernorCompactLine(summary.r3NoiseDecision));
  }

  // ADR-0449 — Pre-Breakout WAIT 7-state compact summary.
  //   Pre-breakout WAIT 후보 분류 (retryEligible / cooldown / shadowOnly / rejected /
  //   priceTooFar / volumeWeak / gateRecheckFailed) + topReasons + failCountProtected.
  //   부재 시 미노출 (decisions 빈 배열 — 후방호환).
  if (summary.preBreakoutWaitSummary) {
    const section = formatPreBreakoutWaitSummarySection(summary.preBreakoutWaitSummary);
    if (section) {
      lines.push('');
      lines.push(section);
    }
  }

  return lines.join('\n');
}

export interface PersistScanResultsOptions {
  sellOnly?: boolean;
  buyListLength: number;
  intradayBuyListLength: number;
  swingListLength: number;
  catalystListLength: number;
  momentumListLength: number;
  macroGateState?: MacroGateState;
  sectorEnergyQuality?: 'OK' | 'PARTIAL' | 'STALE' | 'DEGRADED' | 'FAILED';
  validSectorCount?: number;
  sectorEnergyReasons?: string[];
  /**
   * ADR-0401 — R3 Sanity state machine 의 marketDataFreshness 입력 (옵셔널).
   * 부재 시 'FRESH' 가정 (정상 운영 시 기본 — guards 무영향).
   */
  marketDataFreshness?: 'FRESH' | 'STALE' | 'EXPIRED';
  /**
   * ADR-0401 — volumeClock 진입 허용 여부 (옵셔널).
   * 부재 시 true 가정 (preflight non-abort 경로 도달 = 정상 시간대 추론).
   */
  volumeClockAllowsEntry?: boolean;
  /**
   * ADR-0412 — Frozen Quote Detector 결과 (옵셔널).
   * 호출자 (signalScanner/index.ts) 가 후보 평가 후 합성하여 전달.
   * 부재 시 ScanSummary.frozenQuote 미영속 + R3 guard `frozenQuoteDataQuality=undefined`.
   */
  frozenQuote?: FrozenQuoteResult;
  /**
   * ADR-0423 — SectorEnergy 데이터 진실성 진단 (옵셔널, 후방호환).
   * 호출자 (signalScanner/index.ts 또는 sectorEnergyProvider build site) 가 합성하여 전달.
   * 부재 시 ScanSummary.sectorEnergyQualityDiagnostic 미영속 — 기존 sectorEnergyQuality 라벨만 영속.
   */
  sectorEnergyQualityDiagnostic?: SectorEnergyQualityDiagnostic;
  /**
   * ADR-0412 — R3 streak +1 skip 결정 (옵셔널).
   * 호출자가 `evaluateStreakIncrementAllowed` 결과 그대로 전달.
   * `skipped=true` 시 R3 state machine 분기에서 streak 갱신 호출 자체 skip
   * (영속 무영향 + 24h decay 보존).
   */
  r3StreakSkipped?: { skipped: boolean; reason?: StreakSkipReason };
}

export async function persistScanResults(
  counters: ScanCounters,
  options: PersistScanResultsOptions,
): Promise<void> {
  // ADR-0366: sellOnly 시간대에도 scan summary는 반드시 저장한다.
  // 매수 trace 영속/침묵 알림/R3 sanity side-effect만 sellOnly에서 생략한다.
  if (!options.sellOnly && counters.pendingTraces.length > 0) {
    appendScanTraces(counters.pendingTraces);
  }

  const kstNow = new Date(Date.now() + 9 * 3_600_000);
  const timeLabel = kstNow.toISOString().slice(11, 16) + ' KST';
  const summaryDraft: ScanSummary = {
    time: timeLabel,
    candidates: options.buyListLength + options.intradayBuyListLength,
    trackB: options.buyListLength,
    swing: options.swingListLength,
    catalyst: options.catalystListLength,
    momentum: options.momentumListLength,
    yahooFails: counters.yahooFails,
    gateMisses: counters.gateMisses,
    rrrMisses: counters.rrrMisses,
    entries: counters.entries,
    waitDistribution: buildWaitDistribution(counters),
    ...(options.macroGateState ? { macroGateState: options.macroGateState } : {}),
    gatePassDistribution: buildGatePassDistribution(counters),
    ...(options.sectorEnergyQuality !== undefined
      ? {
          sectorEnergyQuality: options.sectorEnergyQuality,
          validSectorCount: options.validSectorCount,
          sectorEnergyReasons: options.sectorEnergyReasons,
        }
      : {}),
    // ADR-0412 — Frozen Quote 진단 + R3 streak skip 영속 (옵셔널, 후방호환).
    ...(options.frozenQuote ? { frozenQuote: options.frozenQuote } : {}),
    ...(options.r3StreakSkipped ? { r3StreakSkipped: options.r3StreakSkipped } : {}),
    // ADR-0423 — SectorEnergy 데이터 진실성 진단 영속 (옵셔널, 후방호환).
    ...(options.sectorEnergyQualityDiagnostic
      ? { sectorEnergyQualityDiagnostic: options.sectorEnergyQualityDiagnostic }
      : {}),
    // ADR-0436 — Gate Eligibility Split 6 카운터 propagate (counters → ScanSummary).
    // 옵셔널 후방호환 — 0 이어도 명시 영속하여 진단 가시화 보장.
    liveEligibleCount: counters.liveEligibleCount,
    shadowObservableCount: counters.shadowObservableCount,
    dataUnavailableBlockedCount: counters.dataUnavailableBlockedCount,
    providerDegradedObservableCount: counters.providerDegradedObservableCount,
    trueGateFailCount: counters.trueGateFailCount,
    hardRiskBlockedCount: counters.hardRiskBlockedCount,
  };

  // ADR-0420 — Fresh Scan Blocker Attribution build + persist (옵셔널, 후방호환).
  // candidates>0 시점에만 build (의미 있는 분해). 빈 buckets 도 NO_CANDIDATES/UNKNOWN
  // diagnosis 자동 분류 — 정상 운영 메시지에 잡음 추가 안 함.
  if (counters.freshConditionBuckets.size > 0) {
    const candidates = options.buyListLength + options.intradayBuyListLength;
    const scanIdLabel = `${kstNow.toISOString().slice(0, 10)}:${timeLabel}`;
    summaryDraft.freshConditionAttribution = buildFreshScanBlockerAttribution({
      buckets: Array.from(counters.freshConditionBuckets.values()),
      candidates,
      entries: counters.entries,
      gate1Pass: counters.gate1Pass,
      gate2Pass: counters.gate2Pass,
      gate3Pass: counters.gate3Pass,
      lastTriggerPass: counters.lastTriggerPass,
      scanId: scanIdLabel,
      scannedAtKst: timeLabel,
    });
  }

  // ADR-0422 — Gate2 / NO_LEADERSHIP fresh attribution build + persist.
  // gate1Pass>0 시점에만 build — Gate1 생존자가 있는 스캔만 Gate2 진단 의미. NO_LEADERSHIP
  // 분류 (gate1Pass>0 && gate2Pass=0) 시 /scan_blockers 에 자동 노출.
  // sectorEnergy STALE 진단은 macroGateState 또는 ScanSummary 의 sectorEnergyQuality 에서 발췌.
  if (counters.gate1Pass > 0) {
    const candidates = options.buyListLength + options.intradayBuyListLength;
    const scanIdLabel = `${kstNow.toISOString().slice(0, 10)}:${timeLabel}`;
    const sectorEnergyDiag =
      options.sectorEnergyQuality !== undefined
        ? buildSectorEnergyDiagnostic({
            dataQuality: options.sectorEnergyQuality,
            validSectorCount: options.validSectorCount,
            expectedSectorCount: 12,
            reasons: options.sectorEnergyReasons,
          })
        : undefined;
    const blockReasons = options.macroGateState
      ? {
          gateRecheckMiss: counters.waitGateFail,
          preBreakoutWait: counters.waitPreBreakout,
          sizingBlocked: counters.waitSizingBlocked,
          driftRemove: counters.waitDriftRemove + counters.waitDriftCorpAction,
        }
      : {
          gateRecheckMiss: counters.waitGateFail,
          preBreakoutWait: counters.waitPreBreakout,
          sizingBlocked: counters.waitSizingBlocked,
          driftRemove: counters.waitDriftRemove + counters.waitDriftCorpAction,
        };
    summaryDraft.freshGate2Attribution = buildGate2FreshAttribution({
      buckets: Array.from(counters.gate2ConditionBuckets.values()),
      candidates,
      gate1Pass: counters.gate1Pass,
      gate2Pass: counters.gate2Pass,
      gate3Pass: counters.gate3Pass,
      entries: counters.entries,
      lastTriggerPass: counters.lastTriggerPass,
      blockReasons,
      ...(sectorEnergyDiag ? { sectorEnergy: sectorEnergyDiag } : {}),
      scanId: scanIdLabel,
      scannedAtKst: timeLabel,
    });
  }

  const emptyReason = classifyEmptyScanReason(summaryDraft);
  if (emptyReason) summaryDraft.emptyScanReason = emptyReason;

  // ADR-0425 — Gate Decision Router 자동 합성 (옵셔널, 후방호환).
  // 위 attribution / sectorEnergy / blockReasons 모두 영속된 *후* 합성 — input 정합 보장.
  // riskFlags 는 macroGateState 에서 발췌 (emergencyStop / sellOnly / r6Defense / VIX / FOMC).
  const macroGate = options.macroGateState;
  const routerInput = {
    regime: macroGate?.regime,
    gate1Pass: counters.gate1Pass,
    gate2Pass: counters.gate2Pass,
    gate3Pass: counters.gate3Pass,
    lastTriggerPass: counters.lastTriggerPass,
    entries: counters.entries,
    ...(summaryDraft.freshConditionAttribution
      ? { freshAttribution: summaryDraft.freshConditionAttribution }
      : {}),
    ...(summaryDraft.freshGate2Attribution
      ? { gate2Attribution: summaryDraft.freshGate2Attribution }
      : {}),
    ...(options.sectorEnergyQualityDiagnostic
      ? { sectorEnergyDiagnostic: options.sectorEnergyQualityDiagnostic }
      : {}),
    blockReasons: {
      gateRecheckMiss: counters.waitGateFail,
      preBreakoutWait: counters.waitPreBreakout,
      sizingBlocked: counters.waitSizingBlocked,
      driftRemove: counters.waitDriftRemove + counters.waitDriftCorpAction,
    },
    riskFlags: macroGate
      ? {
          emergencyStop: macroGate.emergencyStop,
          sellOnly: macroGate.sellOnlyMode || options.sellOnly,
          r6Defense: macroGate.bearDefenseMode || macroGate.regime === 'R6_DEFENSE',
          vixBlock: macroGate.vixGatingActive,
          fomcBlock: macroGate.fomcPhase === 'DAY',
        }
      : { sellOnly: options.sellOnly },
  };
  try {
    summaryDraft.gateDecisionRouter = deriveGateDecisionRouterResult(routerInput);
  } catch (e) {
    // Router 실패가 ScanSummary 영속을 차단해서는 안 됨 — try/catch 격리.
    console.warn('[GateDecisionRouter] derive 실패 (영속 무영향)', e);
  }

  // ADR-0427 — Provisional Shadow Lane 카운터 → ScanSummary 합성 (옵셔널, 후방호환).
  // buyListLoop 가 후보별 영속 결과를 ScanCounters 에 누적 → 본 시점에서 합산.
  // 카운터 0 이어도 noEligibleReason 으로 운영자에게 *왜 0 인가* 표시 가능.
  try {
    const candidates = counters.provisionalShadowCandidates ?? [];
    const eligible = counters.provisionalShadowEligible ?? 0;
    const created = counters.provisionalShadowCreated ?? 0;
    const skipped = counters.provisionalShadowSkipped ?? 0;
    if (eligible > 0 || created > 0 || skipped > 0) {
      const summary = summarizeProvisionalShadowCandidates(candidates);
      summaryDraft.provisionalShadowLane = {
        ...summary,
        eligible,
        created,
      };
      // skipped 정보는 별도 필드 노출 — formatter 가 표시.
      (summaryDraft.provisionalShadowLane as ProvisionalShadowSectionInput & {
        skipped?: number;
        skipReasons?: Record<string, number>;
      }).skipped = skipped;
      (summaryDraft.provisionalShadowLane as ProvisionalShadowSectionInput & {
        skipped?: number;
        skipReasons?: Record<string, number>;
      }).skipReasons = counters.provisionalShadowSkipReasons;
    } else {
      // eligible=0 시 noEligibleReason 합성 (HARD_BLOCK / no Gate1 survivor / true weakness)
      const router = summaryDraft.gateDecisionRouter;
      let reason: string | undefined;
      if (router?.severity === 'HARD_BLOCK') {
        const top = router.reasons?.[0];
        reason = top ? `HARD_BLOCK / ${top}` : 'HARD_BLOCK';
      } else if (router?.severity === 'TRUE_WEAKNESS') {
        reason = 'TRUE_WEAKNESS — Shadow 학습도 차단';
      } else if ((counters.gate1Pass ?? 0) === 0) {
        reason = 'no Gate1 survivor';
      } else if (routerInput.regime !== 'R3_EARLY') {
        reason = `regime=${routerInput.regime ?? 'UNKNOWN'} — R3_EARLY 외 차단`;
      }
      if (reason !== undefined) {
        summaryDraft.provisionalShadowLane = {
          eligible: 0,
          created: 0,
          noEligibleReason: reason,
        };
      }
    }
  } catch (e) {
    console.warn('[ProvisionalShadowLane] summarize 실패 (영속 무영향)', e);
  }

  // ADR-0430 — Counterfactual Shadow Learning Lane 카운터 → ScanSummary 합성.
  // SELL_ONLY/HARD_BLOCK 시점 학습 표본. ADR-0427 provisional 와 분리.
  // virtual account 무영향, KIS 주문 함수 import 0건.
  try {
    const cfCandidates = counters.counterfactualShadowCandidates ?? [];
    const cfEligible = counters.counterfactualShadowEligible ?? 0;
    const cfCreated = counters.counterfactualShadowCreated ?? 0;
    const cfSkipped = counters.counterfactualShadowSkipped ?? 0;
    if (cfEligible > 0 || cfCreated > 0 || cfSkipped > 0) {
      const cfSummary = summarizeCounterfactualShadowLearningCandidates(cfCandidates);
      summaryDraft.counterfactualShadowLearning = {
        ...cfSummary,
        eligible: cfEligible,
        created: cfCreated,
      };
      (summaryDraft.counterfactualShadowLearning as CounterfactualShadowSectionInput & {
        skipped?: number;
        skipReasons?: Record<string, number>;
      }).skipped = cfSkipped;
      (summaryDraft.counterfactualShadowLearning as CounterfactualShadowSectionInput & {
        skipped?: number;
        skipReasons?: Record<string, number>;
      }).skipReasons = counters.counterfactualShadowSkipReasons;
    } else {
      // eligible=0 — 학습 lane 도 비어있는 사유 합성.
      const router = summaryDraft.gateDecisionRouter;
      let cfReason: string | undefined;
      if (process.env.COUNTERFACTUAL_SHADOW_LEARNING_DISABLED === 'true') {
        cfReason = 'disabled (ENV COUNTERFACTUAL_SHADOW_LEARNING_DISABLED=true)';
      } else if ((counters.gate1Pass ?? 0) === 0) {
        cfReason = 'no Gate1 survivor';
      } else if (routerInput.regime !== 'R3_EARLY') {
        cfReason = `regime=${routerInput.regime ?? 'UNKNOWN'} — R3_EARLY 외 비활성`;
      } else if (router?.severity === 'TRUE_WEAKNESS') {
        cfReason = 'TRUE_WEAKNESS — 학습 표본 오염 차단';
      } else if (
        router?.severity === 'SOFT_DEGRADE' ||
        router?.severity === 'WATCH_ONLY' ||
        router?.severity === 'REDUCED_ENTRY_CANDIDATE' ||
        router?.severity === 'FULL_ENTRY_CANDIDATE'
      ) {
        cfReason = `${router.severity} — Provisional/Normal path 우선 (counterfactual 불필요)`;
      } else {
        cfReason = 'no candidate';
      }
      if (cfReason !== undefined) {
        summaryDraft.counterfactualShadowLearning = {
          eligible: 0,
          created: 0,
          noEligibleReason: cfReason,
        };
      }
    }
  } catch (e) {
    console.warn('[CounterfactualShadowLearning] summarize 실패 (영속 무영향)', e);
  }

  // ADR-0449 — Pre-Breakout WAIT 7-state summary 합성 (옵셔널 후방호환).
  //   buyListLoop 가 후보별 evaluatePreBreakoutWait 결과를 counters.preBreakoutWaitDecisions
  //   에 push → 본 시점에서 합산. decisions 빈 배열 시 summary 미영속 (운영자 noise 차단).
  //   try/catch 격리 — 합성 실패가 ScanSummary 영속을 차단하지 않음.
  try {
    if (counters.preBreakoutWaitDecisions.length > 0) {
      summaryDraft.preBreakoutWaitSummary = summarizePreBreakoutWaitDecisions({
        decisions: counters.preBreakoutWaitDecisions,
      });
    }
  } catch (e) {
    console.warn('[PreBreakoutWaitPolicy] summarize 실패 (영속 무영향)', e);
  }

  _lastScanSummary = summaryDraft;

  if (options.sellOnly) {
    // sellOnly는 매수 금지 운영 상태일 뿐, /scan_blockers 진단 데이터는 유지한다.
    return;
  }

  if (counters.entries === 0 && _lastScanSummary.candidates > 0) {
    _consecutiveZeroScans++;
  } else {
    _consecutiveZeroScans = 0;
  }

  if (_consecutiveZeroScans >= 3) {
    _consecutiveZeroScans = 0;
    await sendTelegramAlert(
      `📊 <b>[스캔 요약]</b> ${timeLabel}\n` +
      `총 후보: ${_lastScanSummary.candidates}개 | SWING: ${_lastScanSummary.swing}개 | CATALYST: ${_lastScanSummary.catalyst}개 | MOMENTUM: ${_lastScanSummary.momentum}개\n` +
      `- Yahoo 실패: ${counters.yahooFails}개 → 진입 보류\n` +
      `- Gate 미달: ${counters.gateMisses}개\n` +
      `- RRR 미달: ${counters.rrrMisses}개\n` +
      `- 진입 성공: 0개\n` +
      `⚠️ 3회 연속 진입 없음 — 파이프라인 점검 필요`
    ).catch(console.error);
  }

  // ADR-0401 — R3 Violation 5단계 state machine wiring.
  // 단일 스캔 1회 위반 → hard latch 즉시 활성화하던 결함 차단. profile + guards +
  // streak decay 평가 후 state.action='HARD_BLOCK_LATCH' 일 때만 activateR3SanityBlock.
  //
  // ADR-0412 — Holiday/blocked-day/frozen quote 시 streak skip:
  //   - r3StreakSkipped.skipped=true 시 evaluateR3ViolationState 자체 호출 skip
  //     → 영속 streak 무영향 + 24h decay 보존.
  //   - frozenQuoteDataQuality (옵셔널) 를 R3 guard 6번째로 전달 → STALE/SUSPECT 시
  //     hardBlockAllowed=false → SHADOW_ONLY cap.
  try {
    const sanity = evaluateR3Sanity(_lastScanSummary);
    const skipStreak = options.r3StreakSkipped?.skipped === true;
    // ADR-0436 — shadowObservable > 0 시 GATE1_PASS_ZERO streak 누적 차단.
    // 사용자 명시 §7 — *"실매수 후보 0 ≠ 학습/관측 후보 0"*. DATA_UNAVAILABLE/
    // PROVIDER_DEGRADED 우세 시 학습 후보 존재 = 시스템 결함 아님 → R3 sanity 평가 자체 skip.
    //
    // sanity.violation 직접 분기 회피 (state machine 캡슐화 보존, ADR-0401 절대 원칙 #8).
    // GATE1_PASS_ZERO 조건 — R3 + entries=0 + gate1Pass<1 — 을 ScanSummary 직접 검사로 도출.
    const isGate1Zero =
      _lastScanSummary.gatePassDistribution !== undefined &&
      _lastScanSummary.gatePassDistribution.gate1Pass < 1 &&
      _lastScanSummary.candidates >= 1;
    const shadowObservablePresent = (_lastScanSummary.shadowObservableCount ?? 0) > 0;
    const dataUnavailableDominant = isGate1Zero && shadowObservablePresent;

    // ADR-0448 Phase 0 — R3 Noise Governor wiring (helper 위임).
    const r3NoiseDecision = isGate1Zero
      ? buildR3NoiseDecision({ summary: _lastScanSummary, options, kstNow })
      : undefined;
    if (r3NoiseDecision) _lastScanSummary.r3NoiseDecision = r3NoiseDecision;
    const noiseGovernorSkip = r3NoiseDecision?.streakImpact === 0;

    if (sanity.violation !== 'NONE' && !skipStreak && !dataUnavailableDominant && !noiseGovernorSkip) {
      const regime = _lastScanSummary.macroGateState?.regime ?? '';
      const guards = {
        candidates: _lastScanSummary.candidates,
        sectorEnergyDataQuality: _lastScanSummary.sectorEnergyQuality,
        marketDataFreshness: options.marketDataFreshness ?? 'FRESH',
        volumeClockAllowsEntry: options.volumeClockAllowsEntry ?? true,
        // GatePassDistribution 산출 정상 — _lastScanSummary.gatePassDistribution 존재 +
        // sanity.violation !== 'GATE_PASS_DATA_MISSING' (별도 분기에서 hardBlock 차단됨).
        gatePassDistributionFresh:
          _lastScanSummary.gatePassDistribution !== undefined &&
          sanity.violation !== 'GATE_PASS_DATA_MISSING',
        // ADR-0412 — 6번째 guard. options.frozenQuote 부재 시 undefined (legacy 호환).
        frozenQuoteDataQuality: options.frozenQuote?.dataQuality,
      };
      const scanId = `${kstNow.toISOString().slice(0, 10)}:${timeLabel}`;
      const stateResult = evaluateR3ViolationState({
        violation: sanity.violation,
        regime,
        scanId,
        guards,
      });

      _lastScanSummary.r3ViolationState = stateResult;

      // HARD_BLOCK_LATCH 일 때만 영속 latch 생성 (ADR-0120 정합).
      if (stateResult.action === 'HARD_BLOCK_LATCH') {
        activateR3SanityBlock({
          violation: sanity.violation,
          regime,
          message: sanity.message,
        });
      }

      // 상태별 텔레그램 알림 — dedupeKey 에 state + count 포함하여 단계 전이 시 정상 발송.
      if (stateResult.action !== 'NONE' && sanity.message) {
        const stateLabel = stateResult.state.toLowerCase();
        const kstDate = kstNow.toISOString().slice(0, 10);
        const dedupeKey = `r3_sanity:${stateLabel}:${kstDate}:${stateResult.consecutiveCount}`;
        const message = formatR3StateMessage(stateResult, sanity.message);
        await sendTelegramAlert(message, {
          priority: 'HIGH',
          category: 'r3_sanity',
          dedupeKey,
          cooldownMs: 24 * 3_600_000,
        } as Parameters<typeof sendTelegramAlert>[1]).catch(console.error);
      }
    }
  } catch (e) {
    console.warn('[ADR-0401] R3 Violation State Machine 평가 실패:', e);
  }
}

/**
 * ADR-0401 — 5단계 state 별 메시지 빌더 SSOT.
 * 본문은 ADR-0120 의 r3SanityCheck 메시지 그대로 + state 헤더 + 누적 count + guard 사유.
 */
function formatR3StateMessage(state: R3ViolationStateResult, baseMessage: string): string {
  const stateHeader: Record<R3ViolationStateResult['state'], string> = {
    CLEAN: '✅ <b>[R3 Sanity — CLEAN]</b>',
    WARNING: '🟡 <b>[R3 Sanity — WARNING]</b>',
    ELEVATED: '🟠 <b>[R3 Sanity — ELEVATED]</b>',
    SHADOW_ONLY: '⚫️ <b>[R3 Sanity — SHADOW_ONLY (신규 진입 차단, 학습 유지)]</b>',
    HARD_BLOCK: '🚨 <b>[R3 Sanity — HARD_BLOCK (영속 latch 활성)]</b>',
  };
  const lines: string[] = [];
  lines.push(stateHeader[state.state]);
  lines.push(
    `누적 ${state.consecutiveCount}회 (임계: warning ${state.profile.warningAt}/elevated ${state.profile.elevatedAt}/` +
      `shadow ${state.profile.shadowOnlyAt}/hard ${state.profile.hardBlockAt}, regime=${state.regime})`,
  );
  if (state.guardReasons.length > 0) {
    lines.push(`hardBlock guards 활성: ${state.guardReasons.slice(0, 3).join('; ')}`);
  }
  lines.push('');
  lines.push(baseMessage);
  if (state.state === 'HARD_BLOCK') {
    lines.push('');
    lines.push('해제: <code>/r3_unblock</code> (텔레그램, ADR-0195) 또는 ENV ACK (ADR-0120)');
  } else if (state.state === 'SHADOW_ONLY') {
    lines.push('');
    lines.push('<i>다음 정상 스캔 (위반 없음 또는 24h decay) 시 자동 회복 — 영속 latch 없음 (ADR-0401).</i>');
  }
  return lines.join('\n');
}

// ─── ADR-0118 §"진단 추정" 확장 — TECHNICAL_PROVIDER_DEGRADED 운영자 노출 ───
/**
 * ADR-0411 의 Yahoo↔KIS 괴리 KIS recovery 종목 마커 (`technicalProviderDegraded=true`)
 * 를 운영자가 `/scan_blockers` 1 명령으로 즉시 인지하도록 표면화. 시계열 evaluator
 * 14개 PROVIDER_DEGRADED 강등 → score=0 자연 진입 차단 상태 가시화.
 *
 * ENV `SCAN_BLOCKERS_PROVIDER_DEGRADED_DISABLED=true` 시 섹션 미노출 (default ON).
 * ADR-0157 정확 비교 의무 정합.
 */
const TECHNICAL_PROVIDER_DEGRADED_TOP_N = 5;

export function isScanBlockersProviderDegradedDisabled(): boolean {
  return process.env.SCAN_BLOCKERS_PROVIDER_DEGRADED_DISABLED === 'true';
}

function formatKstHm(iso: string | undefined): string | null {
  if (!iso) return null;
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return null;
  const kst = new Date(ts + 9 * 3_600_000);
  const hh = String(kst.getUTCHours()).padStart(2, '0');
  const mm = String(kst.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * TECHNICAL_PROVIDER_DEGRADED 종목 섹션 SSOT 빌더.
 *
 * 입력: WatchlistEntry 배열 (호출자 책임 — `loadWatchlist()` 결과 그대로).
 * 출력: 섹션 string 또는 null.
 *
 * null 반환 조건:
 *   - ENV `SCAN_BLOCKERS_PROVIDER_DEGRADED_DISABLED=true`
 *   - degraded 종목 0건
 *
 * 정렬: `technicalProviderDegradedAt` 내림차순 (최신 먼저), 부재 시 `addedAt` fallback,
 * 잘못된 ISO 도 안전 fallback (정렬 후순위).
 *
 * Top N 기본 5, 초과 시 "외 M개" 라벨.
 */
export function formatTechnicalProviderDegradedSection(
  entries: ReadonlyArray<WatchlistEntry>,
  options: { topN?: number } = {},
): string | null {
  if (isScanBlockersProviderDegradedDisabled()) return null;

  const degraded = entries.filter((e) => e.technicalProviderDegraded === true);
  if (degraded.length === 0) return null;

  const topN = Math.max(1, options.topN ?? TECHNICAL_PROVIDER_DEGRADED_TOP_N);

  const sorted = [...degraded].sort((a, b) => {
    const aIso = a.technicalProviderDegradedAt ?? a.addedAt;
    const bIso = b.technicalProviderDegradedAt ?? b.addedAt;
    const aTs = Date.parse(aIso);
    const bTs = Date.parse(bIso);
    const aValid = Number.isFinite(aTs);
    const bValid = Number.isFinite(bTs);
    if (!aValid && !bValid) return 0;
    if (!aValid) return 1; // invalid → after valid
    if (!bValid) return -1;
    return bTs - aTs; // desc
  });

  const shown = sorted.slice(0, topN);
  const remaining = degraded.length - shown.length;

  const lines: string[] = [];
  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━');
  lines.push('⚠️ <b>[기술 데이터 PROVIDER_DEGRADED]</b>');
  lines.push('Yahoo↔KIS 괴리로 시계열 evaluator 강등 (ADR-0411)');
  lines.push('');
  lines.push(`대상 ${degraded.length}개${remaining > 0 ? ` — Top ${topN}` : ''}:`);
  for (const entry of shown) {
    const tsLabel = formatKstHm(entry.technicalProviderDegradedAt);
    lines.push(`  • ${entry.code} ${entry.name}${tsLabel ? ` (${tsLabel} KST)` : ''}`);
  }
  if (remaining > 0) {
    lines.push(`  • 외 ${remaining}개`);
  }
  lines.push('');
  lines.push('영향:');
  lines.push('  • 신규 진입 자연 차단 (시계열 evaluator score=0)');
  lines.push('  • 학습 데이터 계속 수집');
  lines.push('  • WATCHLIST_HOLD — universe 보존');

  return lines.join('\n');
}

// ─── ADR-0412 — Frozen Quote Detector + R3 Streak Skip 표시 ───
/**
 * Frozen Quote 섹션 SSOT 빌더 — `/scan_blockers` 메시지 추가용.
 *
 * dataQuality === 'OK' 시 null (간결성 — 정상 시 미노출).
 * 사용자 명시 정책:
 *   - "매수 차단" 표현 금지 (frozen quote 는 데이터 품질 진단, 매수 차단 아님)
 *   - "결함" / "에러" 표현 금지 — "데이터 품질 문제" 로 분류
 */
export function formatFrozenQuoteSection(fq: FrozenQuoteResult | undefined | null): string | null {
  if (!fq) return null;
  if (fq.dataQuality === 'OK') return null;

  const icon = fq.dataQuality === 'STALE' ? '🔴' : '🟠';
  const label = fq.dataQuality === 'STALE' ? 'STALE' : 'SUSPECT';
  const ratioPct = (fq.frozenRatio * 100).toFixed(1);
  const lines: string[] = [];
  lines.push('');
  lines.push(`${icon} <b>[Frozen Quote — 데이터 품질 진단]</b>`);
  lines.push(
    `  • dataQuality: <b>${label}</b> (${ratioPct}%, ${fq.frozenCount}/${fq.comparableCount} 종목)`,
  );
  lines.push(`  • 사유: ${fq.reason}`);
  if (fq.symbols.length > 0) {
    lines.push(`  • 영향 종목: ${fq.symbols.slice(0, 5).join(', ')}${fq.symbols.length > 5 ? ` 외 ${fq.symbols.length - 5}개` : ''}`);
  }
  lines.push('');
  lines.push('영향 (ADR-0412):');
  lines.push('  • R3 hard block 누적 제외 (입력 데이터 오염 — guard 활성)');
  lines.push('  • Shadow learning 유지 — 학습 데이터 보존');
  lines.push('  • <i>가격 데이터 품질 문제 — 다음 스캔 시 자동 회복 가능</i>');

  return lines.join('\n');
}

/**
 * R3 Streak Skip 라인 빌더 — `/scan_blockers` 메시지 추가용.
 *
 * `skipped=false` 시 null (정상 누적 — 미노출).
 * 사용자 명시:
 *   - "R3 hard block 누적 제외" 표현 사용 (매수 차단 아님)
 */
export function formatR3StreakSkipLine(skip: { skipped: boolean; reason?: string } | undefined | null): string | null {
  if (!skip || !skip.skipped) return null;

  const reasonLabels: Record<string, string> = {
    KRX_NON_TRADING_DAY: 'KRX_NON_TRADING_DAY (휴장일/주말)',
    VOLUME_CLOCK_CLOSED: 'VOLUME_CLOCK_CLOSED (점심·장외 시간대)',
    EMERGENCY_STOP: 'EMERGENCY_STOP (운영자 비상정지)',
    MANUAL_BLOCK_NEW_BUY: 'MANUAL_BLOCK_NEW_BUY (운영자 수동 가드)',
    SELL_ONLY_MODE: 'SELL_ONLY_MODE (운영자 정책 차단)',
    R6_DEFENSE_REGIME: 'R6_DEFENSE_REGIME (블랙스완 방어)',
    VIX_BLOCK: 'VIX_BLOCK (VIX 게이팅)',
    FOMC_BLOCK: 'FOMC_BLOCK (FOMC 게이팅)',
    BLOCKED_DAY_SCAN: 'BLOCKED_DAY_SCAN (거시 게이트)',
    DATA_STARVED_SCAN: 'DATA_STARVED_SCAN (MTAS/DART 결손)',
    FROZEN_QUOTE_STALE: 'FROZEN_QUOTE_STALE (입력 데이터 오염)',
  };
  const label = skip.reason ? (reasonLabels[skip.reason] ?? skip.reason) : '미상';

  return `⏸ <b>[R3 Streak]</b> R3 hard block 누적 제외 — ${label} (ADR-0412/0419)`;
}

// ─── ADR-0414 — Price Integrity Checker + Correction Overlay (Stage 1 Read-Only) ───
/**
 * Price Integrity 섹션 SSOT 빌더 — `/scan_blockers` 메시지 추가용 (Stage 1 Read-Only).
 *
 * 모든 status === 'OK' 시 null (간결성 — 정상 시 미노출).
 *
 * 사용자 명시 정책:
 *   - "매수 차단" 표현 **금지** — Stage 1 Read-Only, 진단 only.
 *   - "결함" / "에러" 표현 **금지** — "데이터 품질 문제" (ADR-0412 정합).
 *   - Stage 1 표기 — "관측 + 검증" 명시.
 */
export function formatPriceIntegritySection(
  pi:
    | {
        totalSamples: number;
        statusCounts: Record<PriceIntegrityStatus, number>;
        topAffected: Array<{ symbol: string; status: PriceIntegrityStatus }>;
      }
    | undefined
    | null,
): string | null {
  if (!pi) return null;
  if (pi.totalSamples <= 0) return null;
  // OK 외 status 카운트 합산 — 모두 0 시 미노출
  const affectedTotal =
    (pi.statusCounts.SUSPECT ?? 0) +
    (pi.statusCounts.STALE ?? 0) +
    (pi.statusCounts.FROZEN_QUOTE ?? 0) +
    (pi.statusCounts.PRICE_BASE_MISMATCH ?? 0) +
    (pi.statusCounts.REVERSE_GAP_SUSPECT ?? 0) +
    (pi.statusCounts.FAILED ?? 0);
  if (affectedTotal === 0) return null;

  const lines: string[] = [];
  lines.push('');
  lines.push('🔍 <b>[Price Integrity — Stage 1 관측]</b>');
  lines.push(
    `  • 표본 ${pi.totalSamples}개 / 영향 ${affectedTotal}개 (OK 외)`,
  );
  // 분포 상위 표기 — 0건 status 미노출
  const orderedStatuses: ReadonlyArray<PriceIntegrityStatus> = [
    'PRICE_BASE_MISMATCH',
    'STALE',
    'REVERSE_GAP_SUSPECT',
    'SUSPECT',
    'FROZEN_QUOTE',
    'FAILED',
  ];
  for (const s of orderedStatuses) {
    const c = pi.statusCounts[s] ?? 0;
    if (c > 0) {
      lines.push(`  • ${s}: ${c}개`);
    }
  }
  if (pi.topAffected.length > 0) {
    const top = pi.topAffected.slice(0, 5);
    const top5 = top.map((t) => `${t.symbol}(${t.status})`).join(', ');
    const remain = pi.topAffected.length - top.length;
    lines.push(
      `  • 영향 종목 Top: ${top5}${remain > 0 ? ` 외 ${remain}개` : ''}`,
    );
  }
  lines.push('');
  lines.push('영향 (ADR-0414, Stage 1):');
  lines.push('  • 데이터 품질 진단 — 매수 차단 아님');
  lines.push('  • <i>관측 + 검증 단계 — 의사결정 변경 0건</i>');

  return lines.join('\n');
}

/**
 * Price Correction Overlay 섹션 SSOT 빌더 — `/scan_blockers` 메시지 추가용 (Stage 1 Read-Only).
 *
 * `correctionType` 분포 + averageConfidence + DROP_GAP_CALCULATION 카운트 노출.
 * `correctionType === 'NONE'` 만 있을 시 null (정상 — 미노출).
 *
 * **Stage 1 정책 명시** — corrected 값 LIVE 매수 판단 사용 0건 (절대 원칙 #3).
 */
export function formatPriceCorrectionOverlaySection(
  pc:
    | {
        totalSamples: number;
        correctionTypeCounts: Record<PriceCorrectionType, number>;
        averageConfidence: number;
        dropGapCalculationCount: number;
        shadowOnlySuggestedCount: number;
      }
    | undefined
    | null,
): string | null {
  if (!pc) return null;
  if (pc.totalSamples <= 0) return null;
  const noneCount = pc.correctionTypeCounts.NONE ?? 0;
  const totalNonNone = pc.totalSamples - noneCount;
  if (totalNonNone <= 0) return null;

  const lines: string[] = [];
  lines.push('');
  lines.push('🛠 <b>[Price Correction Overlay — Stage 1 Read-Only]</b>');
  lines.push(
    `  • 표본 ${pc.totalSamples}개 / 보정 후보 ${totalNonNone}개 (NONE 제외)`,
  );
  lines.push(
    `  • 평균 confidence: ${pc.averageConfidence.toFixed(3)}`,
  );
  // 분포 상위 표기 — 0건 type 미노출, NONE 마지막
  const orderedTypes: ReadonlyArray<PriceCorrectionType> = [
    'USE_KIS_CURRENT',
    'USE_KRX_PREV_CLOSE',
    'USE_RECENT_DAILY_CLOSE',
    'DROP_GAP_CALCULATION',
    'SHADOW_ONLY',
  ];
  for (const t of orderedTypes) {
    const c = pc.correctionTypeCounts[t] ?? 0;
    if (c > 0) {
      lines.push(`  • ${t}: ${c}개`);
    }
  }
  if (pc.dropGapCalculationCount > 0) {
    lines.push(
      `  • <i>DROP_GAP_CALCULATION ${pc.dropGapCalculationCount}건 — 사용자 명시: 틀린 gap 계산보다 gap 미사용 우월</i>`,
    );
  }
  if (pc.shadowOnlySuggestedCount > 0) {
    lines.push(
      `  • SHADOW_ONLY ${pc.shadowOnlySuggestedCount}건 — 보정 불가, Shadow learning 만`,
    );
  }
  lines.push('');
  lines.push('영향 (ADR-0414, Stage 1):');
  lines.push('  • <b>corrected 값 LIVE 매수 판단 사용 0건</b> (절대 원칙 #3)');
  lines.push('  • 관측 + 검증만 — 의사결정 변경은 Stage 2/3 후속 PR');

  return lines.join('\n');
}

// ADR-0436 — Gate Eligibility Split 진단 섹션은 별도 파일로 분리 (ADR-0133 1500줄 한계).
//   `formatGateEligibilitySplitSection` SSOT 는 server/trading/signalScanner/gateEligibilitySection.ts
//   에서 import + re-export 하여 외부 호출자 (scanBlockers.cmd 등) 무수정 호환.
