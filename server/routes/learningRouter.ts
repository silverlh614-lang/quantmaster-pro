/**
 * @responsibility 운영자 진단용 학습 이력·상태 GET 엔드포인트와 F2W drift 알림 POST 통로
 */

import { Router, Request, Response } from 'express';
import { getLearningStatus, getLearningHistory } from '../learning/learningHistorySummary.js';
import { handleF2WDriftAlert } from '../alerts/f2wDriftAlert.js';
import {
  KNOWN_REFLECTION_MODULES,
  getAllModuleStatuses,
} from '../learning/reflectionImpactPolicy.js';
import { loadWalkForwardResults } from '../persistence/walkForwardResultsRepo.js';
import {
  isFrameworkDisabled as isWalkForwardDisabled,
  runWalkForwardFramework,
} from '../learning/walkForwardFramework.js';
import { loadShadowWalkForwardResults } from '../persistence/shadowWalkForwardResultsRepo.js';
import {
  isShadowFrameworkDisabled,
  runShadowWalkForward,
} from '../learning/shadowWalkForwardFramework.js';
import { loadCurrentSchemaRecords } from '../persistence/attributionRepo.js';
import {
  getAllConditionLifecycleStatuses,
  summarizeConditionLifecycle,
  isConditionLifecycleDisabled,
} from '../learning/conditionLifecyclePolicy.js';
import { analyzeShadowAttribution } from '../learning/conditionAttributionShadow.js';
import {
  getAllRejectionShadow,
  summarizeRejectionShadow,
} from '../learning/rejectionShadowTracker.js';
import {
  compareTwinsVsReal,
  getAllTwinEntries,
} from '../learning/counterfactualTwinPortfolio.js';
import { getMonthlyStats } from '../learning/recommendationTracker.js';
// ADR-0177 — Phase 4-A Learning Sanity Dashboard endpoint
import { loadShadowLearningOnlySignals } from '../persistence/shadowLearningOnlySignalRepo.js';
import { loadShadowTrades } from '../persistence/shadowTradeRepo.js';
import { computeSafetyGateAttribution } from '../learning/safetyGateAttribution.js';
import { computeShadowVsLiveDelta } from '../learning/shadowVsLiveDelta.js';
// ADR-0179 — Phase 4-B-2-a MissedLearningQueue stats endpoint
import { loadMissedLearningQueue } from '../persistence/missedLearningQueueRepo.js';
// ADR-0180 — Phase 4-B-2-b1 Rejection Shadow stats endpoint
// (summarizeRejectionShadow 는 위 라인 31 에서 이미 import — entries 제외 summary 전용 endpoint)
// ADR-0182 — Phase 4-B-2-b3 Counterfactual unresolved stats endpoint
import { summarizeUnresolvedCounterfactuals } from '../learning/counterfactualShadow.js';
import { shadowCaseLedger } from '../shadow/shadowCaseLedger.js';
import type { ShadowCase } from '../shadow/shadowTypes.js';

const router = Router();

type ShadowCaseLibraryCaseType =
  | 'CASE_SUPPLY_UNSTABLE' | 'CASE_HOLIDAY' | 'CASE_LUNCH_BREAK' | 'CASE_SELL_ONLY'
  | 'CASE_SHADOW_ONLY' | 'CASE_KRX_DELAY' | 'CASE_KIS_500' | 'CASE_DART_DELAY'
  | 'CASE_YAHOO_STALE' | 'CASE_MACRO_RISK_OFF' | 'CASE_STRONG_BUY_BLOCKED'
  | 'CASE_BUYLIST_EMPTY' | 'CASE_WATCHLIST_REFRESHED_BUT_NO_EXECUTION' | 'CASE_DATA_MISSING'
  | 'CASE_PROVIDER_HEALTH_BAD' | 'CASE_MARKET_SIGNAL_NEUTRAL' | 'CASE_PROGRAM_TRADING_EMPTY'
  | 'CASE_SCAN_DIAGNOSTIC_SUPPRESSED' | 'CASE_UNKNOWN';

type ShadowCaseLibraryDataHealth = 'VERIFIED' | 'DEGRADED' | 'STALE' | 'MISSING' | 'AI_ESTIMATED' | 'UNKNOWN';
type ShadowCaseLibraryConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'NOT_APPLICABLE';
type ShadowCaseLibraryOutcome = 'WIN' | 'LOSS' | 'BREAKEVEN' | 'PENDING' | 'INVALIDATED' | 'NOT_TRACKED';
type ShadowCaseLibraryStatus = 'OPEN' | 'OUTCOME_PENDING' | 'RESOLVED' | 'IGNORED' | 'NEEDS_REVIEW';
type ShadowCaseLibraryExecutionImpact = 'NONE' | 'NEW_BUY_BLOCKED_ONLY' | 'SHADOW_ONLY' | 'DEGRADED' | 'BLOCKING';

function hasCaseToken(item: ShadowCase, pattern: RegExp): boolean {
  return [item.blockedReason, item.learningTag, item.regimeTag, item.marketSession, item.dataProvider, ...(item.conditionTags ?? [])]
    .filter(Boolean)
    .some((value) => pattern.test(String(value)));
}

function deriveLibraryCaseType(item: ShadowCase): ShadowCaseLibraryCaseType {
  if (item.engineMode === 'SELL_ONLY' || item.sellOnlyActive) return 'CASE_SELL_ONLY';
  if (item.engineMode === 'SHADOW_ONLY') return 'CASE_SHADOW_ONLY';
  if (item.hardBlockActive || hasCaseToken(item, /STRONG_BUY_BLOCKED|BUY_BLOCKED/i)) return 'CASE_STRONG_BUY_BLOCKED';
  if (hasCaseToken(item, /HOLIDAY|NON_TRADING_DAY/i)) return 'CASE_HOLIDAY';
  if (hasCaseToken(item, /LUNCH/i)) return 'CASE_LUNCH_BREAK';
  if (hasCaseToken(item, /KIS.*500|KIS_500|PROVIDER_ERROR/i)) return 'CASE_KIS_500';
  if (hasCaseToken(item, /KRX.*DELAY|KRX_UNAVAILABLE/i)) return 'CASE_KRX_DELAY';
  if (hasCaseToken(item, /DART.*DELAY/i)) return 'CASE_DART_DELAY';
  if (hasCaseToken(item, /YAHOO.*STALE/i)) return 'CASE_YAHOO_STALE';
  if (hasCaseToken(item, /MACRO|RISK_OFF|R5_|R6_/i)) return 'CASE_MACRO_RISK_OFF';
  if (hasCaseToken(item, /BUYLIST_EMPTY/i)) return 'CASE_BUYLIST_EMPTY';
  if (hasCaseToken(item, /WATCHLIST.*NO_EXECUTION/i)) return 'CASE_WATCHLIST_REFRESHED_BUT_NO_EXECUTION';
  if (hasCaseToken(item, /PROGRAM.*EMPTY/i)) return 'CASE_PROGRAM_TRADING_EMPTY';
  if (hasCaseToken(item, /SCAN.*SUPPRESS/i)) return 'CASE_SCAN_DIAGNOSTIC_SUPPRESSED';
  if (item.dataHealth === 'EMPTY' || item.dataHealth === 'UNAVAILABLE') return 'CASE_DATA_MISSING';
  if (item.providerHealth !== 'OK') return 'CASE_PROVIDER_HEALTH_BAD';
  if (hasCaseToken(item, /SUPPLY.*UNSTABLE|FLOW.*UNSTABLE/i)) return 'CASE_SUPPLY_UNSTABLE';
  if (hasCaseToken(item, /NEUTRAL/i)) return 'CASE_MARKET_SIGNAL_NEUTRAL';
  return 'CASE_UNKNOWN';
}

function mapLibraryDataHealth(value: ShadowCase['dataHealth']): ShadowCaseLibraryDataHealth {
  if (value === 'OK') return 'VERIFIED';
  if (value === 'EMPTY' || value === 'UNAVAILABLE' || value === 'CORRUPTED') return 'MISSING';
  if (value === 'STALE') return 'STALE';
  if (value === 'DEGRADED') return 'DEGRADED';
  return 'UNKNOWN';
}

function mapLibraryConfidence(value: ShadowCase['confidenceLevel']): ShadowCaseLibraryConfidence {
  if (value === 'VERIFIED' || value === 'CALCULATED') return 'HIGH';
  if (value === 'FALLBACK') return 'MEDIUM';
  if (value === 'LOW' || value === 'QUARANTINED') return 'LOW';
  if (value === 'AI_ESTIMATE') return 'NOT_APPLICABLE';
  return 'NOT_APPLICABLE';
}

function mapLibraryExecutionImpact(value: ShadowCase['executionImpact']): ShadowCaseLibraryExecutionImpact {
  if (value === 'NONE' || value === 'NEW_BUY_BLOCKED_ONLY') return value;
  if (value === 'LIVE_ORDER_BLOCKED') return 'BLOCKING';
  return 'DEGRADED';
}

function mapLibraryOutcome(item: ShadowCase): ShadowCaseLibraryOutcome {
  const label = item.outcomeLabel ?? item.virtualOutcome10d ?? item.virtualOutcome5d ?? item.virtualOutcome3d ?? item.virtualOutcome1d;
  if (label === 'WIN' || label === 'MISSED_WIN') return 'WIN';
  if (label === 'LOSS') return 'LOSS';
  if (label === 'BREAKEVEN') return 'BREAKEVEN';
  if (label === 'INVALID' || label === 'DATA_CORRUPTED' || label === 'QUARANTINED') return 'INVALIDATED';
  if (label === 'ACTIVE' || item.postOutcome === 'PENDING') return 'PENDING';
  return item.postOutcome ? 'NOT_TRACKED' : 'PENDING';
}

function mapLibraryStatus(item: ShadowCase, outcome: ShadowCaseLibraryOutcome): ShadowCaseLibraryStatus {
  if (item.quarantinedReason) return 'NEEDS_REVIEW';
  if (outcome === 'PENDING') return 'OUTCOME_PENDING';
  if (outcome === 'NOT_TRACKED') return 'OPEN';
  if (outcome === 'INVALIDATED') return 'NEEDS_REVIEW';
  return 'RESOLVED';
}

function isProviderIssue(item: ShadowCase, caseType: ShadowCaseLibraryCaseType): boolean {
  return item.providerHealth !== 'OK' || ['CASE_KIS_500', 'CASE_DART_DELAY', 'CASE_YAHOO_STALE', 'CASE_KRX_DELAY', 'CASE_PROVIDER_HEALTH_BAD'].includes(caseType);
}

function isMarketSignal(item: ShadowCase, caseType: ShadowCaseLibraryCaseType): boolean {
  return ['CASE_MACRO_RISK_OFF', 'CASE_SUPPLY_UNSTABLE', 'CASE_MARKET_SIGNAL_NEUTRAL', 'CASE_STRONG_BUY_BLOCKED'].includes(caseType)
    || Boolean(item.regimeTag || item.effectiveRegime || item.marketSession === 'REGULAR');
}

function toLibraryCase(item: ShadowCase) {
  const caseType = deriveLibraryCaseType(item);
  const postOutcome = mapLibraryOutcome(item);
  return {
    id: item.caseId,
    timestamp: item.detectedAt || item.createdAt,
    symbol: item.symbol,
    symbolName: item.symbolName,
    caseType,
    marketSession: item.marketSession,
    engineMode: item.engineMode,
    blockedReason: item.blockedReason,
    dataProvider: item.dataProvider,
    dataHealth: mapLibraryDataHealth(item.dataHealth),
    confidenceLevel: mapLibraryConfidence(item.confidenceLevel),
    expectedDecision: item.expectedDecision,
    actualDecision: item.actualDecision,
    shadowDecision: item.shadowDecision,
    executionImpact: mapLibraryExecutionImpact(item.executionImpact),
    providerIssue: isProviderIssue(item, caseType),
    marketSignal: isMarketSignal(item, caseType),
    postOutcome,
    learningTag: item.learningTag ?? item.regimeTag,
    status: mapLibraryStatus(item, postOutcome),
    nextAction: item.pendingRetryReason ?? item.quarantinedReason,
  };
}

function toLibraryCounterfactual(item: ShadowCase) {
  return {
    caseId: item.caseId,
    symbol: item.symbol,
    virtualEntryPrice: item.entryPriceVirtual,
    virtualStopLoss: item.stopPriceVirtual,
    virtualTargetPrice: item.targetPriceVirtual,
    currentPrice: item.entryPriceVirtual && item.currentReturnPct !== undefined
      ? item.entryPriceVirtual * (1 + item.currentReturnPct / 100)
      : undefined,
    maxFavorableExcursion: item.mfe,
    maxAdverseExcursion: item.mae,
    returnPct: item.finalReturnPct ?? item.currentReturnPct ?? item.virtualReturnPct10d ?? item.virtualReturnPct5d,
    outcome: mapLibraryOutcome(item),
    holdingDays: item.holdingMinutes !== undefined ? Math.round(item.holdingMinutes / 1440) : undefined,
    lesson: item.learningTag ?? item.blockedReason,
  };
}

router.get('/shadow-cases', (_req: Request, res: Response) => {
  try {
    const cases = shadowCaseLedger.listCases().sort((a, b) => (b.detectedAt || b.createdAt).localeCompare(a.detectedAt || a.createdAt));
    const latest = cases[0];
    res.json({
      status: {
        shadowLearning: cases.every((item) => item.executionImpact === 'NONE'),
        engineMode: latest?.engineMode ?? 'OBSERVE_ONLY',
        executionAllowed: latest?.executionImpact === 'LIVE_ORDER_ALLOWED',
        shadowAllowed: true,
        lastCaseAt: latest?.detectedAt ?? latest?.createdAt,
      },
      items: cases.map(toLibraryCase),
      counterfactualOutcomes: cases.filter((item) => item.entryPriceVirtual !== undefined || item.currentReturnPct !== undefined).map(toLibraryCounterfactual),
    });
  } catch (e) {
    console.error('[learningRouter] /shadow-cases 실패:', e);
    res.status(500).json({ error: 'shadow_cases_failed' });
  }
});


router.get('/status', (_req: Request, res: Response) => {
  try {
    const snapshot = getLearningStatus();
    res.json(snapshot);
  } catch (e) {
    console.error('[learningRouter] /status 실패:', e);
    res.status(500).json({ error: 'learning_status_failed' });
  }
});

router.get('/history', (req: Request, res: Response) => {
  const raw = Number(req.query.days);
  const days = Number.isFinite(raw) && raw >= 1 && raw <= 30 ? Math.floor(raw) : 7;
  try {
    const summary = getLearningHistory(days);
    res.json(summary);
  } catch (e) {
    console.error('[learningRouter] /history 실패:', e);
    res.status(500).json({ error: 'learning_history_failed' });
  }
});

/**
 * ADR-0046 (PR-Y1): 클라이언트 F2W drift 감지 → 서버 텔레그램 알림 통로.
 *
 * 클라이언트는 학습 사이클에서 drift 감지 시 본 endpoint 를 호출.
 * 서버는 dispatchAlert(JOURNAL) + sendPrivateAlert 일괄 발송 (24h dedupe).
 */
router.post('/f2w-drift-alert', async (req: Request, res: Response) => {
  try {
    const result = await handleF2WDriftAlert(req.body);
    res.json(result);
  } catch (e) {
    console.error('[learningRouter] /f2w-drift-alert 실패:', e);
    res.status(500).json({ error: 'f2w_drift_alert_failed' });
  }
});

/**
 * ADR-0047 (PR-Y2): Reflection Module Half-Life 진단 endpoint.
 *
 * 13개 모듈의 status (normal/grace/silent/deprecated) + impactRate + runs/meaningfulRuns
 * + firstSeenAt + ageDays 일괄 반환. 운영자가 어떤 모듈이 silent 임계 근처인지 즉시 파악.
 */
router.get('/reflection-impact', (req: Request, res: Response) => {
  try {
    const rawDays = Number(req.query.days);
    const days = Number.isFinite(rawDays) && rawDays >= 1 && rawDays <= 365
      ? Math.floor(rawDays)
      : 180;
    const reports = getAllModuleStatuses(
      KNOWN_REFLECTION_MODULES.slice(),
      new Date(),
      { windowDays: days },
    );
    res.json({
      windowDays: days,
      modules: reports,
      summary: {
        total: reports.length,
        normal: reports.filter(r => r.status === 'normal').length,
        grace: reports.filter(r => r.status === 'grace').length,
        silent: reports.filter(r => r.status === 'silent').length,
        deprecated: reports.filter(r => r.status === 'deprecated').length,
      },
    });
  } catch (e) {
    console.error('[learningRouter] /reflection-impact 실패:', e);
    res.status(500).json({ error: 'reflection_impact_failed' });
  }
});

/**
 * ADR-0083 — Walk-Forward Framework 영속 결과 read-only 노출.
 *
 * 윈도우 별 IS/OOS WindowMetrics + degradation + summary (avgDegradation /
 * decayTrend / overfitFlagged) 일괄 반환. 운영자가 윈도우별 추세 점검.
 */
router.get('/walk-forward', (_req: Request, res: Response) => {
  try {
    const results = loadWalkForwardResults();
    res.json({
      ...results,
      disabled: isWalkForwardDisabled(),
    });
  } catch (e) {
    console.error('[learningRouter] /walk-forward 실패:', e);
    res.status(500).json({ error: 'walk_forward_load_failed' });
  }
});

/**
 * ADR-0084 — Condition Lifecycle Status 일괄 조회.
 *
 * 27조건의 status (normal/grace/silent/deprecated) + activationRate +
 * activatedCount + firstSeenAt + ageDays + byRegime 일괄 반환.
 * 운영자가 어떤 조건이 silent 임계 근처인지 즉시 파악.
 */
router.get('/condition-lifecycle', (req: Request, res: Response) => {
  try {
    const rawDays = Number(req.query.days);
    const windowDays = Number.isFinite(rawDays) && rawDays >= 1 && rawDays <= 365
      ? Math.floor(rawDays)
      : 180;
    const records = loadCurrentSchemaRecords();
    const reports = getAllConditionLifecycleStatuses(records, { windowDays });
    res.json({
      windowDays,
      disabled: isConditionLifecycleDisabled(),
      conditions: reports,
      summary: summarizeConditionLifecycle(reports),
    });
  } catch (e) {
    console.error('[learningRouter] /condition-lifecycle 실패:', e);
    res.status(500).json({ error: 'condition_lifecycle_failed' });
  }
});

/**
 * ADR-0088 — Rejection Shadow 영속 + 통계 read-only 노출 (UI Dashboard 입력).
 */
router.get('/rejection-shadow', (req: Request, res: Response) => {
  try {
    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit >= 1 && rawLimit <= 500
      ? Math.floor(rawLimit) : 50;
    const allEntries = getAllRejectionShadow();
    const summary = summarizeRejectionShadow();
    // 최신순 정렬 (signalDate 내림차순) + limit 절삭
    const sorted = [...allEntries].sort((a, b) =>
      Date.parse(`${b.signalDate}T00:00:00Z`) - Date.parse(`${a.signalDate}T00:00:00Z`),
    );
    res.json({
      summary,
      entries: sorted.slice(0, limit),
      totalCount: allEntries.length,
    });
  } catch (e) {
    console.error('[learningRouter] /rejection-shadow 실패:', e);
    res.status(500).json({ error: 'rejection_shadow_failed' });
  }
});

/**
 * ADR-0088 — Twin Portfolio 영속 + 비교 결과 read-only 노출 (UI Dashboard 입력).
 */
router.get('/twin-portfolio', (_req: Request, res: Response) => {
  try {
    const monthlyStats = getMonthlyStats();
    const realCumReturnPct = monthlyStats.compoundReturn ?? 0;
    const comparison = compareTwinsVsReal(realCumReturnPct);
    const entries = getAllTwinEntries();
    res.json({
      comparison,
      entries,
      realCumReturnPct,
      totalCount: entries.length,
    });
  } catch (e) {
    console.error('[learningRouter] /twin-portfolio 실패:', e);
    res.status(500).json({ error: 'twin_portfolio_failed' });
  }
});

/**
 * ADR-0087 — Shadow Condition Attribution 분석 결과 read-only 노출.
 *
 * 27조건의 Over-Strict / Good Defense 분류 + summary.
 * 거절 종목 사후 성과 + conditionScores 결합 분석.
 */
router.get('/condition-attribution-shadow', (_req: Request, res: Response) => {
  try {
    const result = analyzeShadowAttribution();
    res.json(result);
  } catch (e) {
    console.error('[learningRouter] /condition-attribution-shadow 실패:', e);
    res.status(500).json({ error: 'condition_attribution_shadow_failed' });
  }
});

/**
 * ADR-0086 — Shadow Walk-Forward Framework 영속 결과 read-only 노출.
 *
 * Rejection (PR-L) + Twin (PR-M) 데이터의 IS/OOS 분할 결과 + summary.
 * windowId='shadow_*' prefix — LIVE walk-forward 결과 (`/walk-forward`) 와 분리.
 */
router.get('/shadow-walk-forward', (_req: Request, res: Response) => {
  try {
    const results = loadShadowWalkForwardResults();
    res.json({
      ...results,
      disabled: isShadowFrameworkDisabled(),
    });
  } catch (e) {
    console.error('[learningRouter] /shadow-walk-forward 실패:', e);
    res.status(500).json({ error: 'shadow_walk_forward_load_failed' });
  }
});

/**
 * ADR-0086 — Shadow Walk-Forward Framework 즉시 1회 실행.
 *
 * source 쿼리 ('REJECTION' | 'TWIN' | 'ALL', default 'ALL').
 */
router.post('/shadow-walk-forward/run', async (req: Request, res: Response) => {
  try {
    const sourceRaw = typeof req.query.source === 'string' ? req.query.source.toUpperCase() : '';
    const source = (sourceRaw === 'REJECTION' || sourceRaw === 'TWIN' || sourceRaw === 'ALL')
      ? sourceRaw as 'REJECTION' | 'TWIN' | 'ALL'
      : 'ALL';
    const result = await runShadowWalkForward({ source });
    res.json(result);
  } catch (e) {
    console.error('[learningRouter] /shadow-walk-forward/run 실패:', e);
    res.status(500).json({ error: 'shadow_walk_forward_run_failed' });
  }
});

/**
 * ADR-0083 — Walk-Forward Framework 즉시 1회 실행 (동기 윈도우 산출).
 *
 * 비동기 cron 외에 운영자가 텔레그램 명령에서 수동 트리거. records 부족 시 skipped.
 */
router.post('/walk-forward/run', async (_req: Request, res: Response) => {
  try {
    const result = await runWalkForwardFramework();
    res.json(result);
  } catch (e) {
    console.error('[learningRouter] /walk-forward/run 실패:', e);
    res.status(500).json({ error: 'walk_forward_run_failed' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// ADR-0177 — Learning Sanity Dashboard HTTP endpoint (Phase 4-A)
// ────────────────────────────────────────────────────────────────────────────

type FutureReturnHorizon = 1 | 3 | 5 | 20;

function parseDashboardQueryParams(
  req: Request,
): { lookbackDays: number; futureReturnHorizon: FutureReturnHorizon } {
  const daysRaw = Number(req.query.days);
  const lookbackDays =
    Number.isFinite(daysRaw) && daysRaw >= 1 && daysRaw <= 365 ? Math.floor(daysRaw) : 90;
  const horizonRaw = Number(req.query.horizon);
  const futureReturnHorizon: FutureReturnHorizon =
    horizonRaw === 1 || horizonRaw === 3 || horizonRaw === 5 || horizonRaw === 20
      ? horizonRaw
      : 5;
  return { lookbackDays, futureReturnHorizon };
}

/**
 * ADR-0177 §2.2 — SafetyGateAttribution endpoint.
 *
 * 7 GateName entry (FOMC / VIX / R0_R1_REGIME / LIQUIDITY / DATA_SANITY /
 * EXPOSURE_BUDGET / ENEMY_CHECKLIST) 의 사후 효과 read-only 노출.
 * ENV `SAFETY_GATE_ATTRIBUTION_ENABLED` OFF 시 응답 빈 배열 [].
 */
router.get('/safety-gate-attribution', (req: Request, res: Response) => {
  try {
    const options = parseDashboardQueryParams(req);
    const signals = loadShadowLearningOnlySignals();
    const results = computeSafetyGateAttribution(signals, options);
    res.json(results);
  } catch (e) {
    console.error('[learningRouter] /safety-gate-attribution 실패:', e);
    res.status(500).json({ error: 'safety_gate_attribution_failed' });
  }
});

/**
 * ADR-0177 §2.2 — ShadowVsLiveDelta endpoint.
 *
 * 5 DeltaCategory entry (SHADOW_BUY_LIVE_BLOCKED / LIVE_BUY_SHADOW_BETTER_SIZE /
 * EXPOSURE_CAP_REDUCED / MACRO_GATE_BLOCKED / LIQUIDITY_GATE_BLOCKED) 의
 * missedAlpha (= shadowReturn - liveReturn) read-only 노출.
 * ENV `SHADOW_LIVE_DELTA_REPORT_ENABLED` OFF 시 응답 빈 배열 [].
 */
router.get('/shadow-vs-live-delta', (req: Request, res: Response) => {
  try {
    const options = parseDashboardQueryParams(req);
    const shadowSignals = loadShadowLearningOnlySignals();
    const liveTrades = loadShadowTrades();
    const results = computeShadowVsLiveDelta({ shadowSignals, liveTrades, options });
    res.json(results);
  } catch (e) {
    console.error('[learningRouter] /shadow-vs-live-delta 실패:', e);
    res.status(500).json({ error: 'shadow_vs_live_delta_failed' });
  }
});

/**
 * ADR-0180 §2.2 — Rejection Shadow stats endpoint (Phase 4-B-2-b1).
 *
 * 기존 `/api/learning/rejection-shadow` 와 분리 — entries 제외, summary 전용.
 * UI 카드 부담 ↓ (entries[] limit 절삭 + 클라 계산 부재).
 */
router.get('/rejection-shadow-stats', (_req: Request, res: Response) => {
  try {
    const summary = summarizeRejectionShadow();
    res.json(summary);
  } catch (e) {
    console.error('[learningRouter] /rejection-shadow-stats 실패:', e);
    res.status(500).json({ error: 'rejection_shadow_stats_failed' });
  }
});

/**
 * ADR-0179 §2.2 — MissedLearningQueue stats endpoint.
 *
 * 4 status (PENDING/REPLAYED/FAILED/DROPPED) 카운트 + total + lastEnqueuedAt.
 * Phase 1 영속 read-only — ENV gate 부재 (빈 큐 시 모든 카운트 0).
 */
router.get('/missed-learning-queue-stats', (_req: Request, res: Response) => {
  try {
    const jobs = loadMissedLearningQueue();
    let pending = 0, replayed = 0, failed = 0, dropped = 0;
    let lastEnqueuedAt: string | undefined;
    for (const job of jobs) {
      switch (job.status) {
        case 'PENDING': pending++; break;
        case 'REPLAYED': replayed++; break;
        case 'FAILED': failed++; break;
        case 'DROPPED': dropped++; break;
      }
      if (!lastEnqueuedAt || job.skippedAt > lastEnqueuedAt) {
        lastEnqueuedAt = job.skippedAt;
      }
    }
    res.json({
      pending, replayed, failed, dropped,
      total: jobs.length,
      lastEnqueuedAt,
    });
  } catch (e) {
    console.error('[learningRouter] /missed-learning-queue-stats 실패:', e);
    res.status(500).json({ error: 'missed_learning_queue_stats_failed' });
  }
});

/**
 * ADR-0182 §2.2 — Counterfactual Unresolved stats endpoint (Phase 4-B-2-b3).
 *
 * `loadCounterfactuals()` 의 *해결 진행도* 진단 — `getCounterfactualStats(horizon)`
 * (분포 분석) 와 분리. 운영자가 cron 미실행 / 가격 fetcher 실패 / 표본 부족
 * 즉시 인지 (Learning Sanity Dashboard 6번째 카드).
 */
router.get('/counterfactual-unresolved-stats', (_req: Request, res: Response) => {
  try {
    const summary = summarizeUnresolvedCounterfactuals();
    res.json(summary);
  } catch (e) {
    console.error('[learningRouter] /counterfactual-unresolved-stats 실패:', e);
    res.status(500).json({ error: 'counterfactual_unresolved_stats_failed' });
  }
});

export default router;
