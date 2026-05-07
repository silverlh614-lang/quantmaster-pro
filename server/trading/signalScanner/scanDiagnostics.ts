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

  const emptyReason = classifyEmptyScanReason(summaryDraft);
  if (emptyReason) summaryDraft.emptyScanReason = emptyReason;
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
    if (sanity.violation !== 'NONE' && !skipStreak) {
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
