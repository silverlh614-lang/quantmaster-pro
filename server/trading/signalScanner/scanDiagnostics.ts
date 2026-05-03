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

/** ADR-0118: WAIT 사유별 분포 — 매수 0건 시 *어떤 게이트가 차단했는지* 즉시 진단. */
export interface WaitDistribution {
  /** ADR-0117 DATA_HOLD 분기 진입 (sanity 위반 거래 차단) */
  dataHold: number;
  /** pre-breakout 미도달 (ADR-0115 WAIT) */
  preBreakout: number;
  /** Gate 재검증 미달 (entryRevalidationStep fail) */
  gateFail: number;
  /** sizingTier BLOCKED (DATA_QUARANTINE 또는 tier=null) */
  sizingBlocked: number;
  /** entryPrice drift +10% AUTO 제거 */
  driftRemove: number;
  /** ADR-0113 CORPORATE_ACTION 분기 */
  corpAction: number;
  /** 거래량 급감 reject */
  volumeDrop: number;
  /** 분류 안된 기타 reject */
  other: number;
}

/**
 * ADR-0120 (PR-B): Gate 1/2/3 통과 분포 — *어느 단계까지 통과했는지* 진단.
 * 사용자 9번 §5 의 NO_LEADERSHIP/NO_TIMING 분류 + §6 R3 Sanity Check 입력.
 *
 * stock.gateEvaluation.gate1Passed / gate2Passed / gate3Passed 에서 carry-over.
 */
export interface GatePassDistribution {
  /** Gate 1 (생존 필터) 통과 종목 수 — 27조건 중 6조건 (1/2/3/5/7/9) */
  gate1Pass: number;
  /** Gate 2 (성장 검증) 통과 종목 수 — 27조건 중 12조건 */
  gate2Pass: number;
  /** Gate 3 (정밀 타이밍) 통과 종목 수 — 27조건 중 9조건 */
  gate3Pass: number;
  /** lastTrigger (매수 트리거) 발동 종목 수 */
  lastTriggerPass: number;
}

/**
 * ADR-0118: 거시 게이트 활성화 상태 진단 SSOT.
 * /scan_blockers 텔레그램 명령이 표시할 *왜 매수가 안 되는지* 의 1차 원인 분류.
 */
export interface MacroGateState {
  emergencyStop: boolean;
  autoTradeEnabled: boolean;
  regime: string;                  // R1~R6 / NORMAL
  kellyMultiplierFromRegime: number;
  fomcPhase: string;               // NORMAL / PRE_3 / PRE_2 / PRE_1 / DAY / POST_1 / POST_2
  fomcKellyMultiplier: number;
  finalKellyMultiplier: number;    // combineRegimeAndFomcKelly 결과
  vixGatingActive: boolean;
  bearDefenseMode: boolean;
  mhsBelow30: boolean;
  watchlistEmpty: boolean;
  sellOnlyMode: boolean;
}

export interface ScanSummary {
  time: string;          // "HH:MM KST"
  candidates: number;    // SWING + CATALYST + Intraday 합산
  /** @deprecated trackB → swing + catalyst 합산. 하위 호환용. */
  trackB: number;        // buyList.length (main 워치리스트)
  swing: number;         // SWING 섹션 매수 대상 수
  catalyst: number;      // CATALYST 섹션 매수 대상 수
  momentum: number;      // MOMENTUM 섹션 관찰 전용 수
  yahooFails: number;    // Yahoo + KIS fallback 모두 실패한 종목 수
  gateMisses: number;    // entryRevalidation 탈락 수
  rrrMisses: number;     // RRR < 최솟값 탈락 수
  entries: number;       // 실제 진입(Shadow 포함 신호 등록) 수
  /** ADR-0118: WAIT 사유 분포 (옵셔널 — 후방호환). */
  waitDistribution?: WaitDistribution;
  /** ADR-0118: 거시 게이트 상태 (옵셔널 — 후방호환). */
  macroGateState?: MacroGateState;
  /** ADR-0119: 빈스캔 원인 7값 코드 (옵셔널 — entries=0 시에만 부여). */
  emptyScanReason?: EmptyScanReason;
  /** ADR-0120 (PR-B): Gate 1/2/3 통과 분포 (옵셔널 — 후방호환). */
  gatePassDistribution?: GatePassDistribution;
  /** ADR-0127 (PR-3): sectorEnergy 데이터 품질 — macroState 에서 carry-over. */
  sectorEnergyQuality?: 'OK' | 'PARTIAL' | 'STALE' | 'FAILED';
  /** ADR-0127 (PR-3): 12 섹터 중 유효 섹터 수 (returns.length>0). */
  validSectorCount?: number;
  /** ADR-0127 (PR-3): sectorEnergy 분류 사유 (debug용, 빈 배열 가능). */
  sectorEnergyReasons?: string[];
}

let _lastBuySignalAt = 0;
let _consecutiveZeroScans = 0;
let _lastScanSummary: ScanSummary | null = null;

export function getLastBuySignalAt(): number    { return _lastBuySignalAt; }
export function getLastScanSummary(): ScanSummary | null { return _lastScanSummary; }
export function getConsecutiveZeroScans(): number { return _consecutiveZeroScans; }

export function setLastBuySignalAt(ts: number): void {
  _lastBuySignalAt = ts;
}

/**
 * 스캔 카운터 — perSymbolEvaluation 가 mutate. 스캔 1회당 1개 인스턴스 사용.
 * 글로벌 상태가 아니라 스캔별 객체로 분리해 동시 스캔/테스트 격리 가능.
 */
export interface ScanCounters {
  yahooFails: number;
  gateMisses: number;
  rrrMisses: number;
  entries: number;
  counterfactualRecordedToday: number;
  pendingTraces: ScanTrace[];

  // ADR-0118: WAIT 사유 분포 카운터 (perSymbolEvaluation 가 분기별 mutate).
  waitDataHold: number;
  waitPreBreakout: number;
  waitGateFail: number;
  waitSizingBlocked: number;
  waitDriftRemove: number;
  waitDriftCorpAction: number;
  waitVolumeDrop: number;
  waitOther: number;

  // ADR-0120 (PR-B): Gate 1/2/3 통과 카운터 (perSymbolEvaluation 가 stock.gateEvaluation 기반 mutate).
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

/**
 * ADR-0120 (PR-B): ScanCounters → GatePassDistribution 변환 SSOT.
 * persistScanResults 가 ScanSummary.gatePassDistribution 영속 시 사용.
 */
export function buildGatePassDistribution(counters: ScanCounters): GatePassDistribution {
  return {
    gate1Pass:       counters.gate1Pass,
    gate2Pass:       counters.gate2Pass,
    gate3Pass:       counters.gate3Pass,
    lastTriggerPass: counters.lastTriggerPass,
  };
}

/**
 * ADR-0118: ScanCounters → WaitDistribution 변환 SSOT.
 * persistScanResults 가 ScanSummary.waitDistribution 영속 시 사용.
 */
export function buildWaitDistribution(counters: ScanCounters): WaitDistribution {
  return {
    dataHold:      counters.waitDataHold,
    preBreakout:   counters.waitPreBreakout,
    gateFail:      counters.waitGateFail,
    sizingBlocked: counters.waitSizingBlocked,
    driftRemove:   counters.waitDriftRemove,
    corpAction:    counters.waitDriftCorpAction,
    volumeDrop:    counters.waitVolumeDrop,
    other:         counters.waitOther,
  };
}

/**
 * ADR-0118: 거시 게이트 상태 빌더 SSOT.
 * preflight + macroState + autoTradeSettings 합성 결과를 단일 형태로 노출.
 * 호출자: persistScanResults / scanBlockers 텔레그램 명령.
 */
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

/**
 * ADR-0118: /scan_blockers 텔레그램 메시지 포맷 SSOT.
 * 진단 추정 (`💡 추정 원인:`) 자동 분기.
 */
export function formatScanBlockersMessage(summary: ScanSummary | null): string {
  if (!summary) {
    return '📊 <b>[매수 차단 사유]</b>\n━━━━━━━━━━━━━━━━\n진단 데이터 없음 (스캔 미실행).';
  }

  const wd = summary.waitDistribution;
  const mg = summary.macroGateState;
  const lines: string[] = [];
  lines.push(`📊 <b>[매수 차단 사유 분포]</b> 직전 스캔 (${summary.time})`);
  lines.push('━━━━━━━━━━━━━━━━');

  // 거시 게이트 상태
  if (mg) {
    lines.push('');
    lines.push('🛑 <b>거시 게이트:</b>');
    lines.push(`  • emergencyStop: ${mg.emergencyStop ? '<b>ON ⚠️</b>' : 'off'}`);
    lines.push(`  • autoTradeEnabled: ${mg.autoTradeEnabled ? 'on' : '<b>OFF ⚠️</b>'}`);
    lines.push(`  • 레짐: ${mg.regime} (Kelly ×${mg.kellyMultiplierFromRegime.toFixed(2)})`);
    lines.push(`  • FOMC: ${mg.fomcPhase} (Kelly ×${mg.fomcKellyMultiplier.toFixed(2)}) → 결합 ×${mg.finalKellyMultiplier.toFixed(2)}`);
    if (mg.vixGatingActive) lines.push(`  • VIX 게이팅: <b>ON ⚠️</b>`);
    if (mg.bearDefenseMode) lines.push(`  • bearDefenseMode: <b>ON ⚠️</b>`);
    if (mg.mhsBelow30)     lines.push(`  • MHS<30: <b>ON ⚠️</b>`);
    if (mg.sellOnlyMode)   lines.push(`  • SELL_ONLY: <b>ON ⚠️</b> (점심/장외 시간대)`);
    if (mg.watchlistEmpty) lines.push(`  • 워치리스트: <b>0개 ⚠️</b>`);
  }

  // ADR-0127 (PR-3): sectorEnergy 데이터 품질 진단 표시
  if (summary.sectorEnergyQuality !== undefined) {
    lines.push('');
    lines.push('🌐 <b>섹터 에너지 데이터 품질:</b>');
    const qualityIcon =
      summary.sectorEnergyQuality === 'OK' ? '✅'
      : summary.sectorEnergyQuality === 'PARTIAL' ? '🟡'
      : summary.sectorEnergyQuality === 'STALE' ? '🟠'
      : '❌'; // FAILED
    lines.push(`  • dataQuality: ${qualityIcon} <b>${summary.sectorEnergyQuality}</b>`);
    if (summary.validSectorCount !== undefined) {
      lines.push(`  • validSectorCount: ${summary.validSectorCount}/12`);
    }
    if (summary.sectorEnergyReasons && summary.sectorEnergyReasons.length > 0) {
      lines.push(`  • reasons: ${summary.sectorEnergyReasons.slice(0, 3).join('; ')}`);
    }
    if (summary.sectorEnergyQuality === 'FAILED') {
      lines.push('  • <i>FAILED → emptyScanReason DATA_INVALID 자동 가중 (ADR-0127)</i>');
    }
  }

  // 종목별 차단 분포
  lines.push('');
  lines.push(`📋 <b>종목별 차단</b> (후보 ${summary.candidates}개):`);
  lines.push(`  • 진입: <b>${summary.entries}개</b>`);
  if (wd) {
    if (wd.dataHold > 0)      lines.push(`  • DATA_HOLD: ${wd.dataHold}개 ⚠️`);
    if (wd.gateFail > 0)      lines.push(`  • Gate 재검증 미달: ${wd.gateFail}개`);
    if (wd.preBreakout > 0)   lines.push(`  • Pre-breakout WAIT: ${wd.preBreakout}개`);
    if (wd.sizingBlocked > 0) lines.push(`  • Sizing BLOCKED: ${wd.sizingBlocked}개 ⚠️`);
    if (wd.volumeDrop > 0)    lines.push(`  • 거래량 급감: ${wd.volumeDrop}개`);
    if (wd.driftRemove > 0)   lines.push(`  • Drift REMOVE: ${wd.driftRemove}개`);
    if (wd.corpAction > 0)    lines.push(`  • Corporate Action: ${wd.corpAction}개`);
    if (wd.other > 0)         lines.push(`  • 기타: ${wd.other}개`);
  } else {
    lines.push(`  • Gate 미달: ${summary.gateMisses}개 (waitDistribution 미수집)`);
    lines.push(`  • Yahoo 실패: ${summary.yahooFails}개`);
    lines.push(`  • RRR 미달: ${summary.rrrMisses}개`);
  }

  // ADR-0119: 빈스캔 원인 7값 SSOT 분류 결과 노출
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
  /** ADR-0118: 거시 게이트 상태 (옵셔널 — 미전달 시 ScanSummary.macroGateState 미부여). */
  macroGateState?: MacroGateState;
  /** ADR-0127 (PR-3): sectorEnergy dataQuality (macroState 에서 carry-over). */
  sectorEnergyQuality?: 'OK' | 'PARTIAL' | 'STALE' | 'FAILED';
  /** ADR-0127 (PR-3): 유효 섹터 수. */
  validSectorCount?: number;
  /** ADR-0127 (PR-3): sectorEnergy 분류 사유. */
  sectorEnergyReasons?: string[];
}

/**
 * 스캔 종료 시 호출 — pendingTraces 영속화 + ScanSummary 갱신 + 3회 침묵 알림.
 * 원본 signalScanner.ts L1802-1843 동작과 100% 일치.
 */
export async function persistScanResults(
  counters: ScanCounters,
  options: PersistScanResultsOptions,
): Promise<void> {
  if (!options.sellOnly && counters.pendingTraces.length > 0) {
    appendScanTraces(counters.pendingTraces);
  }

  if (options.sellOnly) {
    return;
  }

  const kstNow = new Date(Date.now() + 9 * 3_600_000);
  const timeLabel = kstNow.toISOString().slice(11, 16) + ' KST';
  const summaryDraft: ScanSummary = {
    time:       timeLabel,
    candidates: options.buyListLength + options.intradayBuyListLength,
    trackB:     options.buyListLength,
    swing:      options.swingListLength,
    catalyst:   options.catalystListLength,
    momentum:   options.momentumListLength,
    yahooFails: counters.yahooFails,
    gateMisses: counters.gateMisses,
    rrrMisses:  counters.rrrMisses,
    entries:    counters.entries,
    // ADR-0118: WAIT 사유 분포 + 거시 게이트 상태 영속.
    waitDistribution: buildWaitDistribution(counters),
    ...(options.macroGateState ? { macroGateState: options.macroGateState } : {}),
    // ADR-0120 (PR-B): Gate 1/2/3 통과 분포 영속.
    gatePassDistribution: buildGatePassDistribution(counters),
    // ADR-0127 (PR-3): sectorEnergy dataQuality carry-over.
    ...(options.sectorEnergyQuality !== undefined
      ? {
          sectorEnergyQuality: options.sectorEnergyQuality,
          validSectorCount: options.validSectorCount,
          sectorEnergyReasons: options.sectorEnergyReasons,
        }
      : {}),
  };
  // ADR-0119: 빈스캔 원인 자동 분류 SSOT — entries > 0 시 null 반환.
  const emptyReason = classifyEmptyScanReason(summaryDraft);
  if (emptyReason) {
    summaryDraft.emptyScanReason = emptyReason;
  }
  _lastScanSummary = summaryDraft;

  if (counters.entries === 0 && _lastScanSummary.candidates > 0) {
    _consecutiveZeroScans++;
  } else {
    _consecutiveZeroScans = 0;
  }

  if (_consecutiveZeroScans >= 3) {
    _consecutiveZeroScans = 0; // 알림 후 리셋 — 스팸 방지
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

  // ADR-0120 (PR-B): R3 Sanity Check — R3 레짐 + Gate 1 통과 0 시 시스템 결함 의심.
  // try/catch 격리 — 진단 알림 실패가 LIVE 매매 흐름 차단 안 함.
  try {
    const sanity = evaluateR3Sanity(_lastScanSummary);
    if (sanity.violation !== 'NONE' && sanity.message) {
      if (sanity.violation === 'CANDIDATES_ZERO' || sanity.violation === 'GATE1_PASS_ZERO') {
        activateR3SanityBlock({
          violation: sanity.violation,
          regime: _lastScanSummary.macroGateState?.regime ?? '',
          message: sanity.message,
        });
      }
      await sendTelegramAlert(sanity.message, {
        priority: 'HIGH',
        category: 'r3_sanity',
        dedupeKey: sanity.dedupeKey,
        cooldownMs: 24 * 3_600_000, // 24h — KST 일자별 1회
      } as Parameters<typeof sendTelegramAlert>[1]).catch(console.error);
    }
  } catch (e) {
    console.warn('[ADR-0120] R3 Sanity Check 실패:', e);
  }
}
