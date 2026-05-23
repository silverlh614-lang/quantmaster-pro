/**
 * @responsibility Telegram scan blockers message formatter.
 * ADR-0001 scan diagnostics core split.
 */

import { describeEmptyScanReason } from '../emptyScanClassifier.js';
import { formatPreflightBlockedScanSection, getLastPreflightBlockedScanSummary } from '../preflightBlockedScanSummary.js';
import { formatR3NoiseGovernorCompactLine } from '../r3NoiseGovernor.js';
import { formatPreBreakoutWaitSummarySection } from '../preBreakoutWaitPolicy.js';
import { formatShadowNearBreakoutSection, type ShadowNearBreakoutBlockReason } from '../shadowNearBreakoutEntryPolicy.js';
import { formatFreshAttributionSection } from '../freshScanBlockerAttribution.js';
import { formatGate2AttributionSection } from '../gate2LeadershipAttribution.js';
import { formatSectorEnergyQualityDiagnosticSection } from '../../../clients/sectorEnergyQualityDiagnostic.js';
import { formatGate1MinimumSignalForensicSection } from '../gate1MinimumSignalForensicAuditAdr0505.js';
import { formatGateDecisionRouterSection } from '../gateDecisionRouter.js';
import { formatProvisionalShadowSection } from '../provisionalShadowLane.js';
import { formatCounterfactualShadowLearningSection } from '../counterfactualShadowLearningLane.js';
import { formatGateEligibilitySplitSection } from '../gateEligibilitySection.js';
import { formatGateReclassificationDryRunSection } from '../../../learning/gateReclassificationDryRun.js';
import { formatEntryFilterDecompositionSection } from '../entryFilterDecomposition.js';
import { formatPositiveScoreStarvationReport } from '../gate1PositiveScoreStarvation.js';
import { formatGate1ScoreCeilingRepairReport } from '../gate1ScoreCeilingRepair.js';
import { formatPenaltyDeduplicationReport } from '../gate1PenaltyDeduplication.js';
import { formatRiskDoubleCountAuditReport } from '../gate1RiskDoubleCount.js';
import { formatFinalGate1CalibrationReport } from '../gate1FinalCalibration.js';
import { formatGate1ScoringAlignmentReport } from '../gate1ScoringAlignmentAdr0472.js';
import { formatGate1PositiveSourceWiringReport } from '../gate1PositiveSourceWiringAdr0475.js';
import { formatGate1DryRunObservationSummary } from '../gate1DryRunObservationLedgerAdr0476.js';
import { formatInvestorFlowProviderRouterAdr0477 } from '../investorFlowProviderRouterAdr0477.js';
import { type ScanSummary } from './scanSummaryTypes.js';
import { formatGateScoreCandidateBucketSection, formatGateScoreHealthSection } from './gateScoreDiagnostics.js';
import { formatGate1SurvivalAuditSection, formatGate2CoverageAuditSection } from './gateLayerDiagnostics.js';
import { formatScanEvaluationSection } from '../state/scanEvaluationState.js';
import { emitScanDiagnosticBuildFailedWarn } from '../state/scanDiagnosticSuppressor.js';
import { formatFrozenQuoteSection, formatPriceCorrectionOverlaySection, formatPriceIntegritySection, formatR3StreakSkipLine } from './sectionFormatters.js';
import { getRegimePositionPolicy } from '../../sizing/regimePositionPolicy.js';
import { formatCandidatePoolSection } from '../../candidatePoolBuilder.js';
import {
  buildCanonicalRuntimeResolutionStep27,
  type CanonicalRuntimeResolutionStep27,
  rebindGate1ForensicSummaryToCanonicalStep27,
  rebindGate1ScoreCeilingRepairReportToCanonicalStep27,
  rebindGate1ScoringAlignmentReportToCanonicalStep27,
  rebindPositiveScoreStarvationReportToCanonicalStep27,
  formatGatePositiveRuntimeAlignmentSection,
} from '../runtimeResolverTraceStep26.js';

export function formatScanBlockersMessage(summary: ScanSummary | null): string {
  // ADR-0367: 직전 스캔이 buyListLoop 진입 전 preflight 차단됐으면 preflight blocked scan 을 우선 표시.
  // persistScanResults 가 _lastScanSummary 를 채울 때 clearPreflightBlockedScanSummary 로 stale 제거되므로
  // _lastPreflightBlockedScanSummary 가 non-null 이면 항상 "직전 스캔 = preflight 차단" 을 의미한다.
  const preflightBlocked = getLastPreflightBlockedScanSummary();
  if (preflightBlocked) {
    return formatPreflightBlockedScanSection(preflightBlocked);
  }
  if (!summary) {
    return '📊 <b>[매수 차단 사유]</b>\n━━━━━━━━━━━━━━━━\n진단 데이터 없음 (스캔 미실행).';
  }

  const canonicalRuntimeResolution =
    summary.canonicalRuntimeResolution ?? buildCanonicalRuntimeResolutionStep27(summary);
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
    const rawRegime = mg.macroRegimeRaw ?? mg.regime;
    const displayRegime = mg.displayRegime ?? mg.regime;
    const legacyEffectiveRegime = mg.macroRegimeEffective ?? mg.regime;
    const staleLegacyR6Path =
      legacyEffectiveRegime === 'R6_DEFENSE' &&
      displayRegime !== 'R6_DEFENSE' &&
      mg.regime !== 'R6_DEFENSE';
    const canonicalEffectiveRegime = staleLegacyR6Path ? displayRegime : legacyEffectiveRegime;
    const positionPolicy = getRegimePositionPolicy(canonicalEffectiveRegime);
    lines.push(`  • 레짐: ${canonicalEffectiveRegime} (총노출 ${positionPolicy.maxGrossExposurePct}%, 종목당 ${positionPolicy.perPositionPct}%)`);
    if (mg.macroRegimeRaw || mg.macroRegimeEffective || mg.displayRegime) {
      lines.push(`  • raw/effective: ${rawRegime} → ${canonicalEffectiveRegime}`);
      lines.push(`  • regimeSource: canonical=RegimeResolver.canonicalOutput display=${displayRegime} riskOverride=${mg.riskOverride ?? 'NONE'} executionPermissionImpact=NONE`);
    }
    if (staleLegacyR6Path) {
      lines.push(`  • legacyR6Path: deprecated=true notUsedForDecision=true legacyEffective=${legacyEffectiveRegime} legacyR6RecoveryStatus=${mg.r6RecoveryStatus ?? 'NONE'}`);
    } else {
      if (mg.r6RecoveryStatus) lines.push(`  • r6RecoveryStatus: ${mg.r6RecoveryStatus}`);
      if (mg.activeR6Triggers) lines.push(`  • activeR6Triggers: [${mg.activeR6Triggers.join(',') || 'none'}]`);
      if (mg.r6ShockLatch !== undefined) lines.push(`  • r6ShockLatch: ${mg.r6ShockLatch}`);
      if (mg.recoveryBlockedReason) lines.push(`  • recoveryBlockedReason: ${mg.recoveryBlockedReason}`);
    }
    if (mg.liveEntryAllowed !== undefined) lines.push(`  • liveEntryAllowed: ${mg.liveEntryAllowed}`);
    if (mg.liveExitAllowed !== undefined) lines.push(`  • liveExitAllowed: ${mg.liveExitAllowed}`);
    if (mg.shadowBuyAllowed !== undefined) lines.push(`  • shadowBuyAllowed: ${mg.shadowBuyAllowed}`);
    if (mg.shadowSellAllowed !== undefined) lines.push(`  • shadowSellAllowed: ${mg.shadowSellAllowed}`);
    if (mg.shadowLearningAllowed !== undefined) lines.push(`  • shadowLearningAllowed: ${mg.shadowLearningAllowed}`);
    if (mg.counterfactualAllowed !== undefined) lines.push(`  • counterfactualAllowed: ${mg.counterfactualAllowed}`);
    if (mg.brokerOrderAllowed !== undefined) lines.push(`  • brokerOrderAllowed: ${mg.brokerOrderAllowed}`);
    lines.push(`  • FOMC: ${mg.fomcPhase} (점수/신뢰도 보정만 적용, executionImpact=NONE)`);
    if (mg.vixGatingActive) lines.push(`  • VIX 게이팅: <b>ON ⚠️</b>`);
    if (mg.bearDefenseMode) lines.push(`  • bearDefenseMode: <b>ON ⚠️</b>`);
    if (mg.mhsBelow30) lines.push(`  • MHS<30: <b>ON ⚠️</b>`);
    if (mg.diagnosticLiveEntryBlocked) {
      const liveEntryBlockedReason = String(mg.liveEntryBlockedReason ?? 'DIAGNOSTIC_ONLY').toUpperCase();
      const removedPolicyReason = liveEntryBlockedReason.includes('SELL_ONLY') || liveEntryBlockedReason.includes('R6_DEFENSE');
      lines.push(`  • liveEntryBlocked: <b>${removedPolicyReason ? 'LEGACY_POLICY_INPUT_IGNORED' : mg.liveEntryBlockedReason ?? 'DIAGNOSTIC_ONLY'}</b> (diagnostics continue)`);
    }
    if (mg.sellOnlyMode) {
      lines.push('  Legacy defense policy input detected - executionImpact=NONE');
      lines.push('  removedPolicy: LEGACY_DEFENSE_POLICY_REMOVED');
      lines.push('  Current buy permission uses Gate/data quality only.');
      lines.push('  shadow note: Shadow/Counterfactual snapshot preserved; executionImpact=NONE.');
    }
    if (mg.watchlistEmpty) lines.push(`  • 워치리스트: <b>0개 ⚠️</b>`);
  }

  const scanEvaluationSection = formatScanEvaluationSection(summary.scanEvaluation);
  if (scanEvaluationSection) {
    lines.push('');
    lines.push(scanEvaluationSection);
  }

  const candidatePoolSection = formatCandidatePoolSection(summary.candidatePool);
  if (candidatePoolSection) {
    lines.push('');
    lines.push(candidatePoolSection);
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
    if (canonicalRuntimeResolution.sizing.hardBlockCount > 0) {
      lines.push(`  • Sizing BLOCKED: ${canonicalRuntimeResolution.sizing.hardBlockCount}개 ⚠️`);
    } else if (wd.sizingBlocked > 0 || canonicalRuntimeResolution.sizing.advisoryCount > 0) {
      lines.push(`  • SIZING_ADVISORY_LOW: ${canonicalRuntimeResolution.sizing.advisoryCount || wd.sizingBlocked}개 (hardBlock=0, canonicalRuntimeResolution.sizing)`);
    }
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

  // ADR-0505 — Gate1 Minimum Signal Forensic Audit compact section.
  // 사용자 명시 ADR-0502 의미상 후속 (INDEX SSOT 정합 0505 재할당).
  // 100-scale minimum signal score 부결 원인을 component 단위로 분해 — positive
  // starvation vs penalty accumulation 구분. ADR-0420 fresh attribution 과 *책임 분리*
  // (ADR-0420 = 조건별 status 분해 / ADR-0505 = 100점형 점수 component 분해).
  // summary 부재 또는 totalCandidates=0 시 미노출 (formatter 내부 필터, 잡음 차단).
  const gate1ForensicSection = formatGate1MinimumSignalForensicSection(
    rebindGate1ForensicSummaryToCanonicalStep27(
      summary.gate1MinimumSignalForensicAdr0505,
      canonicalRuntimeResolution,
    ),
  );
  if (gate1ForensicSection) {
    lines.push('');
    lines.push(gate1ForensicSection);
    lines.push('');
    lines.push(formatCanonicalRuntimeResolutionAdoptionSection(canonicalRuntimeResolution));
    const gatePositiveRuntimeAlignmentSection = formatGatePositiveRuntimeAlignmentSection(summary, canonicalRuntimeResolution);
    if (gatePositiveRuntimeAlignmentSection) {
      lines.push('');
      lines.push(gatePositiveRuntimeAlignmentSection);
    }
  }

  // ADR-452c — Gate Score Health visibility (diagnostic-only).
  // Gate attribution 근처에 raw/available/normalized score health 를 노출한다.
  // normalizedGateScore 는 표시만 하며 live decision 에 사용하지 않는다.
  const gateScoreHealthSection = formatGateScoreHealthSection(summary.gateScoreHealth);
  if (gateScoreHealthSection) {
    lines.push('');
    lines.push(gateScoreHealthSection);
  }

  // ADR-452d — Gate near-miss buckets (diagnostic-only, executionImpact NONE).
  // DATA_BLOCKED_NEAR_MISS / PROBING / SHADOW_ONLY 는 실매수 승격 없이 운영 진단에만 노출한다.
  const gateScoreBucketSection = formatGateScoreCandidateBucketSection(summary.gateScoreCandidateBuckets);
  if (gateScoreBucketSection) {
    lines.push('');
    lines.push(gateScoreBucketSection);
  }

  // ADR-458 — Approved Gate Reclassification Dry-Run (shadow-only, executionImpact NONE).
  const gate1SurvivalSection = formatGate1SurvivalAuditSection(summary.gateLayerAudit?.gate1Survival);
  if (gate1SurvivalSection) {
    lines.push('');
    lines.push(gate1SurvivalSection);
  }
  const gate2CoverageSection = formatGate2CoverageAuditSection(summary.gateLayerAudit?.gate2Coverage);
  if (gate2CoverageSection) {
    lines.push('');
    lines.push(gate2CoverageSection);
  }

  const gateReclassificationDryRunSection = formatGateReclassificationDryRunSection(summary.gateReclassificationDryRun);
  if (gateReclassificationDryRunSection) {
    lines.push('');
    lines.push(gateReclassificationDryRunSection);
  }

  const positiveStarvationSection = formatPositiveScoreStarvationReport(
    rebindPositiveScoreStarvationReportToCanonicalStep27(
      summary.positiveScoreStarvation,
      canonicalRuntimeResolution,
    ),
    canonicalRuntimeResolution,
  );
  if (positiveStarvationSection) {
    lines.push('');
    lines.push(positiveStarvationSection);
  }

  const scoreCeilingRepairSection = formatGate1ScoreCeilingRepairReport(
    rebindGate1ScoreCeilingRepairReportToCanonicalStep27(
      summary.scoreCeilingRepair,
      canonicalRuntimeResolution,
    ),
  );
  if (scoreCeilingRepairSection) {
    lines.push('');
    lines.push(scoreCeilingRepairSection);
  }

  const penaltyDeduplicationSection = formatPenaltyDeduplicationReport(
    summary.penaltyDeduplication,
    canonicalRuntimeResolution,
  );
  if (penaltyDeduplicationSection) {
    lines.push('');
    lines.push(penaltyDeduplicationSection);
  }

  const riskDoubleCountSection = formatRiskDoubleCountAuditReport(summary.riskDoubleCount);
  if (riskDoubleCountSection) {
    lines.push('');
    lines.push(riskDoubleCountSection);
  }

  const finalGate1CalibrationSection = formatFinalGate1CalibrationReport(
    summary.finalGate1Calibration,
    canonicalRuntimeResolution,
  );
  if (finalGate1CalibrationSection) {
    lines.push('');
    lines.push(finalGate1CalibrationSection);
  }

  try {
    const gate1ScoringAlignmentSection = formatGate1ScoringAlignmentReport(
      rebindGate1ScoringAlignmentReportToCanonicalStep27(
        summary.gate1ScoringAlignment,
        canonicalRuntimeResolution,
      ),
    );
    if (gate1ScoringAlignmentSection) {
      lines.push('');
      lines.push(gate1ScoringAlignmentSection);
    }
  } catch (e) {
    emitScanDiagnosticBuildFailedWarn({ sourcePath: 'scanDiagnosticsCore.formatGate1ScoringAlignmentReport', error: e });
  }

  try {
    const positiveSourceWiringSection = formatGate1PositiveSourceWiringReport(summary.gate1PositiveSourceWiring);
    if (positiveSourceWiringSection) {
      lines.push('');
      lines.push(positiveSourceWiringSection);
    }
  } catch (e) {
    emitScanDiagnosticBuildFailedWarn({ sourcePath: 'scanDiagnosticsCore.formatGate1PositiveSourceWiringReport', error: e });
  }

  // ADR-0423 — SectorEnergy 데이터 진실성 진단 (indexCode coverage / symmetry / fallback 분해).
  // 기존 sectorEnergyQuality 라벨만으로는 SECTOR_DATA_STALE_DOMINANT 의 *진짜 원인* 인식 불가.
  // 본 섹션은 reasons 분해 + leadershipConfidence 차단 결정 + operatorAction 안내.
  // ADR-0422 Gate2 섹션의 sectorEnergy 표시(요약) 와 *책임 분리* — 본 섹션은 *원인 분해 상세*.
  try {
    const investorFlowRouterSection = formatInvestorFlowProviderRouterAdr0477(
      summary.investorFlowProviderRouter,
      canonicalRuntimeResolution,
    );
    if (investorFlowRouterSection) {
      lines.push('');
      lines.push(investorFlowRouterSection);
    }
  } catch (e) {
    emitScanDiagnosticBuildFailedWarn({ sourcePath: 'scanDiagnosticsCore.formatInvestorFlowProviderRouterAdr0477', error: e });
  }

  try {
    const dryRunObservationSection = formatGate1DryRunObservationSummary(summary.gate1DryRunObservationLedger);
    if (dryRunObservationSection) {
      lines.push('');
      lines.push(dryRunObservationSection);
    }
  } catch (e) {
    emitScanDiagnosticBuildFailedWarn({ sourcePath: 'scanDiagnosticsCore.formatGate1DryRunObservationSummary', error: e });
  }

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
  if (summary.r6ShadowEntryPolicy) {
    const r6 = summary.r6ShadowEntryPolicy;
    lines.push('');
    lines.push('Shadow Learning:');
    lines.push(`  candidateEvaluated=${r6.candidateEvaluated}`);
    lines.push(`  accumulatingCandidates=${r6.accumulatingCandidates}`);
    lines.push(`  shadowBuySignals=${r6.shadowBuySignals}`);
    lines.push(`  r6CounterfactualEntries=${r6.r6CounterfactualEntries}`);
    lines.push(`  noShadowEntryReason=${r6.noShadowEntryReason ?? 'N/A'}`);
    lines.push('  legacy defense policy disabled; buy permission uses Gate/data quality only');
    lines.push('  executionImpact=NONE');
  }

  const counterfactualSection = formatCounterfactualShadowLearningSection(
    summary.counterfactualShadowLearning,
  );
  if (counterfactualSection) {
    lines.push('');
    lines.push(counterfactualSection);
  }

  // ADR-0464 — Entry Filter Conservatism Decomposition.
  const entryFilterSection = formatEntryFilterDecompositionSection(summary.entryFilterDecomposition);
  if (entryFilterSection) {
    lines.push('');
    lines.push(entryFilterSection);
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

  // ADR-0452 — Shadow Near-Breakout Entry compact section.
  //   Live WAIT 후보 중 near-breakout 학습 가치가 큰 후보를 Shadow 가상 진입으로 기록한 결과.
  //   created/blocked + topBlock + executionImpact: NONE 라인.
  //   부재 또는 created+blocked=0 시 미노출 (잡음 차단 — 후방호환).
  if (
    (summary.shadowNearBreakoutCreated ?? 0) > 0 ||
    (summary.shadowNearBreakoutBlocked ?? 0) > 0
  ) {
    const section = formatShadowNearBreakoutSection({
      created: summary.shadowNearBreakoutCreated ?? 0,
      blocked: summary.shadowNearBreakoutBlocked ?? 0,
      blockReasons:
        (summary.shadowNearBreakoutBlockReasons as Partial<
          Record<ShadowNearBreakoutBlockReason, number>
        >) ?? {},
    });
    if (section) {
      lines.push('');
      lines.push(section);
    }
  }

  return lines.join('\n');
}

function formatCanonicalRuntimeResolutionAdoptionSection(
  canonical: CanonicalRuntimeResolutionStep27,
): string {
  return [
    '[Canonical Runtime Resolution Adopted]',
    `scanId=${canonical.scanId}`,
    `sourceSnapshotId=${canonical.sourceSnapshotId}`,
    `gateScoreInputSnapshotId=${canonical.gateScoreInputSnapshotId}`,
    'KIS Investor Flow Semantic Row:',
    `- selectedProvider: ${canonical.kisInvestorFlow.selectedProvider}`,
    `- rawRow: ${canonical.kisInvestorFlow.rawRows}/${canonical.kisInvestorFlow.totalRows}`,
    `- semanticRow: ${canonical.kisInvestorFlow.semanticRows}/${canonical.kisInvestorFlow.totalRows}`,
    `- gateEligibleRows: ${canonical.kisInvestorFlow.gateEligibleRows}/${canonical.kisInvestorFlow.totalRows}`,
    `- shadowOnlyRows: ${canonical.kisInvestorFlow.shadowOnlyRows}/${canonical.kisInvestorFlow.totalRows}`,
    `- scoreUsage: ${canonical.kisInvestorFlow.finalGateScoreEligible ? 'GATE_SCORE_ELIGIBLE_PARTIAL' : 'SHADOW_ONLY_NEUTRAL_UNKNOWN'}`,
    `- finalRouterUsable: ${canonical.kisInvestorFlow.finalRouterUsable}`,
    `- finalGateScoreEligible: ${canonical.kisInvestorFlow.finalGateScoreEligible}`,
    `- failedCriteria: ${canonical.kisInvestorFlow.failedCriteria.length > 0 ? canonical.kisInvestorFlow.failedCriteria.join(',') : '[]'}`,
    `- marketSignal=${canonical.kisInvestorFlow.marketSignal}`,
    '- executionImpact=NONE',
    'actualInvestorRowUseScope:',
    `  GATE_SCORE_ELIGIBLE=${canonical.kisInvestorFlow.gateEligibleRows}`,
    `  SHADOW_ONLY_NEUTRAL_UNKNOWN=${canonical.kisInvestorFlow.shadowOnlyRows}`,
    'ADR-0467 Watchlist Resolver:',
    `- WATCHLIST_UPSTREAM_SCORE verified ${canonical.watchlist.verified} / missing ${canonical.watchlist.missing} / avg +${canonical.watchlist.avg.toFixed(1)}`,
    `- selectedInputPath=${canonical.watchlist.selectedInputPath}`,
    `- conflict=${canonical.watchlist.conflict}`,
    'Momentum Projection:',
    `- return5dCount=${canonical.momentum.return5dCount}`,
    `- return20dCount=${canonical.momentum.return20dCount}`,
    `- relativeReturn20dCount=${canonical.momentum.relativeReturn20dCount}`,
    `- marketRelativeReturnCount=${canonical.momentum.marketRelativeReturnCount}`,
    `- PRICE_MOMENTUM computedCount=${canonical.momentum.priceMomentumComputedCount}`,
    `- projectedToGate1=${canonical.momentum.projectedToGate1}`,
    'Breakout Runtime Mapping:',
    `- traceAvailable=${canonical.breakout.traceAvailable}`,
    `- scoreComputed=${canonical.breakout.scoreComputed}`,
    `- scoreMappedToGate=${canonical.breakout.scoreMapped}`,
    `- zeroByCondition=${canonical.breakout.zeroByCondition}`,
    `- missingByMapping=${canonical.breakout.missingByMapping}`,
    `- waitFeatureMissing=${canonical.breakout.waitFeatureMissing}`,
    `- waitEntryPriceNotReached=${canonical.breakout.waitEntryPriceNotReached}`,
    'Provider Penalty Policy:',
    `- providerIssuePenaltyApplied=${canonical.providerPenalty.providerIssuePenaltyApplied}`,
    `- unknownPenaltyApplied=${canonical.providerPenalty.unknownPenaltyApplied}`,
    `- penaltyScope=${canonical.providerPenalty.penaltyScope}`,
    `- effectiveProviderPenaltyAvg=${canonical.providerPenalty.effectiveProviderPenaltyAvg.toFixed(1)}`,
    `- effectiveUnknownPenaltyAvg=${canonical.providerPenalty.effectiveUnknownPenaltyAvg.toFixed(1)}`,
    '- gateScoreImpact=0',
    'Sizing:',
    `- hardBlockCount=${canonical.sizing.hardBlockCount}`,
    `- advisoryCount=${canonical.sizing.advisoryCount}`,
    '- executionImpact=NONE',
  ].join('\n');
}
