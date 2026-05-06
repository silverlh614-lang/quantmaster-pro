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
  };
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
  };

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
  try {
    const sanity = evaluateR3Sanity(_lastScanSummary);
    if (sanity.violation !== 'NONE') {
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
