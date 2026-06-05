/**
 * @responsibility Pure line-building helpers for scan blockers Telegram message sections.
 * ADR-0538 display formatter decomposition. Byte-identical output preserved.
 */

import {
  formatScanSummaryDecisionContextAuthorityLines,
  resolveScanSummaryPermissionView,
  type ScanSummaryPermissionView,
} from './scanSummaryDecisionContext.js';
import type { Gate0Decision } from './gate0MacroPermissionDecision.js';
import type { MacroGateState, ScanSummary } from './scanSummaryTypes.js';
import { describeEmptyScanReason } from '../emptyScanClassifier.js';

// Append an optional rendered section with a preceding blank-line separator.
export function pushOptionalSection(lines: string[], section: string | null | undefined): void {
  if (section) {
    lines.push('');
    lines.push(section);
  }
}

// Append an optional rendered section without a separator (caller-managed spacing).
export function pushOptionalSectionRaw(lines: string[], section: string | null | undefined): void {
  if (section) {
    lines.push(section);
  }
}

export function buildMacroGateSection(summary: ScanSummary, mg: MacroGateState): string[] {
  const lines: string[] = [];
  lines.push('');
  lines.push('🛑 <b>거시 게이트:</b>');
  lines.push(`  • emergencyStop: ${mg.emergencyStop ? '<b>ON ⚠️</b>' : 'off'}`);
  lines.push(`  • autoTradeEnabled: ${mg.autoTradeEnabled ? 'on' : '<b>OFF ⚠️</b>'}`);
  const displayRegime = mg.displayRegime ?? mg.regime;
  const legacyEffectiveRegime = mg.macroRegimeEffective ?? mg.regime;
  const staleLegacyR6Path =
    legacyEffectiveRegime === 'R6_DEFENSE' &&
    displayRegime !== 'R6_DEFENSE' &&
    mg.regime !== 'R6_DEFENSE';
  const { lines: decisionContextLines, bundle } = formatScanSummaryDecisionContextAuthorityLines(summary);
  const permissionView = bundle?.permissionView ?? resolveScanSummaryPermissionView(summary);
  const gate0Decision = bundle?.gate0Decision;
  // INV-5 cross-screen parity: 비교 대상 snapshotId 는 ScanSummary 정본 식별자(snapshotId). 다르면 DIFFERENT_SNAPSHOT 명시.
  for (const line of decisionContextLines) {
    lines.push(`  • ${line}`);
  }
  lines.push(`  • Kelly ×${mg.finalKellyMultiplier.toFixed(2)} (regime ×${mg.kellyMultiplierFromRegime.toFixed(2)}, FOMC ×${mg.fomcKellyMultiplier.toFixed(2)})`);
  if (gate0Decision) lines.push(`  • Gate0 Macro/Permission: sourceHealth=${gate0Decision.sourceHealth} sourceFreshness=${gate0Decision.sourceFreshness} macroSignalConfidence=${gate0Decision.macroSignalConfidence} macroMarketSignal=${gate0Decision.macroMarketSignal} usableForLiveOrder=${gate0Decision.usableForLiveOrder} usableForBrokerOrder=${gate0Decision.usableForBrokerOrder} snapshotFreshnessForLive=${gate0Decision.snapshotFreshnessForLive} liveBlockReason=${gate0Decision.liveBlockReason} liveBlockSubReason=${gate0Decision.liveBlockSubReason ?? 'NONE'} finalExecutionPolicy=${gate0Decision.finalExecutionPolicy} shadowAllowed=${gate0Decision.shadowAllowed} counterfactualAllowed=${gate0Decision.counterfactualAllowed} diagnosticAllowed=${gate0Decision.diagnosticAllowed} snapshotStaleCause=${gate0Decision.snapshotStaleCause ?? 'NONE'}`);
  lines.push(...buildMacroR6RecoveryLines(mg, staleLegacyR6Path));
  lines.push(...buildMacroPermissionFlagLines(mg, permissionView));
  lines.push(`  • FOMC: ${mg.fomcPhase} (점수/신뢰도 보정만 적용, executionImpact=NONE)`);
  if (mg.vixGatingActive) lines.push(`  • VIX 게이팅: <b>ON ⚠️</b>`);
  if (mg.bearDefenseMode) lines.push(`  • bearDefenseMode: <b>ON ⚠️</b>`);
  if (mg.mhsBelow30) lines.push(`  • MHS<30: <b>ON ⚠️</b>`);
  if (mg.diagnosticLiveEntryBlocked) {
    lines.push(...buildDiagnosticLiveEntryBlockedLines(mg, gate0Decision));
  }
  if (mg.sellOnlyMode) {
    lines.push('  Legacy defense policy input detected - executionImpact=NONE');
    lines.push('  removedPolicy: LEGACY_DEFENSE_POLICY_REMOVED');
    lines.push('  Current buy permission uses Gate/data quality only.');
    lines.push('  shadow note: Shadow/Counterfactual snapshot preserved; executionImpact=NONE.');
  }
  if (mg.watchlistEmpty) lines.push(`  • 워치리스트: <b>0개 ⚠️</b>`);
  return lines;
}

function buildMacroR6RecoveryLines(mg: MacroGateState, staleLegacyR6Path: boolean): string[] {
  const lines: string[] = [];
  if (staleLegacyR6Path) {
    lines.push(`  • legacyR6Path: legacyR6RecoveryStatus=${mg.r6RecoveryStatus ?? 'NONE'}`);
  } else {
    if (mg.r6RecoveryStatus) lines.push(`  • r6RecoveryStatus: ${mg.r6RecoveryStatus}`);
    if (mg.activeR6Triggers) lines.push(`  • activeR6Triggers: [${mg.activeR6Triggers.join(',') || 'none'}]`);
    if (mg.r6ShockLatch !== undefined) lines.push(`  • r6ShockLatch: ${mg.r6ShockLatch}`);
    if (mg.recoveryBlockedReason) lines.push(`  • recoveryBlockedReason: ${mg.recoveryBlockedReason}`);
    if (mg.recoveryBlockedReason === 'R6_COOLDOWN_ACTIVE' && mg.cooldownUntil) {
      const expiresMs = Date.parse(mg.cooldownUntil);
      const nowMs = Date.now();
      const remainingMin = Number.isFinite(expiresMs) ? Math.max(0, Math.ceil((expiresMs - nowMs) / 60_000)) : null;
      lines.push(`  • cooldownExpiresAt: ${mg.cooldownUntil}${remainingMin !== null ? ` (remainingMin=${remainingMin})` : ''}`);
    }
  }
  return lines;
}

function buildMacroPermissionFlagLines(mg: MacroGateState, permissionView: ScanSummaryPermissionView): string[] {
  const lines: string[] = [];
  if (mg.liveEntryAllowed !== undefined) lines.push(`  • liveEntryAllowed: ${permissionView.liveEntryAllowed}`);
  if (mg.liveExitAllowed !== undefined) lines.push(`  • liveExitAllowed: ${mg.liveExitAllowed}`);
  if (mg.shadowBuyAllowed !== undefined) lines.push(`  • shadowBuyAllowed: ${mg.shadowBuyAllowed}`);
  if (mg.shadowSellAllowed !== undefined) lines.push(`  • shadowSellAllowed: ${mg.shadowSellAllowed}`);
  if (mg.shadowLearningAllowed !== undefined) lines.push(`  • shadowLearningAllowed: ${mg.shadowLearningAllowed}`);
  if (mg.counterfactualAllowed !== undefined) lines.push(`  • counterfactualAllowed: ${mg.counterfactualAllowed}`);
  if (mg.brokerOrderAllowed !== undefined || mg.brokerRouteAlive !== undefined) {
    lines.push(`  • brokerRouteAlive: ${permissionView.brokerRouteAlive}`);
    lines.push(`  • brokerLiveOrderAllowed: ${permissionView.brokerLiveOrderAllowed}`);
    lines.push(`  • brokerExitOrderAllowed: ${permissionView.brokerExitOrderAllowed}`);
    lines.push(`  • paperOrderAllowed: ${permissionView.paperOrderAllowed}`);
  }
  return lines;
}

function buildDiagnosticLiveEntryBlockedLines(
  mg: MacroGateState,
  gate0Decision: Gate0Decision | undefined,
): string[] {
  const lines: string[] = [];
  const liveEntryBlockedReason = String(mg.liveEntryBlockedReason ?? 'DIAGNOSTIC_ONLY').toUpperCase();
  const removedPolicyReason = liveEntryBlockedReason.includes('SELL_ONLY') || liveEntryBlockedReason.includes('R6_DEFENSE');
  lines.push(`  • liveEntryBlocked: <b>${removedPolicyReason ? 'LEGACY_POLICY_INPUT_IGNORED' : liveEntryBlockedReason.includes('R3_SANITY_GUARD') ? 'SHADOW_ONLY_MODE' : gate0Decision?.liveBlockReason ?? 'DIAGNOSTIC_ONLY'}</b>${liveEntryBlockedReason.includes('R3_SANITY_GUARD') ? ' (subReason=R3_SANITY_GUARD)' : gate0Decision?.liveBlockSubReason ? ` (subReason=${gate0Decision.liveBlockSubReason})` : ''} (diagnostics continue; Shadow/Paper/Counterfactual allowed)`);
  // R3 sanity OBSERVE_ONLY 강등 가시화 — hard-abort 가 아닌 execution guard 임을 명시 (hardBlockSource=NONE).
  if (liveEntryBlockedReason.includes('R3_SANITY_GUARD')) {
    lines.push('  • executionGuardSource: <b>R3_SANITY_DIAGNOSTIC_GUARD</b> (hardBlockSource=NONE)');
    lines.push('  • preflightDecision: <b>OBSERVE_ONLY_DIAGNOSTIC_CARRIED</b>');
  }
  return lines;
}

export interface SectorEnergyQualitySectionInput {
  sectorEnergyQuality: ScanSummary['sectorEnergyQuality'];
  validSectorCount: ScanSummary['validSectorCount'];
  sectorEnergyReasons: ScanSummary['sectorEnergyReasons'];
  sectorEnergyCanonicalState: NonNullable<ScanSummary['sectorEnergySupplyUnknownAdr0488']>['sectorEnergyCanonicalState'] | undefined;
}

export function buildSectorEnergyQualitySection(input: SectorEnergyQualitySectionInput): string[] {
  const lines: string[] = [];
  lines.push('');
  const sectorCanonical = input.sectorEnergyCanonicalState;
  if (sectorCanonical && sectorCanonical.promotionCoveragePass === true) {
    // ADR-0534 follow-up: canonical PASS → VERIFIED summary. legacy basket/PARTIAL 문구는 diagnosticOnly 로 강등 (Invariant 1).
    lines.push('🌐 <b>SectorEnergy Summary:</b>');
    lines.push('  • sourceOfTruth=SectorEnergyCanonicalResolver');
    lines.push('  • status=VERIFIED');
    lines.push('  • universeType=OFFICIAL_SECTOR_ONLY');
    lines.push(`  • officialSectorCount=${sectorCanonical.officialSectorCount}`);
    lines.push(`  • verifiedOfficialSectorCount=${sectorCanonical.verifiedOfficialSectorCount}`);
    lines.push(`  • promotionCoverage=${(sectorCanonical.promotionCoverage * 100).toFixed(1)}%`);
    lines.push(`  • promotionAllowed=${sectorCanonical.promotionAllowed}`);
    lines.push(`  • sectorBoostAllowed=${sectorCanonical.sectorBoostAllowed}`);
    lines.push(`  • strongBuyAllowed=${sectorCanonical.strongBuyAllowed}`);
    lines.push('  • executionImpact=NONE');
    lines.push(`  • <i>legacyDataQualityDiagnosticOnly=${input.sectorEnergyQuality} collapsed=true</i>`);
    if (input.sectorEnergyReasons && input.sectorEnergyReasons.length > 0) {
      lines.push(`  • <i>diagnosticLegacyReason=${input.sectorEnergyReasons.slice(0, 2).join('; ')} diagnosticOnly=true</i>`);
    }
  } else if (
    sectorCanonical
    && (sectorCanonical.dataQuality === 'SESSION_NOT_VERIFIABLE'
      || sectorCanonical.sectorIndexVerifyMode === 'VERIFY_SKIPPED_SESSION_CLOSED')
  ) {
    // ADR-0544 follow-up: 휴일/세션닫힘 verify-skip 은 소스 결함(DEGRADED)이 아니므로 실패성 아이콘(❌/🔶)
    // 대신 중립 SESSION_NOT_VERIFIABLE 표시. 게이팅(promotionCoveragePass=false)은 읽기만 — 무변경.
    lines.push('🌐 <b>SectorEnergy Summary:</b>');
    lines.push('  • status=VERIFY_SKIPPED_SESSION_CLOSED');
    lines.push('  • sourceOfTruth=SectorEnergyCanonicalResolver');
    lines.push(`  • officialSectorCount=${sectorCanonical.officialSectorCount}`);
    lines.push('  • verifiedOfficialSectorCount=N/A_SESSION_CLOSED');
    lines.push('  • promotionCoverage=N/A_SESSION_CLOSED');
    lines.push('  • promotion=DISABLED_FOR_SESSION');
    lines.push(`  • shadowLeadershipAllowed=${sectorCanonical.shadowLeadershipAllowed}`);
    lines.push(`  • counterfactualAllowed=${sectorCanonical.counterfactualAllowed}`);
    lines.push('  • providerIssue=false');
    lines.push('  • marketSignal=false');
    lines.push('  • operatorAction=OBSERVE_NEXT_TRADING_SESSION');
    lines.push('  • executionImpact=NONE');
    lines.push('  • <i>비거래일이라 공식 섹터지수 실시간 검증을 생략했습니다. provider failure 아님 — 다음 거래일 verify 예정.</i>');
  } else {
    lines.push('🌐 <b>섹터 에너지 데이터 품질:</b>');
    // ADR-0396 (= 사용자 명시 ADR-0371): 5단계 union — DEGRADED 신규 마커 추가.
    const qualityIcon =
      input.sectorEnergyQuality === 'OK' ? '✅'
      : input.sectorEnergyQuality === 'PARTIAL' ? '🟡'
      : input.sectorEnergyQuality === 'STALE' ? '🟠'
      : input.sectorEnergyQuality === 'DEGRADED' ? '🔶'
      : '❌';
    lines.push(`  • dataQuality: ${qualityIcon} <b>${input.sectorEnergyQuality}</b>`);
    if (input.validSectorCount !== undefined) {
      lines.push(`  • validSectorCount: ${input.validSectorCount}/12`);
    }
    if (input.sectorEnergyReasons && input.sectorEnergyReasons.length > 0) {
      lines.push(`  • reasons: ${input.sectorEnergyReasons.slice(0, 3).join('; ')}`);
    }
    // ADR-0396: FAILED 외 DEGRADED 도 DATA_INVALID 후보 (emptyScanClassifier wiring 정합).
    if (input.sectorEnergyQuality === 'FAILED' || input.sectorEnergyQuality === 'DEGRADED') {
      lines.push(`  • <i>${input.sectorEnergyQuality} → emptyScanReason DATA_INVALID 자동 가중 (ADR-0127/0396)</i>`);
    }
  }
  return lines;
}

export interface FilterStatusSectionInput {
  summary: ScanSummary;
  shadowDiagnosticEntriesForSummary: number;
  liveOrderAllowed: boolean;
  sizingHardBlockCount: number;
  sizingAdvisoryCount: number;
}

export function buildFilterStatusSection(input: FilterStatusSectionInput): string[] {
  const { summary, shadowDiagnosticEntriesForSummary, liveOrderAllowed } = input;
  const wd = summary.waitDistribution;
  const lines: string[] = [];
  lines.push('');
  lines.push(`📋 <b>종목별 필터 상태</b> (후보 ${summary.candidates}개):`);
  if (shadowDiagnosticEntriesForSummary > 0) {
    lines.push(`  • 🧪 Shadow diagnostic entry: <b>${shadowDiagnosticEntriesForSummary}개</b>`);
    lines.push('  • 실거래 주문: <b>0개</b> (실거래 없음)');
  } else {
    lines.push(`  • 진입 신호: <b>${summary.entries}개</b>`);
    if (!liveOrderAllowed) lines.push('  • 실거래 주문: <b>0개</b> (실거래 없음)');
  }
  if (wd) {
    if (wd.dataHold > 0) lines.push(`  • DATA_HOLD: ${wd.dataHold}개 ⚠️`);
    if (wd.gateFail > 0) lines.push(`  • Gate 재검증 미완료: ${wd.gateFail}개`);
    if (wd.preBreakout > 0) lines.push(`  • Pre-breakout WAIT: ${wd.preBreakout}개`);
    if (input.sizingHardBlockCount > 0) {
      lines.push(`  • Sizing BLOCKED: ${input.sizingHardBlockCount}개 ⚠️`);
    } else if (wd.sizingBlocked > 0 || input.sizingAdvisoryCount > 0) {
      lines.push(`  • SIZING_ADVISORY_LOW: ${input.sizingAdvisoryCount || wd.sizingBlocked}개 (hardBlock=0, canonicalRuntimeResolution.sizing)`);
    }
    if (wd.volumeDrop > 0) lines.push(`  • 거래량 급감: ${wd.volumeDrop}개`);
    if (wd.driftRemove > 0) lines.push(`  • Drift REMOVE: ${wd.driftRemove}개`);
    if (wd.corpAction > 0) lines.push(`  • Corporate Action: ${wd.corpAction}개`);
    if (wd.other > 0) lines.push(`  • 기타: ${wd.other}개`);
  } else {
    lines.push(`  • Gate 미달: ${summary.gateMisses}개 (waitDistribution 미수집)`);
    lines.push(summary.yahooFails > 0
      ? `  • 데이터 이슈: ${summary.yahooFails}개 (diagnosticOnly=true, causalArrow=false)`
      : '  • 데이터 실패: 없음');
    lines.push(`  • RRR 미달: ${summary.rrrMisses}개`);
  }
  if (summary.noEntryStreakDiagnostic) {
    const d = summary.noEntryStreakDiagnostic;
    lines.push(
      `  • noEntryStreakCount=${d.noEntryStreakCount} pipelineHealthStatus=${d.pipelineHealthStatus} dominantNoEntryReason=${d.dominantNoEntryReason}`,
    );
    lines.push(
      `  • actionRequired=${d.actionRequired} executionImpact=${d.executionImpact} forceScanBlocked=${d.forceScanBlocked} thresholdChanged=${d.thresholdChanged}`,
    );
    lines.push(
      `  • shadowLearningStatus=${d.shadowLearningStatus} counterfactualStatus=${d.counterfactualStatus} entryBlockedByNoEntryStreak=${d.entryBlockedByNoEntryStreak}`,
    );
  }
  return lines;
}

export function buildSupplyInjectionSection(summary: ScanSummary): string[] {
  const lines: string[] = [];
  if (summary.perSymbolSupplyInjection) {
    const s = summary.perSymbolSupplyInjection;
    lines.push('');
    lines.push('📊 <b>Per-Symbol Supply Injection</b>');
    lines.push(`  candidates: ${s.totalCandidates}`);
    lines.push(`  requested: ${s.requestedSymbols}`);
    lines.push(`  injected: ${s.injected}`);
    lines.push(`  verified: ${s.verified}`);
    lines.push(`  degraded: ${s.degraded}`);
    lines.push(`  stale: ${s.stale}`);
    lines.push(`  missing: ${s.missing}`);
    lines.push(`  unknown: ${s.unknown}`);
    lines.push(`  routerConnected: ${s.routerConnected}`);
    lines.push(`  gateContextConnected: ${s.gateContextConnected}`);
  }
  return lines;
}

export function buildR3ViolationStateSection(
  r3: NonNullable<ScanSummary['r3ViolationState']>,
): string[] {
  const lines: string[] = [];
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
  return lines;
}

export interface EmptyScanReasonSectionInput {
  summary: ScanSummary;
  shadowDiagnosticEntriesForSummary: number;
  liveOrderAllowed: boolean;
}

export function buildEmptyScanReasonSection(input: EmptyScanReasonSectionInput): string[] {
  const { summary, shadowDiagnosticEntriesForSummary, liveOrderAllowed } = input;
  const lines: string[] = [];
  lines.push('');
  if (summary.emptyScanReason) {
    const desc = describeEmptyScanReason(summary.emptyScanReason);
    const forensic = summary.gate1MinimumSignalForensicAdr0505;
    const supplyAvailable = forensic?.supplySemanticAvailable ?? 0;
    const supplyTotal = forensic?.totalCandidates ?? summary.candidates ?? 0;
    const supplyAvailabilityRate = supplyTotal > 0 ? supplyAvailable / supplyTotal : 0;
    if (summary.emptyScanReason === 'NO_LEADERSHIP' && supplyTotal > 0 && supplyAvailabilityRate < 0.3) {
      lines.push('💡 <b>빈스캔 원인 (ADR-0119):</b> DEGRADED_SCAN');
      lines.push(`  • 표면상 NO_LEADERSHIP이나, 수급 semantic row ${supplyAvailable}/${supplyTotal}으로 리더십 판정 신뢰도 낮음`);
      lines.push('  • leadership diagnosis confidence: LOW');
      lines.push('  • 우선 조치: Supply Semantic Row Carry 복구 필요');
    } else {
      lines.push(`💡 <b>빈스캔 원인 (ADR-0119):</b> ${summary.emptyScanReason}`);
      lines.push(`  • ${desc.label}`);
      lines.push(`  • ${desc.advice}`);
      if (supplyTotal > 0) lines.push(`  • supplySemantic availability: ${supplyAvailable}/${supplyTotal}`);
    }
  } else if (summary.entries > 0) {
    if (shadowDiagnosticEntriesForSummary > 0 || !liveOrderAllowed) {
      lines.push(`🧪 <b>Shadow diagnostic entry:</b> ${shadowDiagnosticEntriesForSummary || summary.entries}개`);
      lines.push('  • 실거래 주문 0개 — 실거래 없음');
    } else {
      lines.push(`✅ <b>진입 신호:</b> ${summary.entries}개 (분류 대상 아님)`);
    }
  } else {
    lines.push('💡 <b>빈스캔 원인:</b> 분류 데이터 부족 (waitDistribution 미수집)');
  }
  return lines;
}

export function buildShadowLearningSection(
  r6: NonNullable<ScanSummary['r6ShadowEntryPolicy']>,
): string[] {
  const lines: string[] = [];
  lines.push('');
  lines.push('Shadow Learning:');
  lines.push(`  candidateEvaluated=${r6.candidateEvaluated}`);
  lines.push(`  accumulatingCandidates=${r6.accumulatingCandidates}`);
  lines.push(`  shadowBuySignals=${r6.shadowBuySignals}`);
  lines.push(`  r6CounterfactualEntries=${r6.r6CounterfactualEntries}`);
  lines.push(`  noShadowEntryReason=${r6.noShadowEntryReason ?? 'N/A'}`);
  lines.push('  legacy defense policy disabled; buy permission uses Gate/data quality only');
  lines.push('  executionImpact=NONE');
  return lines;
}
