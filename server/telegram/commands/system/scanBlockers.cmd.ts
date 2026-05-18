// @responsibility scanBlockers.cmd 텔레그램 모듈
/**
 * @responsibility /scan_blockers 명령 — 직전 스캔의 *매수 차단 사유 분포* 즉시 진단.
 *
 * ADR-0118: 사용자 보고 "FOMC 다음날인데 매수 0건" 직접 대응. 직전 스캔의
 * waitDistribution + macroGateState 를 텔레그램 메시지로 포맷.
 *
 * ADR-0118 §"진단 추정" 확장: TECHNICAL_PROVIDER_DEGRADED 종목 (ADR-0411
 * Yahoo↔KIS 괴리 KIS recovery 마커) 을 운영자에게 즉시 노출. WATCHLIST_HOLD
 * 정책 작동 중인 종목을 1 명령으로 인지 가능. ENV
 * `SCAN_BLOCKERS_PROVIDER_DEGRADED_DISABLED=true` 시 섹션 미노출.
 */
import { randomUUID } from 'node:crypto';
import { emitReportSectionWarn } from '../../../observability/reportSectionWarn.js';


function emitScanBlockersSectionWarn(message: string, error?: unknown): void {
  emitReportSectionWarn({
    section: 'SCAN_BLOCKERS',
    code: 'P2_SCAN_BLOCKERS_SECTION_DEGRADED',
    message: String(message).replace(/^\[scan_blockers\]\s*/, '').slice(0, 180),
    error,
    dedupKey: `p2:telegram:section:SCAN_BLOCKERS:${String(message).slice(0, 96)}`,
  });
}

import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import {
  formatScanBlockersMessage,
  formatTechnicalProviderDegradedSection,
  getLastScanSummary,
} from '../../../trading/signalScanner/scanDiagnostics.js';
import {
  formatNormalSupplyPreviewSection,
  getLastNormalSupplyPreview,
} from '../../../trading/signalScanner/normalSupplyPreview.js';
import { loadWatchlist } from '../../../persistence/watchlistRepo.js';
// ADR-0431 — counterfactual ledger 누적 성과 한 줄 요약 (전체 리포트는 /shadow_counterfactual).
// read-only — counterfactual ledger 만 read, LIVE 매매 무영향.
import { loadCounterfactualShadowLearningLedger } from '../../../persistence/counterfactualShadowLearningRepo.js';
import {
  buildCounterfactualShadowPerformanceReport,
  formatCounterfactualShadowSummaryLine,
} from '../../../learning/counterfactualShadowLearningPerformanceReport.js';
import { createCounterfactualShadowPriceProvider } from '../../../learning/counterfactualShadowPriceProviderAdapter.js';
// ADR-0432 — provisional + counterfactual learning samples promotion 한 줄 요약.
// read-only recommendation — LIVE/PAPER/normal shadow 체결 영향 0.
// priceProvider 미전달 → 모든 horizon PENDING → INSUFFICIENT_DATA / PENDING fallback.
import { loadProvisionalShadowLedger } from '../../../persistence/provisionalShadowLedger.js';
import {
  buildProvisionalShadowPerformanceReport,
} from '../../../learning/provisionalShadowPerformanceReport.js';
import {
  buildShadowLearningPromotionRecommendations,
  formatShadowLearningPromotionSummaryLine,
} from '../../../learning/shadowLearningPromotionRecommendation.js';
// ADR-0433 — universe-level preflight learning snapshot 요약.
// read-only — universe ledger 만 read, LIVE 매매 무영향.
import {
  formatCounterfactualUniverseLearningSummarySection,
  summarizeCounterfactualUniverseLearningLedger,
} from '../../../persistence/counterfactualUniverseLearningRepo.js';
import {
  buildSupplyProviderWarmupReport,
  formatSupplyProviderWarmupCompactLine,
  getLastInvestorFlowProviderHealth,
  summarizeInvestorFlowProviderHealth,
} from '../../../supply/investorFlowProviderHealth.js';
// ADR-0442 — KIS WebSocket Subscription Queue 진단 섹션 (운영자 슬롯 분배 가시화).
// read-only — buildSubscriptionDiagnosis 가 _subscribedPriorities 메모리 read 만.
// LIVE 매매 본체 영향 0 — ADR-0437 SSOT 호출만 추가, 본체 무수정.
import {
  buildSubscriptionDiagnosis,
  formatKisWsSubscriptionSection,
  isKisWsSubscriptionDiagDisabled,
} from '../../../clients/kisWebSocketSubscriptionManager.js';
// ADR-0446 — Phase 2 indexCode recovery + sanity violation compact line.
// read-only — macroState 영속 sectorEnergyQualityDiagnostic 만 read.
// LIVE 매매 본체 영향 0.
import { loadMacroState } from '../../../persistence/macroStateRepo.js';
import {
  formatPhase2RecoveryCompactLine,
  formatKrxSectorIndexRawDiagnosticCompactLine,
} from '../../../clients/sectorEnergyIndexCodeRecoveryDiagnostic.js';
import { formatSanityDiagnosticCompactLine } from '../../../clients/sectorEnergySanityViolationDiagnostic.js';
import {
  buildSectorEnergyCoverageRecoveryReport,
  formatSectorEnergyCoverageRecoverySection,
} from '../../../clients/sectorEnergyCoverageRecoveryAdr0474.js';
// ADR-0448 Phase 0 — SectorEnergy 3층 분리 (diagnostic / scoring / execution) +
//   R3 Noise Governor compact line. read-only — macroState 만 read, LIVE 매매 영향 0.
import {
  deriveSectorEnergyExecutionImpact,
  formatSectorEnergyExecutionImpactCompactLine,
  isSectorEnergyExecutionDecouplingDisabled,
} from '../../../clients/sectorEnergyExecutionImpact.js';
// ADR-0451 — Empty Scan Liveness Policy compact section.
//   사용자 §"한 줄 정의" — 빈스캔 연속 발생을 SELL_ONLY hard 전환 사유로 쓰지 않고,
//   DEGRADED/OBSERVE/RETRY 상태로 처리하여 Trading Engine liveness 유지.
//   read-only — adaptiveScanScheduler.getScanFeedbackState() 메모리 read 만.
//   LIVE 매매 본체 영향 0.
import {
  evaluateEmptyScanLiveness,
  formatEmptyScanLivenessSection,
  isEmptyScanLivenessPolicyDisabled,
} from '../../../trading/signalScanner/emptyScanLivenessPolicy.js';
import { getScanFeedbackState } from '../../../orchestrator/adaptiveScanScheduler.js';
import { summarizeNearMissOutcomeLedger } from '../../../persistence/nearMissOutcomeLedger.js';
import {
  formatNearMissOutcomeAnalyticsDiagnosticLine,
  formatNearMissOutcomeDiagnosticLine,
} from '../../../learning/nearMissOutcomeFormatter.js';
import {
  buildRuntimePipelineAuditSnapshot,
  formatRuntimePipelineAuditSection,
  isRuntimePipelineAuditDisabled,
} from '../../../diagnostics/runtimePipelineAudit.js';
import {
  collectOperatorActionSourcesFromScanSummaryAdr0480,
  safeBuildOperatorActionQueueAdr0480,
  safeFormatOperatorActionCompactSectionAdr0480,
} from '../../../trading/signalScanner/operatorActionRouterAdr0480.js';
import {
  buildSupplyCoverageRecoveryObservationReportAdr0484,
  formatSupplyCoverageRecoveryCompactAdr0484,
} from '../../../trading/signalScanner/supplyCoverageRecoveryObservationAdr0484.js';
import {
  formatSupplyAdvisoryReadinessCompactAdr0485,
  safeBuildSupplyAdvisoryReadinessReportAdr0485,
} from '../../../trading/signalScanner/supplyAdvisoryReadinessAdr0485.js';
import {
  formatSupplyRecoveryRuntimeMountCompactAdr0486,
  safeBuildSupplyRecoveryRuntimeMountReportAdr0486,
} from '../../../trading/signalScanner/supplyRecoveryRuntimeMountAdr0486.js';
import {
  formatFreshDataSupplyCompactAdr0487,
  safeBuildFreshDataSupplyReportAdr0487,
  type FreshDataSupplyReportAdr0487,
  type FreshDataSupplyReportInputAdr0487,
} from '../../../trading/signalScanner/freshDataSupplyLayerAdr0487.js';
import {
  formatSectorEnergySupplyUnknownCompactAdr0488,
  safeBuildSectorEnergyAndSupplyUnknownPolicyReportAdr0488,
  type SectorEnergyAndSupplyUnknownPolicyReportAdr0488,
} from '../../../trading/signalScanner/sectorEnergyMasterSupplyUnknownPolicyAdr0488.js';
import {
  formatSupplySnapshotCompactAdr0491,
  summarizeSupplySnapshotStoreAdr0491,
} from '../../../trading/signalScanner/supplySnapshotStoreReplayAdr0491.js';
import {
  mapRuntimeFreshDataSummaryToStatusInputsAdr0498,
  safeBuildFreshDataStatusSectionAdr0498,
} from '../../../diagnostics/freshDataStatusViewModelWiringAdr0498.js';
import {
  buildEmptyScanRootCauseEventsFromStringsAdr0500,
  formatEmptyScanRootCauseCompactAdr0500,
  safeBuildEmptyScanRootCauseDashboardAdr0500,
} from '../../../diagnostics/emptyScanRootCauseDashboardAdr0500.js';
import {
  buildWeekendReplayRecordsFromStringsAdr0501,
  formatWeekendReplayCompactAdr0501,
  safeBuildWeekendReplaySummaryAdr0501,
} from '../../../diagnostics/weekendReplayAdr0501.js';
// ADR-0506 — compact mode + ADR-0505 emission verification.
// diagnostic / display only — live trading / score / threshold / order path 변경 0.
import {
  applyScanBlockersLengthBudget,
  applyScanBlockersLengthGuard,
  buildScanBlockersSupplyForensicSections,
  deriveAdr0505EmissionStatus,
  formatAdr0505EmissionCompactLine,
  formatAdr0505EmissionDetailBlock,
  formatScanBlockersCompactMessage,
  formatScanBlockersGateCompactMessage,
  SCAN_BLOCKERS_GATE_COMPACT_LENGTH_BUDGET,
  paginateScanBlockersMessage,
  parseScanBlockersMode,
  sectionMatchesMode,
  SCAN_BLOCKERS_LENGTH_BUDGET,
  type ScanBlockersMode,
} from './scanBlockersCompactAdr0506.js';
// Patch-SHADOW-APPROVAL-DEDUP-001 — runtime 모드 visibility (Shadow approval 중복 발송 통계).
import {
  formatShadowApprovalDedupeSection,
  getShadowApprovalDedupeStats,
} from '../../shadowApprovalDedupeStore.js';
import {
  formatShadowGateAuditSection,
  listShadowGateAuditRecords,
} from '../../shadowGateAuditStore.js';
// ADR-0509 — Patch-UNIFIED-GATE-SCORE-KERNEL-AUDIT-001 — Shadow rawGate + Live minSignal 통합 진단.
// diagnostic / display only — Gate threshold / score / requiredScore / KIS order path 변경 0.
import {
  buildUnifiedSnapshotsFromCurrentState,
  formatUnifiedGateComparisonSection,
  formatUnifiedGateCompactLine,
} from '../../../trading/signalScanner/unifiedGateScoreKernelAdr0509.js';
import { loadGate1ForensicTrace } from '../../../persistence/gate1MinimumSignalForensicTraceRepo.js';
// Patch-KIS-REALDATA-500-NOISE-AND-RECOVERY-001 — KIS RealData 500 provider noise compact health.
//   read-only — listKisRealDataNoiseRecords() 메모리 read 만, LIVE 매매 영향 0.
//   providerIssue=true / marketSignal=false / executionImpact=NONE literal type 강제.
import { formatKisRealDataHealthSection } from '../../../clients/kisClient/realDataNoiseStore.js';
// Patch-SHADOW-LIFECYCLE-AND-EXECUTION-001 — Shadow execution pipeline 진단 SSOT (read-only).
import { formatShadowExecutionPipelineSection } from '../../../trading/shadowExecutionPipeline.js';
// Patch-SHADOW-POSITION-MANAGEMENT-AND-SELL-LIFECYCLE-002 — runtime section.
import { formatShadowPositionLifecycleSection } from '../../../trading/shadowPositionLifecycle.js';
// Patch-KIS500-PROVIDER-HEALTH-ISOLATION-003 — circuit breaker state machine + Last Good Value
//   cache + Shadow case recording compact summary. providerIssue=true / marketSignal=false /
//   executionImpact='NONE' / telegramAllowed=false literal type 강제.
import { formatProviderHealthIsolationSection } from '../../../clients/kisClient/providerHealthIsolationPatch003.js';
import { emitScanDiagnosticBuildFailedWarn } from '../../../trading/signalScanner/state/scanDiagnosticSuppressor.js';

const scanBlockers: TelegramCommand = {
  name: '/scan_blockers',
  aliases: ['/blockers', '/why_no_buy'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '직전 스캔의 매수 차단 사유 분포 + 거시 게이트 상태 (ADR-0118 / ADR-0506)',
  usage: '/scan_blockers [full|gate|supply|sector|runtime]',
  async execute({ args, reply }) {
    const requestId = randomUUID();
    let replyCount = 0;

    function warnScanBlockersDiagnostic(sourcePath: string, error: unknown, details?: Record<string, unknown>): void {
      emitScanDiagnosticBuildFailedWarn({
        sourcePath: `scanBlockers.cmd.${sourcePath}`,
        error,
        details: { requestId, ...details },
      });
    }

    async function replyOnce(message: string): Promise<void> {
      if (replyCount > 0) {
        warnScanBlockersDiagnostic('replyOnce.duplicateSuppressed', 'duplicate reply suppressed', { replyCount });
        return;
      }
      replyCount += 1;
      await reply(message);
    }

    async function replyMany(messages: string[]): Promise<void> {
      for (const message of messages) {
        await reply(message);
      }
    }

    // ADR-0506 — mode parser (default compact). unknown → compact fallback + usage hint.
    // ADR-0507 — gate sub-mode 인식 ('gate' / 'gate full').
    const modeResult = parseScanBlockersMode(args);
    const mode: ScanBlockersMode = modeResult.mode;
    const gateSubMode = modeResult.gateSubMode;
    const supplySubMode = modeResult.supplySubMode ?? 'summary';
    const summary = getLastScanSummary();

    function logCommand(replyMode: 'single' | 'paginated', pages?: number): void {
      const subMode = mode === 'gate'
        ? (gateSubMode ?? 'compact')
        : mode === 'supply'
          ? supplySubMode
          : 'summary';
      console.info([
        '[SCAN_BLOCKERS_COMMAND]',
        `requestId=${requestId}`,
        `mode=${mode}`,
        `subMode=${subMode}`,
        `replyMode=${replyMode}`,
        ...(typeof pages === 'number' ? [`pages=${pages}`] : []),
      ].join(' '));
    }

    // ADR-0506 — ADR-0505 emission status (compact 안 + gate/full 모드 노출).
    // diagnostic-only — process.env read 만, throw 안 함 (deriveAdr0505EmissionStatus 자체 안전).
    const adr0505Diag = deriveAdr0505EmissionStatus(summary);

    // ADR-0506 — compact mode: 15~25줄 운영 요약, length budget 2000 보호.
    if (mode === 'compact') {
      const compactMessage = formatScanBlockersCompactMessage(summary, { adr0505: adr0505Diag });
      const unknownHint = modeResult.isUnknown
        ? `\n⚠️ 알 수 없는 mode "${modeResult.rawToken}" — compact 로 fallback.`
        : '';
      logCommand('single');
      await replyOnce(applyScanBlockersLengthGuard(compactMessage + unknownHint, 'compact'));
      return;
    }

    // ADR-0507 — gate compact (default for `gate` mode): 30~40줄 Gate1/ADR-0505 요약.
    //   `gate full` 또는 `full` 일 때만 기존 ADR 마커 필터링 + 장문 출력.
    if (mode === 'gate' && gateSubMode === 'compact') {
      const gateCompact = formatScanBlockersGateCompactMessage(summary, { adr0505: adr0505Diag });
      // ADR-0509 — gate compact 끝부분에 Unified Gate 1줄 요약 append (있을 때만).
      // try/catch 격리 — kernel throw / loadGate1ForensicTrace throw 가 gate compact 차단 안 함.
      let unifiedGateCompactLine: string | null = null;
      try {
        const shadowAudits = listShadowGateAuditRecords({ hydrateLiveMinimum: true });
        const forensicEntries = loadGate1ForensicTrace();
        const snapshots = buildUnifiedSnapshotsFromCurrentState({
          shadowAudits,
          forensicTraceEntries: forensicEntries,
        });
        if (snapshots.length > 0) {
          unifiedGateCompactLine = formatUnifiedGateCompactLine(snapshots);
        }
      } catch (err) {
        warnScanBlockersDiagnostic('unifiedGateCompactLine', err);
      }
      const finalGateCompact = unifiedGateCompactLine
        ? `${gateCompact}\n${unifiedGateCompactLine}`
        : gateCompact;
      const gateCompactGuarded = applyScanBlockersLengthGuard(finalGateCompact, 'gate');
      logCommand('single');
      await replyOnce(
        applyScanBlockersLengthBudget(gateCompactGuarded, SCAN_BLOCKERS_GATE_COMPACT_LENGTH_BUDGET),
      );
      return;
    }

    const baseMessage = formatScanBlockersMessage(summary);

    // ADR-0118 §"진단 추정" 확장 — TECHNICAL_PROVIDER_DEGRADED 운영자 노출 (ADR-0411).
    // try/catch 격리 — watchlist 영속 throw 가 진단 메시지 자체 차단 안 함.
    let degradedSection: string | null = null;
    try {
      const watchlist = loadWatchlist();
      degradedSection = formatTechnicalProviderDegradedSection(watchlist);
    } catch (err) {
      emitScanBlockersSectionWarn(
        '[scan_blockers] technicalProviderDegraded 섹션 빌드 실패 (진단 메시지는 baseMessage 만 출력):',
        err,
      );
    }

    // ADR-0431 — counterfactual ledger 누적 성과 한 줄 요약.
    // read-only + 외부 API 호출 0 (priceProvider 미전달 → 모든 horizon PENDING).
    // try/catch 격리 — ledger throw 가 진단 메시지 자체 차단 안 함.
    let counterfactualLine: string | null = null;
    try {
      const cfEntries = loadCounterfactualShadowLearningLedger();
      if (cfEntries.length > 0) {
        const nowKst = new Date().toISOString();
        const priceProvider = createCounterfactualShadowPriceProvider({
          entries: cfEntries,
          nowKst,
        });
        const cfSummary = await buildCounterfactualShadowPerformanceReport({
          entries: cfEntries,
          nowKst,
          priceProvider,
          // priceProvider 미전달 → 모든 horizon PENDING (외부 호출 0)
        });
        counterfactualLine = formatCounterfactualShadowSummaryLine(cfSummary);
      }
    } catch (err) {
      emitScanBlockersSectionWarn(
        '[scan_blockers] counterfactual shadow 요약 빌드 실패 (진단 메시지는 baseMessage 만 출력):',
        err,
      );
    }

    // ADR-0432 — provisional + counterfactual promotion 한 줄 요약.
    // read-only recommendation — LIVE/PAPER/normal shadow 체결 영향 0.
    // try/catch 격리 — ledger throw 가 진단 메시지 자체 차단 안 함.
    let promotionLine: string | null = null;
    try {
      const provisionalEntries = loadProvisionalShadowLedger();
      const counterfactualEntries = loadCounterfactualShadowLearningLedger();
      if (provisionalEntries.length > 0 || counterfactualEntries.length > 0) {
        const nowKst = new Date().toISOString();
        const counterfactualPriceProvider = createCounterfactualShadowPriceProvider({
          entries: counterfactualEntries,
          nowKst,
        });
        const [provisionalSummary, counterfactualSummary] = await Promise.all([
          buildProvisionalShadowPerformanceReport({ entries: provisionalEntries, nowKst }),
          buildCounterfactualShadowPerformanceReport({
            entries: counterfactualEntries,
            nowKst,
            priceProvider: counterfactualPriceProvider,
          }),
        ]);
        // Top winners + losers 합집합 (중복 제거 by id)
        const provisionalRecords = [
          ...provisionalSummary.topWinners,
          ...provisionalSummary.topLosers,
        ].filter((r, i, arr) => arr.findIndex((x) => x.id === r.id) === i);
        const counterfactualRecords = [
          ...counterfactualSummary.topWinners,
          ...counterfactualSummary.topLosers,
        ].filter((r, i, arr) => arr.findIndex((x) => x.id === r.id) === i);
        const promotionSummary = buildShadowLearningPromotionRecommendations({
          provisionalRecords,
          counterfactualRecords,
          nowKst,
        });
        promotionLine = formatShadowLearningPromotionSummaryLine(promotionSummary);
      }
    } catch (err) {
      emitScanBlockersSectionWarn(
        '[scan_blockers] shadow learning promotion 요약 빌드 실패 (진단 메시지는 baseMessage 만 출력):',
        err,
      );
    }

    // ADR-0433 — universe-level preflight learning snapshot 요약 섹션.
    // read-only + 외부 API 호출 0 (universe ledger 만 read).
    // try/catch 격리 — ledger throw 가 진단 메시지 자체 차단 안 함.
    let universeSection: string | null = null;
    try {
      const universeSummary = summarizeCounterfactualUniverseLearningLedger();
      universeSection = formatCounterfactualUniverseLearningSummarySection(universeSummary);
    } catch (err) {
      emitScanBlockersSectionWarn(
        '[scan_blockers] counterfactual universe learning 섹션 빌드 실패 (진단 메시지는 baseMessage 만 출력):',
        err,
      );
    }

    // ADR-0435 — investor-flow provider health read-only summary.
    // Uses the last observed router health only; /scan_blockers must not trigger
    // KRX/NAVER/KIS provider fetches.
    let supplyProviderSection: string | null = null;
    let supplyProviderWarmupSection: string | null = null;
    try {
      const investorFlowHealth = getLastInvestorFlowProviderHealth();
      supplyProviderSection = summarizeInvestorFlowProviderHealth(investorFlowHealth, summary?.investorFlowProviderRouter ? {
        status: summary.investorFlowProviderRouter.status,
        selectedProvider: summary.investorFlowProviderRouter.selectedProvider,
        selectedReason: summary.investorFlowProviderRouter.selectedReason,
        providerTried: [...summary.investorFlowProviderRouter.providerTried],
        providerStatuses: { ...summary.investorFlowProviderRouter.providerStatuses },
        signal: summary.investorFlowProviderRouter.signal,
        coverage: summary.investorFlowProviderRouter.coverage,
        executionImpact: summary.investorFlowProviderRouter.executionImpact,
        liveExecutionAllowed: summary.investorFlowProviderRouter.liveExecutionAllowed,
      } : null);
      supplyProviderWarmupSection = formatSupplyProviderWarmupCompactLine(
        buildSupplyProviderWarmupReport({
          health: investorFlowHealth,
          investorFlowRouter: summary?.investorFlowProviderRouter ? {
            status: summary.investorFlowProviderRouter.status,
            selectedProvider: summary.investorFlowProviderRouter.selectedProvider,
            providerTried: [...summary.investorFlowProviderRouter.providerTried],
            providerStatuses: { ...summary.investorFlowProviderRouter.providerStatuses },
            selectedReason: summary.investorFlowProviderRouter.selectedReason,
            signal: summary.investorFlowProviderRouter.signal,
            coverage: summary.investorFlowProviderRouter.coverage,
            executionImpact: summary.investorFlowProviderRouter.executionImpact,
            liveExecutionAllowed: summary.investorFlowProviderRouter.liveExecutionAllowed,
          } : undefined,
          naverInvestorTrendAdr0481: summary?.naverInvestorTrendAdr0481 ?? null,
          semanticNetBuyNormalizationAdr0482: summary?.semanticNetBuyNormalizationAdr0482 ?? null,
          supplySourceFreshnessAdr0483: summary?.supplySourceFreshnessAdr0483 ?? null,
        }),
      );
    } catch (err) {
      emitScanBlockersSectionWarn(
        '[scan_blockers] investor-flow provider health section failed:',
        err,
      );
    }

    // ADR-0442 — KIS WebSocket Subscription Queue 진단 섹션.
    // read-only — buildSubscriptionDiagnosis 가 _subscribedPriorities 메모리 read 만.
    // try/catch 격리 — 진단 throw 가 base 메시지 차단 안 함.
    // ENV `KIS_WS_SUBSCRIPTION_DIAG_DISABLED=true` 시 섹션 미노출.
    // total=0 (구독 0건 시점) 시 섹션 미노출 — 운영자 noise 차단.
    let kisWsSubscriptionSection: string | null = null;
    try {
      if (!isKisWsSubscriptionDiagDisabled()) {
        const diag = buildSubscriptionDiagnosis();
        if (diag.total > 0) {
          kisWsSubscriptionSection = formatKisWsSubscriptionSection(diag);
        }
      }
    } catch (err) {
      emitScanBlockersSectionWarn(
        '[scan_blockers] kis-ws subscription 섹션 빌드 실패 (진단 메시지는 baseMessage 만 출력):',
        err,
      );
    }

    // ADR-0446 — Phase 2 recovery + sanity violation compact lines.
    // read-only — macroState.sectorEnergyQualityDiagnostic 만 read.
    // try/catch 격리 — 진단 throw 가 base 메시지 차단 안 함.
    let phase2Line: string | null = null;
    let krxRawLine: string | null = null;
    let sanityLine: string | null = null;
    let sectorEnergyCoverageRecoverySection: string | null = null;
    try {
      const macro = loadMacroState();
      const qDiag = macro?.sectorEnergyQualityDiagnostic;
      if (qDiag?.sectorIndexRecovery) {
        // sectorIndexRecovery 영속 데이터 (cast 안전 — schema 옵셔널 후방호환)
        phase2Line = formatPhase2RecoveryCompactLine(
          qDiag.sectorIndexRecovery as Parameters<typeof formatPhase2RecoveryCompactLine>[0],
        );
      }
      // KRX-SECTOR-INDEXCODE-RAW-DIAGNOSTIC-001: KRX raw 입력 부검 compact line.
      if (qDiag?.krxSectorIndexRaw) {
        krxRawLine = formatKrxSectorIndexRawDiagnosticCompactLine(
          qDiag.krxSectorIndexRaw as Parameters<typeof formatKrxSectorIndexRawDiagnosticCompactLine>[0],
        );
      }
      if (qDiag?.sanityViolation) {
        sanityLine = formatSanityDiagnosticCompactLine(
          qDiag.sanityViolation as Parameters<typeof formatSanityDiagnosticCompactLine>[0],
        );
      }
      sectorEnergyCoverageRecoverySection = formatSectorEnergyCoverageRecoverySection(
        qDiag
          ? buildSectorEnergyCoverageRecoveryReport({
              qualityDiagnostic: qDiag as NonNullable<
                Parameters<typeof buildSectorEnergyCoverageRecoveryReport>[0]
              >['qualityDiagnostic'],
            })
          : buildSectorEnergyCoverageRecoveryReport(),
      );
      if (sectorEnergyCoverageRecoverySection) {
        console.log(
          qDiag
            ? '[ADR-0474] SectorEnergy coverage recovery diagnostic appended to /scan_blockers'
            : '[ADR-0474] SectorEnergy coverage recovery fallback mounted to /scan_blockers',
        );
      }
    } catch (err) {
      emitScanBlockersSectionWarn(
        '[scan_blockers] ADR-0446 Phase 2/Sanity compact line 빌드 실패 (진단 메시지는 baseMessage 만 출력):',
        err,
      );
    }

    // ADR-0448 Phase 0 — SectorEnergy 3층 분리 compact line.
    // read-only — macroState.sectorEnergyQualityDiagnostic 만 read.
    // try/catch 격리 — 진단 throw 가 base 메시지 차단 안 함.
    // ENV `SECTOR_ENERGY_EXECUTION_DECOUPLING_DISABLED=true` 시 미노출 (default OFF).
    let executionImpactLine: string | null = null;
    try {
      if (!isSectorEnergyExecutionDecouplingDisabled()) {
        const macroForExec = loadMacroState();
        const qDiagForExec = macroForExec?.sectorEnergyQualityDiagnostic as
          | {
              dataQuality?: string;
              sourceTier?: string;
              shouldBlockLeadershipConfidence?: boolean;
              sanityViolation?: { confidenceImpact?: 'NONE' | 'DEGRADED' | 'BLOCKED' };
              fallbackUsed?: 'NONE' | 'STOCK_DAILY' | 'ETF' | 'CACHE';
              indexCodeCoverage?: number;
            }
          | undefined;
        const decision = deriveSectorEnergyExecutionImpact({
          ...(qDiagForExec?.dataQuality !== undefined ? { dataQuality: qDiagForExec.dataQuality } : {}),
          ...(qDiagForExec?.sourceTier !== undefined ? { sourceTier: qDiagForExec.sourceTier } : {}),
          ...(qDiagForExec?.shouldBlockLeadershipConfidence !== undefined
            ? { leadershipConfidence: qDiagForExec.shouldBlockLeadershipConfidence ? 'BLOCKED' : 'OK' }
            : {}),
          ...(qDiagForExec?.sanityViolation?.confidenceImpact !== undefined
            ? { sanityConfidenceImpact: qDiagForExec.sanityViolation.confidenceImpact }
            : {}),
          ...(qDiagForExec?.fallbackUsed !== undefined ? { fallbackUsed: qDiagForExec.fallbackUsed } : {}),
          ...(qDiagForExec?.indexCodeCoverage !== undefined ? { indexCodeCoverage: qDiagForExec.indexCodeCoverage } : {}),
        });
        executionImpactLine = formatSectorEnergyExecutionImpactCompactLine(decision);
      }
    } catch (err) {
      emitScanBlockersSectionWarn(
        '[scan_blockers] ADR-0448 SectorEnergy execution impact line 빌드 실패 (진단 메시지는 baseMessage 만 출력):',
        err,
      );
    }

    // ADR-454b/455 — Near-Miss Outcome 누적 성과 + 과잉 차단 analytics compact lines.
    // read-only ledger summary/entries 만 사용한다. /scan_blockers 호출은 가격조회/API/order 를 트리거하지 않는다.
    // executionImpact=NONE: DATA_BLOCKED_NEAR_MISS / PROBING / SHADOW_ONLY 학습/진단 노출 전용.
    let nearMissOutcomeLine: string | null = null;
    let nearMissAnalyticsLine: string | null = null;
    try {
      nearMissOutcomeLine = formatNearMissOutcomeDiagnosticLine(summarizeNearMissOutcomeLedger());
      nearMissAnalyticsLine = formatNearMissOutcomeAnalyticsDiagnosticLine();
    } catch (err) {
      emitScanBlockersSectionWarn(
        '[scan_blockers] ADR-454b/455 near-miss outcome line 빌드 실패 (진단 메시지는 baseMessage 만 출력):',
        err,
      );
    }

    // ADR-0451 — Empty Scan Liveness Policy compact section.
    //   사용자 §7 정합 — REGULAR session + emptyScanStreak 만으로 SELL_ONLY 강제 안 됨 명시.
    //   read-only — adaptiveScanScheduler.getScanFeedbackState() 메모리 read 만, 신규 외부 API 호출 0.
    //   ENV `EMPTY_SCAN_LIVENESS_POLICY_DISABLED=true` 시 미노출 (default OFF).
    //   try/catch 격리 — 정책 throw 가 base 메시지 차단 안 함.
    let livenessSection: string | null = null;
    try {
      if (!isEmptyScanLivenessPolicyDisabled()) {
        const feedback = getScanFeedbackState();
        const decision = evaluateEmptyScanLiveness({
          // /scan_blockers 호출 시점 session 미상 — REGULAR fallback 으로 정책 적용.
          //   adaptiveScanScheduler 가 실제 매핑된 session 으로 재평가 (decideScan 시점).
          marketSession: 'REGULAR',
          emptyScanStreak: feedback.consecutiveEmptyScans,
        });
        livenessSection = formatEmptyScanLivenessSection(decision, feedback.consecutiveEmptyScans);
      }
    } catch (err) {
      emitScanBlockersSectionWarn(
        '[scan_blockers] ADR-0451 emptyScan liveness section 빌드 실패 (진단 메시지는 baseMessage 만 출력):',
        err,
      );
    }

    let runtimeAuditSection: string | null = null;
    try {
      if (!isRuntimePipelineAuditDisabled()) {
        runtimeAuditSection = formatRuntimePipelineAuditSection(buildRuntimePipelineAuditSnapshot());
      }
    } catch (err) {
      emitScanBlockersSectionWarn('[scan_blockers] ADR-461 runtime audit section failed:', err);
    }

    // ADR-0480 — Operator Action Router compact Top 3.
    // Diagnostic-only: no provider fetch, no order import, no live policy mutation.
    // try/catch isolation is inside safeBuild/safeFormat and this outer guard.
    let freshDataSupplyReportForOperator: FreshDataSupplyReportAdr0487 | null = summary?.freshDataSupplyAdr0487 ?? null;
    let sectorEnergySupplyUnknownReportForOperator: SectorEnergyAndSupplyUnknownPolicyReportAdr0488 | null =
      summary?.sectorEnergySupplyUnknownAdr0488 ?? null;
    try {
      if (!freshDataSupplyReportForOperator) {
        freshDataSupplyReportForOperator = safeBuildFreshDataSupplyReportAdr0487({
          sectorEnergyDiagnosticAdr0474: loadMacroState()?.sectorEnergyQualityDiagnostic as unknown as Record<string, unknown> | null,
          naverInvestorTrendAdr0481: summary?.naverInvestorTrendAdr0481 as unknown as Record<string, unknown>,
          semanticNetBuyNormalizationAdr0482: summary?.semanticNetBuyNormalizationAdr0482 as unknown as Record<string, unknown>,
          supplySourceFreshnessAdr0483: summary?.supplySourceFreshnessAdr0483 as unknown as FreshDataSupplyReportInputAdr0487['supplySourceFreshnessAdr0483'],
          supplyCoverageRecoveryAdr0484: summary?.supplyCoverageRecoveryAdr0484 as unknown as Record<string, unknown>,
          supplyAdvisoryReadinessAdr0485: summary?.supplyAdvisoryReadinessAdr0485 as unknown as Record<string, unknown>,
          investorFlowProviderRouterAdr0477: summary?.investorFlowProviderRouter ?? null,
        });
      }
      if (!sectorEnergySupplyUnknownReportForOperator) {
        sectorEnergySupplyUnknownReportForOperator = safeBuildSectorEnergyAndSupplyUnknownPolicyReportAdr0488({
          sectorEnergyDiagnosticAdr0474: loadMacroState()?.sectorEnergyQualityDiagnostic as unknown as Record<string, unknown> | null,
          freshDataSupplyAdr0487: freshDataSupplyReportForOperator,
          finalGate1CalibrationAdr0471: summary?.finalGate1Calibration ?? null,
          penaltyDeduplicationAdr0469: summary?.penaltyDeduplication ?? null,
          providerStatus: summary?.investorFlowProviderRouter?.status ?? summary?.naverInvestorTrendAdr0481?.status ?? 'UNKNOWN',
          currentSupplySignal: summary?.investorFlowProviderRouter?.signal ?? 'UNKNOWN',
          providerIssue: summary?.investorFlowProviderRouter?.signal !== 'BEARISH',
          marketSignal: false,
        });
      }
    } catch (err) {
      emitScanBlockersSectionWarn('[scan_blockers] ADR-0487/0488 fresh data and supply unknown report failed:', err);
    }

    let operatorActionSection: string | null = null;
    try {
      const operatorActionQueue = safeBuildOperatorActionQueueAdr0480({
        sources: collectOperatorActionSourcesFromScanSummaryAdr0480(summary),
        supplyCoverageRecoveryAdr0484: summary?.supplyCoverageRecoveryAdr0484 ?? null,
        supplyAdvisoryReadinessAdr0485: summary?.supplyAdvisoryReadinessAdr0485 ?? null,
        supplyRecoveryRuntimeMountAdr0486: summary?.supplyRecoveryRuntimeMountAdr0486 ?? null,
        freshDataSupplyAdr0487: freshDataSupplyReportForOperator,
        sectorEnergySupplyUnknownAdr0488: sectorEnergySupplyUnknownReportForOperator,
      });
      operatorActionSection = safeFormatOperatorActionCompactSectionAdr0480(operatorActionQueue);
    } catch (err) {
      emitScanBlockersSectionWarn('[scan_blockers] ADR-0480 operator action section failed:', err);
    }

    let supplySnapshotLine: string | null = null;
    try {
      supplySnapshotLine = formatSupplySnapshotCompactAdr0491(summary?.supplySnapshotStoreAdr0491 ?? summarizeSupplySnapshotStoreAdr0491());
    } catch (err) {
      emitScanBlockersSectionWarn('[scan_blockers] ADR-0491 supply snapshot line failed:', err);
    }

    let emptyScanRootCauseSectionAdr0500: string | null = null;
    try {
      if ((summary?.entries ?? 0) === 0 || (summary?.gateMisses ?? 0) > 0 || (summary?.yahooFails ?? 0) > 0) {
        const dashboard = summary?.emptyScanRootCause ?? safeBuildEmptyScanRootCauseDashboardAdr0500({
          scanId: summary?.time ? `scan-blockers-${summary.time}` : undefined,
          events: buildEmptyScanRootCauseEventsFromStringsAdr0500([
            ...(summary?.macroGateState?.sellOnlyMode ? [{ source: 'SCAN_BLOCKER' as const, reason: 'SELL_ONLY', count: 1 }] : []),
            ...((summary?.macroGateState?.bearDefenseMode || summary?.macroGateState?.vixGatingActive || summary?.macroGateState?.mhsBelow30) ? [{ source: 'SCAN_BLOCKER' as const, reason: 'MACRO_RISK_OFF', count: 1 }] : []),
            ...((summary?.yahooFails ?? 0) > 0 ? [{ source: 'SCAN_BLOCKER' as const, reason: 'PROVIDER_ERROR', count: summary?.yahooFails }] : []),
            ...((summary?.waitDistribution?.sizingBlocked ?? 0) > 0 ? [{ source: 'SCAN_BLOCKER' as const, reason: 'SIZING', count: summary?.waitDistribution?.sizingBlocked }] : []),
            ...((summary?.waitDistribution?.gateFail ?? 0) > 0 ? [{ source: 'SCAN_BLOCKER' as const, reason: 'THRESHOLD', count: summary?.waitDistribution?.gateFail }] : []),
            ...(summary?.emptyScanReason ? [{ source: 'SCAN_BLOCKER' as const, reason: summary.emptyScanReason, message: 'ADR-0119 empty scan reason' }] : []),
          ]),
          totalEmptyScans: (summary?.entries ?? 0) === 0 ? 1 : 0,
        });
        emptyScanRootCauseSectionAdr0500 = formatEmptyScanRootCauseCompactAdr0500(dashboard, { maxBuckets: 5 });
      }
    } catch (err) {
      emitScanBlockersSectionWarn('[scan_blockers] ADR-0500 empty scan root cause section failed:', err);
    }

    let weekendReplaySectionAdr0501: string | null = null;
    try {
      if ((summary?.entries ?? 0) === 0 || (summary?.gateMisses ?? 0) > 0 || (summary?.yahooFails ?? 0) > 0) {
        const records = buildWeekendReplayRecordsFromStringsAdr0501([
          ...(summary?.macroGateState?.sellOnlyMode ? [{ source: 'SCAN_SUMMARY' as const, reason: 'SELL_ONLY', replayMode: 'LATEST' as const }] : []),
          ...((summary?.macroGateState?.bearDefenseMode || summary?.macroGateState?.vixGatingActive || summary?.macroGateState?.mhsBelow30) ? [{ source: 'SCAN_SUMMARY' as const, reason: 'MACRO_RISK_OFF', replayMode: 'LATEST' as const }] : []),
          ...((summary?.yahooFails ?? 0) > 0 ? [{ source: 'SCAN_SUMMARY' as const, reason: 'PROVIDER_ERROR', replayMode: 'LATEST' as const }] : []),
          ...((summary?.waitDistribution?.sizingBlocked ?? 0) > 0 ? [{ source: 'SCAN_SUMMARY' as const, reason: 'SIZING', replayMode: 'LATEST' as const }] : []),
          ...((summary?.waitDistribution?.gateFail ?? 0) > 0 ? [{ source: 'SCAN_SUMMARY' as const, reason: 'THRESHOLD', replayMode: 'LATEST' as const }] : []),
          ...(summary?.emptyScanReason ? [{ source: 'SCAN_SUMMARY' as const, reason: summary.emptyScanReason, message: 'ADR-0119 empty scan reason', replayMode: 'LATEST' as const }] : []),
        ]);
        const replaySummary = summary?.weekendReplaySummaryAdr0501 ?? safeBuildWeekendReplaySummaryAdr0501({
          records,
          replayMode: 'LATEST',
          totalScans: summary ? 1 : 0,
          totalSymbols: summary?.candidates ?? 0,
        });
        if (replaySummary.totalRecords > 0) {
          weekendReplaySectionAdr0501 = formatWeekendReplayCompactAdr0501(replaySummary, { maxCauses: 3 });
        }
      }
    } catch (err) {
      emitScanBlockersSectionWarn('[scan_blockers] ADR-0501 weekend replay section failed:', err);
    }

    let adr0498FreshDataStatusSection: string | null = null;
    try {
      const adr0498 = safeBuildFreshDataStatusSectionAdr0498(
        mapRuntimeFreshDataSummaryToStatusInputsAdr0498(summary as unknown as Record<string, unknown> | null | undefined),
        { maxLines: 3 },
      );
      adr0498FreshDataStatusSection = ['ADR-0498 FreshDataStatus normalized', ...adr0498.lines].join('\n');
    } catch (err) {
      emitScanBlockersSectionWarn('[scan_blockers] ADR-0498 fresh data status section failed:', err);
    }

    let supplyCoverageRecoveryLine: string | null = null;
    let supplyAdvisoryReadinessLine: string | null = null;
    let supplyRecoveryRuntimeMountLine: string | null = null;
    let freshDataSupplyLine: string | null = null;
    let sectorEnergySupplyUnknownLine: string | null = null;
    let supplySemanticAuditSection: string | null = null;
    try {
      const recoveryReport = summary?.supplyCoverageRecoveryAdr0484 ?? buildSupplyCoverageRecoveryObservationReportAdr0484({ scanSummary: summary, persist: false });
      supplyCoverageRecoveryLine = formatSupplyCoverageRecoveryCompactAdr0484(recoveryReport);
      const readinessReport = summary?.supplyAdvisoryReadinessAdr0485 ?? safeBuildSupplyAdvisoryReadinessReportAdr0485({ supplyCoverageRecoveryAdr0484: recoveryReport });
      supplyAdvisoryReadinessLine = formatSupplyAdvisoryReadinessCompactAdr0485(readinessReport);
      const mountReport = summary?.supplyRecoveryRuntimeMountAdr0486 ?? safeBuildSupplyRecoveryRuntimeMountReportAdr0486({
        warmupOutput: supplyProviderWarmupSection,
        warmupReport: supplyProviderWarmupSection ? undefined : null,
        investorFlowProviderRouterAdr0477: summary?.investorFlowProviderRouter ?? null,
        naverInvestorTrendAdr0481: summary?.naverInvestorTrendAdr0481 ?? null,
        semanticNetBuyNormalizationAdr0482: summary?.semanticNetBuyNormalizationAdr0482 ?? null,
        supplySourceFreshnessAdr0483: summary?.supplySourceFreshnessAdr0483 ?? null,
        supplyCoverageRecoveryAdr0484: recoveryReport,
        supplyAdvisoryReadinessAdr0485: readinessReport,
        compactOutput: [
          supplyProviderWarmupSection,
          supplyCoverageRecoveryLine,
          supplyAdvisoryReadinessLine,
          runtimeAuditSection,
        ].filter((line): line is string => typeof line === 'string' && line.length > 0),
        detailRegistryEntries: [
          { adr: '0481', adrTraceHint: '/adr_trace 0481', commandHint: '/supply_health_detail' },
          { adr: '0482', adrTraceHint: '/adr_trace 0482', commandHint: '/supply_health_detail' },
          { adr: '0483', adrTraceHint: '/adr_trace 0483', commandHint: '/supply_health_detail' },
          { adr: '0484', adrTraceHint: '/adr_trace 0484', commandHint: '/supply_health_detail' },
          { adr: '0485', adrTraceHint: '/adr_trace 0485', commandHint: '/supply_health_detail' },
          { adr: '0486', adrTraceHint: '/adr_trace 0486', commandHint: '/supply_health_detail' },
        ],
        runtimePipelineAuditEvidence: runtimeAuditSection,
      });
      supplyRecoveryRuntimeMountLine = formatSupplyRecoveryRuntimeMountCompactAdr0486(mountReport);
      freshDataSupplyReportForOperator = freshDataSupplyReportForOperator ?? safeBuildFreshDataSupplyReportAdr0487({
        sectorEnergyDiagnosticAdr0474: loadMacroState()?.sectorEnergyQualityDiagnostic as unknown as Record<string, unknown> | null,
        naverInvestorTrendAdr0481: summary?.naverInvestorTrendAdr0481 as unknown as Record<string, unknown>,
        semanticNetBuyNormalizationAdr0482: summary?.semanticNetBuyNormalizationAdr0482 as unknown as Record<string, unknown>,
        supplySourceFreshnessAdr0483: summary?.supplySourceFreshnessAdr0483 as unknown as FreshDataSupplyReportInputAdr0487['supplySourceFreshnessAdr0483'],
        supplyCoverageRecoveryAdr0484: recoveryReport as unknown as Record<string, unknown>,
        supplyAdvisoryReadinessAdr0485: readinessReport as unknown as Record<string, unknown>,
        investorFlowProviderRouterAdr0477: summary?.investorFlowProviderRouter ?? null,
      });
      freshDataSupplyLine = formatFreshDataSupplyCompactAdr0487(freshDataSupplyReportForOperator);
      sectorEnergySupplyUnknownReportForOperator = sectorEnergySupplyUnknownReportForOperator ?? safeBuildSectorEnergyAndSupplyUnknownPolicyReportAdr0488({
        sectorEnergyDiagnosticAdr0474: loadMacroState()?.sectorEnergyQualityDiagnostic as unknown as Record<string, unknown> | null,
        freshDataSupplyAdr0487: freshDataSupplyReportForOperator,
        finalGate1CalibrationAdr0471: summary?.finalGate1Calibration ?? null,
        penaltyDeduplicationAdr0469: summary?.penaltyDeduplication ?? null,
        providerStatus: summary?.investorFlowProviderRouter?.status ?? summary?.naverInvestorTrendAdr0481?.status ?? 'UNKNOWN',
        currentSupplySignal: summary?.investorFlowProviderRouter?.signal ?? 'UNKNOWN',
        providerIssue: summary?.investorFlowProviderRouter?.signal !== 'BEARISH',
        marketSignal: false,
      });
      sectorEnergySupplyUnknownLine = formatSectorEnergySupplyUnknownCompactAdr0488(sectorEnergySupplyUnknownReportForOperator);
      const forensic = summary?.gate1MinimumSignalForensicAdr0505;
      if (forensic?.totalCandidates && forensic.totalCandidates > 0) {
        const reasonTop = Object.entries(forensic.semanticReasonDistribution ?? {})
          .filter(([, count]) => Number(count) > 0)
          .sort((a, b) => Number(b[1]) - Number(a[1]))
          .slice(0, 2)
          .map(([reason, count]) => `${reason} ${count}`)
          .join(', ') || 'none';
        const scoreUsage = Object.entries(forensic.scoreUsageDistribution ?? {})
          .filter(([, count]) => Number(count) > 0)
          .sort((a, b) => Number(b[1]) - Number(a[1]))
          .map(([usage]) => usage)
          .join(',') || 'SHADOW_ONLY';
        const breakPointTop = Object.entries(forensic.semanticRowBreakPointDistribution ?? {})
          .filter(([, count]) => Number(count) > 0)
          .sort((a, b) => Number(b[1]) - Number(a[1]))
          .map(([breakPoint, count]) => `${breakPoint} ${count}`)
          .join(', ') || 'UNKNOWN';
        const nextAction = reasonTop.includes('SEMANTIC_ROW_METADATA_ONLY') || reasonTop.includes('ROUTER_DROPPED_SEMANTIC_ROW') || reasonTop.includes('FORENSIC_INPUT_DROPPED_SEMANTIC_ROW')
          ? 'WIRE_KIS_SELECTED_CANDIDATE_SEMANTIC_ROW'
          : reasonTop.includes('FIELD_ALIAS_NOT_MAPPED') || reasonTop.includes('NO_FOREIGN_OR_INSTITUTION_FIELD')
            ? 'MAP_KIS_NETBUY_FIELDS'
          : reasonTop.includes('ROW_MAPPING_FAILED')
            ? 'MAP_INVESTOR_TYPE_ROWS_TO_NETBUY'
            : reasonTop.includes('ONLY_MARKET_LEVEL_FLOW') || reasonTop.includes('ONLY_SECTOR_LEVEL_FLOW')
              ? 'REJECT_MARKET_LEVEL_FLOW_FOR_SYMBOL_SCORE'
              : (forensic.zeroButMaterializedCount ?? 0) > 0
                ? 'OBSERVE_ZERO_NEUTRAL_SUPPLY'
                : 'WIRE_KIS_INVESTOR_FLOW_NETBUY_FIELDS';
        supplySemanticAuditSection = [
          '🔌 KIS Investor Flow Semantic Row',
          `• selectedProvider: ${summary?.investorFlowProviderRouter?.selectedProvider ?? 'KIS_API'}`,
          `• rawRow: ${forensic.rawInvestorRowAvailableCount ?? 0}/${forensic.totalCandidates}`,
          `• semanticRow: ${forensic.semanticRowAvailableCount ?? 0}/${forensic.totalCandidates}`,
          `• metadataOnly: ${forensic.semanticRowMetadataOnlyCount ?? 0}/${forensic.totalCandidates}`,
          `• foreignField: ${forensic.foreignNetBuyAvailable ?? 0}/${forensic.totalCandidates}`,
          `• institutionalField: ${forensic.institutionalNetBuyAvailable ?? 0}/${forensic.totalCandidates}`,
          `• breakPoint: ${breakPointTop}`,
          '• scoreUsage: SHADOW_ONLY',
          '• marketSignal=false',
          '• executionImpact=NONE',
          `• nextAction: ${nextAction}`,
          '',
          '🔌 Supply Semantic Audit (ADR-0482)',
          `• selectedProvider: ${summary?.investorFlowProviderRouter?.selectedProvider ?? 'KIS_API'}`,
          `• symbolMatched: ${forensic.symbolMatchedCount ?? forensic.supplySymbolMatchedCount ?? 0}/${forensic.totalCandidates}`,
          `• semanticAvailable: ${forensic.supplySemanticAvailable ?? 0}/${forensic.totalCandidates}`,
          `• diagnosticAvailable: ${forensic.supplyDiagnosticAvailable ?? 0}/${forensic.totalCandidates}`,
          `• foreignNetBuy: ${forensic.foreignNetBuyAvailable ?? 0}/${forensic.totalCandidates}`,
          `• institutionalNetBuy: ${forensic.institutionalNetBuyAvailable ?? 0}/${forensic.totalCandidates}`,
          `• reasonTop: ${reasonTop}`,
          `• kisRawFieldKeysTop: ${Object.entries(forensic.kisRawFieldKeysTop ?? {}).filter(([, count]) => Number(count) > 0).sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 8).map(([key, count]) => `${key}=${count}`).join(', ') || 'none'}`,
          `• mappedFieldDistribution: foreign=${Object.entries(forensic.mappedFieldDistribution?.foreign ?? {}).filter(([, count]) => Number(count) > 0).sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 5).map(([key, count]) => `${key}=${count}`).join(', ') || 'none'} institution=${Object.entries(forensic.mappedFieldDistribution?.institution ?? {}).filter(([, count]) => Number(count) > 0).sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 5).map(([key, count]) => `${key}=${count}`).join(', ') || 'none'}`,
          `• scoreUsage: ${scoreUsage}`,
          '• marketSignal=false',
          '• executionImpact=NONE',
          `• supplyRouterForensicConflict=${forensic.supplyRouterForensicConflict === true}`,
          `• selectedCandidateCarriesSemanticRow: ${forensic.selectedCandidateCarriesSemanticRowCount ?? 0}/${forensic.totalCandidates}`,
          `• forensicInputCarriesSemanticRow: ${forensic.forensicInputCarriesSemanticRowCount ?? 0}/${forensic.totalCandidates}`,
          `• semanticRowBreakPoint: ${breakPointTop}`,
          `• nextAction: ${nextAction}`,
        ].join('\n');
      }
    } catch (err) {
      emitScanBlockersSectionWarn('[scan_blockers] ADR-0484/0485/0486/0487/0488 supply recovery/readiness/mount/fresh-data/unknown line failed:', err);
    }

    // ADR-0506 — ADR-0505 emission status line (compact for gate / detail for full).
    // SUMMARY_FIELD_MISSING / FORENSIC_INPUTS_MISSING / BUILDER_NOT_CALLED 시 NOT_EMITTED 표시.
    const adr0505CompactLine =
      adr0505Diag.status === 'EMITTED' ? null : formatAdr0505EmissionCompactLine(adr0505Diag);
    const adr0505DetailBlock =
      mode === 'full' || mode === 'gate' ? formatAdr0505EmissionDetailBlock(adr0505Diag) : null;

    const parts: string[] = [baseMessage];
    const normalSupplyPreviewSection = formatNormalSupplyPreviewSection(
      getLastNormalSupplyPreview(),
      { maxTopCandidates: mode === 'full' ? 5 : 3 },
    );
    if (normalSupplyPreviewSection) parts.push(normalSupplyPreviewSection);
    if (degradedSection) parts.push(degradedSection);
    if (supplyProviderSection) parts.push(supplyProviderSection);
    if (supplyProviderWarmupSection) parts.push(supplyProviderWarmupSection);
    if (counterfactualLine) parts.push(counterfactualLine);
    if (promotionLine) parts.push(promotionLine);
    if (universeSection) parts.push(universeSection);
    if (kisWsSubscriptionSection) parts.push(kisWsSubscriptionSection);
    if (phase2Line) parts.push(`🧩 SectorEnergy indexCode Recovery Phase 2: ${phase2Line}`);
    if (krxRawLine) parts.push(krxRawLine);
    if (sanityLine) parts.push(`🧪 ${sanityLine}`);
    if (sectorEnergyCoverageRecoverySection) parts.push(sectorEnergyCoverageRecoverySection);
    if (executionImpactLine) parts.push(executionImpactLine);
    if (nearMissOutcomeLine) parts.push(nearMissOutcomeLine);
    if (nearMissAnalyticsLine) parts.push(nearMissAnalyticsLine);
    if (livenessSection) parts.push(livenessSection);
    if (operatorActionSection) parts.push(operatorActionSection);
    if (emptyScanRootCauseSectionAdr0500) parts.push(emptyScanRootCauseSectionAdr0500);
    if (weekendReplaySectionAdr0501) parts.push(weekendReplaySectionAdr0501);
    if (adr0498FreshDataStatusSection) parts.push(adr0498FreshDataStatusSection);
    if (supplyCoverageRecoveryLine) parts.push(supplyCoverageRecoveryLine);
    if (supplyAdvisoryReadinessLine) parts.push(supplyAdvisoryReadinessLine);
    if (supplyRecoveryRuntimeMountLine) parts.push(supplyRecoveryRuntimeMountLine);
    if (freshDataSupplyLine) parts.push(freshDataSupplyLine);
    if (sectorEnergySupplyUnknownLine) parts.push(sectorEnergySupplyUnknownLine);
    if (supplySemanticAuditSection) parts.push(supplySemanticAuditSection);
    if (supplySnapshotLine) parts.push(supplySnapshotLine);
    if (runtimeAuditSection) parts.push(runtimeAuditSection);

    // Patch-SHADOW-GATE-AUDIT-001 — Shadow Gate vs Live minimum signal compact audit.
    try {
      const shadowGateAudits = listShadowGateAuditRecords({ hydrateLiveMinimum: true });
      if (shadowGateAudits.length > 0) parts.push(formatShadowGateAuditSection(shadowGateAudits));
    } catch (err) {
      emitScanBlockersSectionWarn('[scan_blockers] Patch-SHADOW-GATE-AUDIT-001 section failed:', err);
    }

    // ADR-0509 — Patch-UNIFIED-GATE-SCORE-KERNEL-AUDIT-001 — Shadow rawGate + Live minSignal
    // 통합 진단 (runtime 모드 노출). [PATCH-RUNTIME] 태그로 sectionMatchesMode 통과.
    // try/catch 격리 — kernel throw / loadGate1ForensicTrace throw 가 base 메시지 차단 안 함.
    // executionImpact='NONE' / liveOrderPlaced=false literal type 강제 (kernel 본체).
    try {
      const shadowAudits = listShadowGateAuditRecords({ hydrateLiveMinimum: true });
      const forensicEntries = loadGate1ForensicTrace();
      const snapshots = buildUnifiedSnapshotsFromCurrentState({
        shadowAudits,
        forensicTraceEntries: forensicEntries,
      });
      const unifiedSection = formatUnifiedGateComparisonSection(snapshots);
      if (unifiedSection) parts.push(unifiedSection);
    } catch (err) {
      emitScanBlockersSectionWarn('[scan_blockers] ADR-0509 Unified Gate runtime section failed:', err);
    }

    // Patch-KIS-REALDATA-500-NOISE-AND-RECOVERY-001 — KIS RealData provider noise compact health.
    //   [PATCH-RUNTIME] 태그로 runtime 모드 sectionMatchesMode 통과.
    //   read-only — listKisRealDataNoiseRecords() 메모리 read 만, LIVE 매매 영향 0.
    //   providerIssue=true / marketSignal=false / executionImpact=NONE literal type 강제.
    try {
      const realDataHealth = formatKisRealDataHealthSection();
      if (realDataHealth) parts.push(realDataHealth);
    } catch (err) {
      emitScanBlockersSectionWarn('[scan_blockers] Patch-KIS-REALDATA-500-NOISE-AND-RECOVERY-001 section failed:', err);
    }

    // Patch-SHADOW-APPROVAL-DEDUP-001 — Shadow approval 중복 발송 통계 (runtime/full 모드 노출).
    //   [PATCH-RUNTIME] 태그로 runtime 모드 sectionMatchesMode 통과. liveOrderPlaced=false 명시.
    try {
      const dedupStats = getShadowApprovalDedupeStats();
      if (
        dedupStats.pending > 0 ||
        dedupStats.approved > 0 ||
        dedupStats.deduped > 0 ||
        dedupStats.duplicateSuppressed > 0 ||
        dedupStats.autoTimerCancelled > 0
      ) {
        parts.push(formatShadowApprovalDedupeSection(dedupStats));
      }
    } catch (err) {
      emitScanBlockersSectionWarn('[scan_blockers] Patch-SHADOW-APPROVAL-DEDUP-001 section failed:', err);
    }

    // Patch-SHADOW-LIFECYCLE-AND-EXECUTION-001 — Shadow execution pipeline summary.
    //   [PATCH-RUNTIME] 태그로 runtime 모드 sectionMatchesMode 통과.
    //   read-only — getShadowExecutionPipelineSummary() 메모리 read 만, LIVE 매매 영향 0.
    //   liveOrderPlaced=false / executionImpact=NONE literal 강제.
    try {
      const executionSection = formatShadowExecutionPipelineSection();
      if (executionSection) parts.push(executionSection);
    } catch (err) {
      emitScanBlockersSectionWarn('[scan_blockers] Patch-SHADOW-LIFECYCLE-AND-EXECUTION-001 section failed:', err);
    }

    // Patch-SHADOW-POSITION-MANAGEMENT-AND-SELL-LIFECYCLE-002 — Shadow position
    // lifecycle (OPENED/MONITOR/SELL_SIGNAL/SELL_PAPER_FILLED/CLOSED) summary.
    //   [PATCH-RUNTIME] 태그로 runtime 모드 sectionMatchesMode 통과.
    //   read-only — getShadowLifecycleSummary() 메모리 read 만, LIVE 매매 영향 0.
    //   liveOrderPlaced=false / executionImpact=NONE literal 강제.
    try {
      const lifecycleSection = formatShadowPositionLifecycleSection();
      if (lifecycleSection) parts.push(lifecycleSection);
    } catch (err) {
      emitScanBlockersSectionWarn('[scan_blockers] Patch-SHADOW-POSITION-MANAGEMENT-AND-SELL-LIFECYCLE-002 section failed:', err);
    }

    // Patch-KIS500-PROVIDER-HEALTH-ISOLATION-003 — KIS RealData circuit breaker state +
    //   Last Good Value cache + Shadow case count. [PATCH-RUNTIME] 태그로 runtime 모드
    //   sectionMatchesMode 통과. read-only — buildProviderHealthIsolationRuntimeSummary()
    //   메모리 read 만, LIVE 매매 영향 0. providerIssue=true / marketSignal=false /
    //   executionImpact='NONE' / telegramAllowed=false literal 강제.
    try {
      const providerHealthSection = formatProviderHealthIsolationSection();
      if (providerHealthSection) parts.push(providerHealthSection);
    } catch (err) {
      emitScanBlockersSectionWarn('[scan_blockers] Patch-KIS500-PROVIDER-HEALTH-ISOLATION-003 section failed:', err);
    }

    // ADR-0506 — ADR-0505 emission: NOT_EMITTED 시 compact line, full 모드에서 detail block.
    if (adr0505CompactLine) parts.push(adr0505CompactLine);
    if (adr0505DetailBlock) parts.push(adr0505DetailBlock);

    // SCAN-BLOCKERS-SUPPLY-FULL-PAGINATION-001 — supply forensic sub-modes.
    // display-only: already materialized ScanSummary fields만 read, provider/KIS/KRX/Naver/Yahoo 호출 0.
    if (mode === 'supply' && supplySubMode !== 'summary') {
      const supplyForensicSections = buildScanBlockersSupplyForensicSections(summary);
      const selectedSections = supplySubMode === 'page'
        ? supplyForensicSections.full
        : supplyForensicSections[supplySubMode];
      const pages = paginateScanBlockersMessage('🔍 [scan_blockers supply full]', selectedSections, 3500);
      if (supplySubMode === 'page') {
        const pageNumber = modeResult.supplyPage ?? 1;
        const page = pages[Math.min(Math.max(pageNumber, 1), pages.length) - 1] ?? pages[0];
        logCommand('single');
        await replyOnce(page.body);
        return;
      }
      if (supplySubMode === 'full') {
        logCommand('paginated', pages.length);
        await replyMany(pages.map((page) => page.body));
        return;
      }
      logCommand('single');
      await replyOnce(
        pages[0]?.body ?? '🔍 [scan_blockers supply full]\nPage 1/1\n━━━━━━━━━━━━━━━━\n진단 섹션 없음',
      );
      return;
    }

    // ADR-0506 — full mode header (운영자 명시 호출 표시).
    // Patch-SUPPLY-DIAG-ACCURACY: 4096 budget 초과 시 paginate (footer='' 로 supply-specific footer 회피).
    // 사용자 보고 — `/scan_blockers full` 출력이 truncate 되어 정밀한 root cause 가 전달 안 됨 → pagination 으로 차단.
    if (mode === 'full') {
      const fullHeader = '🔬 <b>[scan_blockers full mode]</b>';
      const finalFull = [fullHeader, ...parts].join('\n');
      if (finalFull.length <= SCAN_BLOCKERS_LENGTH_BUDGET.full) {
        logCommand('single');
        await replyOnce(finalFull);
        return;
      }
      const pages = paginateScanBlockersMessage(
        '🔬 [scan_blockers full mode]',
        [fullHeader, ...parts],
        3500,
        '',
      );
      logCommand('paginated', pages.length);
      await replyMany(pages.map((page) => page.body));
      return;
    }

    // ADR-0506 — gate/supply/sector/runtime: ADR 마커 기반 section 필터링.
    // baseMessage 는 모든 모드 공통 (운영 컨텍스트).
    const filteredParts = parts.filter((part, idx) => {
      if (idx === 0) return true; // baseMessage 항상 포함
      return sectionMatchesMode(part, mode);
    });
    const modeHeader = `🔍 <b>[scan_blockers ${mode} mode]</b>`;
    const finalMessage = [modeHeader, ...filteredParts].join('\n');
    logCommand('single');
    await replyOnce(applyScanBlockersLengthGuard(finalMessage, mode));
  },
};

commandRegistry.register(scanBlockers);

export default scanBlockers;
