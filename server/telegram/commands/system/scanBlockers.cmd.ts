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
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import {
  formatScanBlockersMessage,
  formatTechnicalProviderDegradedSection,
  getLastScanSummary,
} from '../../../trading/signalScanner/scanDiagnostics.js';
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
import { formatPhase2RecoveryCompactLine } from '../../../clients/sectorEnergyIndexCodeRecoveryDiagnostic.js';
import { formatSanityDiagnosticCompactLine } from '../../../clients/sectorEnergySanityViolationDiagnostic.js';
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

const scanBlockers: TelegramCommand = {
  name: '/scan_blockers',
  aliases: ['/blockers', '/why_no_buy'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '직전 스캔의 매수 차단 사유 분포 + 거시 게이트 상태 (ADR-0118)',
  usage: '/scan_blockers',
  async execute({ reply }) {
    const summary = getLastScanSummary();
    const baseMessage = formatScanBlockersMessage(summary);

    // ADR-0118 §"진단 추정" 확장 — TECHNICAL_PROVIDER_DEGRADED 운영자 노출 (ADR-0411).
    // try/catch 격리 — watchlist 영속 throw 가 진단 메시지 자체 차단 안 함.
    let degradedSection: string | null = null;
    try {
      const watchlist = loadWatchlist();
      degradedSection = formatTechnicalProviderDegradedSection(watchlist);
    } catch (err) {
      console.warn(
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
      console.warn(
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
      console.warn(
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
      console.warn(
        '[scan_blockers] counterfactual universe learning 섹션 빌드 실패 (진단 메시지는 baseMessage 만 출력):',
        err,
      );
    }

    // ADR-0435 — investor-flow provider health read-only summary.
    // Uses the last observed router health only; /scan_blockers must not trigger
    // KRX/NAVER/KIS provider fetches.
    let supplyProviderSection: string | null = null;
    try {
      supplyProviderSection = summarizeInvestorFlowProviderHealth(getLastInvestorFlowProviderHealth());
    } catch (err) {
      console.warn(
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
      console.warn(
        '[scan_blockers] kis-ws subscription 섹션 빌드 실패 (진단 메시지는 baseMessage 만 출력):',
        err,
      );
    }

    // ADR-0446 — Phase 2 recovery + sanity violation compact lines.
    // read-only — macroState.sectorEnergyQualityDiagnostic 만 read.
    // try/catch 격리 — 진단 throw 가 base 메시지 차단 안 함.
    let phase2Line: string | null = null;
    let sanityLine: string | null = null;
    try {
      const macro = loadMacroState();
      const qDiag = macro?.sectorEnergyQualityDiagnostic;
      if (qDiag?.sectorIndexRecovery) {
        // sectorIndexRecovery 영속 데이터 (cast 안전 — schema 옵셔널 후방호환)
        phase2Line = formatPhase2RecoveryCompactLine(
          qDiag.sectorIndexRecovery as Parameters<typeof formatPhase2RecoveryCompactLine>[0],
        );
      }
      if (qDiag?.sanityViolation) {
        sanityLine = formatSanityDiagnosticCompactLine(
          qDiag.sanityViolation as Parameters<typeof formatSanityDiagnosticCompactLine>[0],
        );
      }
    } catch (err) {
      console.warn(
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
      console.warn(
        '[scan_blockers] ADR-0448 SectorEnergy execution impact line 빌드 실패 (진단 메시지는 baseMessage 만 출력):',
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
      console.warn(
        '[scan_blockers] ADR-0451 emptyScan liveness section 빌드 실패 (진단 메시지는 baseMessage 만 출력):',
        err,
      );
    }

    const parts: string[] = [baseMessage];
    if (degradedSection) parts.push(degradedSection);
    if (supplyProviderSection) parts.push(supplyProviderSection);
    if (counterfactualLine) parts.push(counterfactualLine);
    if (promotionLine) parts.push(promotionLine);
    if (universeSection) parts.push(universeSection);
    if (kisWsSubscriptionSection) parts.push(kisWsSubscriptionSection);
    if (phase2Line) parts.push(`🧩 SectorEnergy indexCode Recovery Phase 2: ${phase2Line}`);
    if (sanityLine) parts.push(`🧪 ${sanityLine}`);
    if (executionImpactLine) parts.push(executionImpactLine);
    if (livenessSection) parts.push(livenessSection);
    const finalMessage = parts.join('\n');
    await reply(finalMessage);
  },
};

commandRegistry.register(scanBlockers);

export default scanBlockers;
