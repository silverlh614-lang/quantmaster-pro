// @responsibility Adapt internal UI/store snapshots into public report cards.

import type { MarketContext, MarketOverview, StockRecommendation } from '../services/stockService';
import type { ShadowTrade } from '../types/quant';
import type { SectorEnergyResult, SectorEnergyScore } from '../types/sectorEnergy';
import {
  buildCandidateDecisionCardModel,
  buildCandidateDecisionSummary,
  buildCandidateDataConfidence,
  publicDecisionLabel as candidatePublicDecisionLabel,
} from '../candidate-decision/candidateDecisionModel';
import type {
  BuyBlockReasonCard,
  CandidateDecisionSummary,
  DailyMarketGateCard,
  DataConfidence,
  DataConfidenceSummary,
  PublicReportSnapshot,
  PublicReportSnapshotListItem,
  PublicReportModel,
  ReportVisibility,
  SectorAlignment,
  SectorRotationCard,
  SectorRotationItem,
  ShadowPerformanceCard,
  StockDecisionCard,
} from './reportTypes';

export interface PublicReportAdapterInput {
  marketOverview?: MarketOverview | null;
  marketContext?: MarketContext | null;
  recommendations?: StockRecommendation[];
  sectorEnergyResult?: SectorEnergyResult | null;
  shadowTrades?: ShadowTrade[];
  visibility?: ReportVisibility;
  now?: Date;
  engineMode?: DailyMarketGateCard['engineMode'];
  marketSessionState?: string;
}

const INVESTMENT_NOTICE =
  '본 콘텐츠는 투자판단 참고용 데이터 리포트이며, 개별 투자자의 매수·매도 지시가 아닙니다. 모든 투자의 최종 판단과 책임은 투자자 본인에게 있습니다.';

const SNAPSHOT_STORAGE_KEY = 'quantmaster-public-report-snapshots';

const DEFAULT_CONFIDENCE_SUMMARY: DataConfidenceSummary = {
  overall: 'MISSING',
  calculatedIndicatorCount: 0,
  aiEstimatedIndicatorCount: 0,
  missingIndicatorCount: 1,
  providerIssue: false,
  marketSignal: false,
  notes: ['Candidate decision data is missing; public report stays conservative.'],
};

const CONFIDENCE_SEVERITY: Record<DataConfidenceSummary['overall'], number> = {
  VERIFIED: 0,
  DEGRADED: 1,
  UNKNOWN: 2,
  AI_ESTIMATED: 3,
  STALE: 4,
  MISSING: 5,
};

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0));
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function reportDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function createReportId(now: Date): string {
  return `public_report_${now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function getObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

function extractSourceSnapshotId(input: PublicReportAdapterInput, now: Date): string {
  const candidates: unknown[] = [
    input.marketOverview,
    input.marketContext,
    input.sectorEnergyResult,
    ...(input.recommendations ?? []),
  ];

  for (const candidate of candidates) {
    const object = getObject(candidate);
    const direct = getString(object?.sourceSnapshotId) ?? getString(object?.snapshotId);
    if (direct) return direct;

    const sourceSnapshot = getObject(object?.sourceSnapshot);
    const nested = getString(sourceSnapshot?.id) ?? getString(sourceSnapshot?.sourceSnapshotId);
    if (nested) return nested;
  }

  return `public-report-${reportDate(now)}`;
}

function extractAsOf(input: PublicReportAdapterInput, now: Date): string {
  const candidates: unknown[] = [
    input.marketOverview,
    input.marketContext,
    input.sectorEnergyResult,
    ...(input.recommendations ?? []),
  ];

  for (const candidate of candidates) {
    const object = getObject(candidate);
    const timestamp = getString(object?.asOf)
      ?? getString(object?.updatedAt)
      ?? getString(object?.generatedAt)
      ?? getString(object?.calculatedAt)
      ?? getString(object?.priceUpdatedAt);
    if (timestamp) return timestamp;
  }

  return now.toISOString();
}

export const publicDecisionLabel = candidatePublicDecisionLabel;

function statusToScore(status?: string): number {
  const normalized = (status ?? '').toUpperCase();
  if (normalized.includes('BULL')) return 80;
  if (normalized.includes('BEAR')) return 35;
  return 60;
}

function scoreToGateStatus(score: number): DailyMarketGateCard['marketGateStatus'] {
  if (score >= 75) return 'GREEN';
  if (score >= 58) return 'YELLOW';
  if (score >= 42) return 'ORANGE';
  return 'RED';
}

function sectorGateStatus(score: number): SectorRotationItem['sectorGateStatus'] {
  if (score >= 75) return 'GREEN';
  if (score >= 55) return 'YELLOW';
  if (score >= 40) return 'ORANGE';
  return 'RED';
}

function sectorAlignment(score: number): SectorAlignment {
  if (score >= 80) return 'LEADING_SECTOR';
  if (score >= 65) return 'WATCH_SECTOR';
  if (score >= 50) return 'NEUTRAL_SECTOR';
  if (score >= 35) return 'WEAK_SECTOR';
  return 'AVOID_SECTOR';
}

function sectorDataConfidence(score: SectorEnergyScore): DataConfidence {
  if (score.sourceTier === 'MISSING' || score.sourceTier === 'FAILED') return 'MISSING';
  if (score.sourceTier && !['KIS_OFFICIAL_INDEX', 'KIS_OFFICIAL_DAILY', 'KRX_OFFICIAL_INDEX'].includes(score.sourceTier)) return 'DEGRADED';
  return 'VERIFIED';
}

function mapConfidenceFromRecommendation(stock?: StockRecommendation): DataConfidenceSummary {
  if (stock) return buildCandidateDataConfidence(stock);
  return {
    overall: 'MISSING',
    calculatedIndicatorCount: 0,
    aiEstimatedIndicatorCount: 0,
    missingIndicatorCount: 1,
    providerIssue: false,
    marketSignal: false,
    notes: ['Candidate decision data is missing; public report stays conservative.'],
  };
}
function combineConfidenceSummaries(summaries: DataConfidenceSummary[]): DataConfidenceSummary {
  if (summaries.length === 0) return DEFAULT_CONFIDENCE_SUMMARY;

  const overall = summaries.reduce<DataConfidenceSummary['overall']>((current, summary) => (
    CONFIDENCE_SEVERITY[summary.overall] > CONFIDENCE_SEVERITY[current] ? summary.overall : current
  ), 'VERIFIED');

  return {
    overall,
    calculatedIndicatorCount: summaries.reduce((sum, item) => sum + item.calculatedIndicatorCount, 0),
    aiEstimatedIndicatorCount: summaries.reduce((sum, item) => sum + item.aiEstimatedIndicatorCount, 0),
    missingIndicatorCount: summaries.reduce((sum, item) => sum + item.missingIndicatorCount, 0),
    providerIssue: summaries.some((item) => item.providerIssue),
    marketSignal: false,
    notes: [...new Set(summaries.flatMap((item) => item.notes))],
  };
}

function buildDailyMarketGateCard(
  input: PublicReportAdapterInput,
  now: Date,
  sourceSnapshotId: string,
  asOf: string,
): DailyMarketGateCard {
  const kospiScore = statusToScore(input.marketContext?.kospi.status);
  const kosdaqScore = statusToScore(input.marketContext?.kosdaq.status);
  const iriScore = typeof input.marketContext?.iri === 'number' ? clamp(input.marketContext.iri) : 60;
  const macroHealthScore = Math.round((kospiScore + kosdaqScore + iriScore) / 3);
  const marketGateStatus = scoreToGateStatus(macroHealthScore);
  const engineMode = input.engineMode ?? (marketGateStatus === 'RED' ? 'SELL_ONLY' : 'NORMAL');
  const newBuyAllowed = engineMode === 'NORMAL' && (marketGateStatus === 'GREEN' || marketGateStatus === 'YELLOW');
  const dataConfidenceSummary = combineConfidenceSummaries((input.recommendations ?? []).map(mapConfidenceFromRecommendation));
  const providerIssue = dataConfidenceSummary.providerIssue;
  const liveExecutionAllowed = newBuyAllowed && !providerIssue;
  const executionImpact: DailyMarketGateCard['executionImpact'] = liveExecutionAllowed
    ? 'LIVE_EXECUTION_ALLOWED'
    : engineMode === 'NORMAL' || engineMode === 'DEGRADED'
      ? 'NEW_BUY_BLOCKED_ONLY'
      : 'LIVE_EXECUTION_BLOCKED';

  const leading = input.sectorEnergyResult?.leadingSectors?.map((sector) => sector.name).slice(0, 3)
    ?? input.marketOverview?.sectorRotation?.topSectors?.map((sector) => sector.name).slice(0, 3)
    ?? [];
  const weak = input.sectorEnergyResult?.laggingSectors?.map((sector) => sector.name).slice(0, 3) ?? [];

  return {
    reportDate: reportDate(now),
    sourceSnapshotId,
    asOf,
    marketSessionState: input.marketSessionState ?? 'UNKNOWN',
    engineMode,
    marketGateStatus,
    macroHealthScore,
    newBuyAllowed,
    liveExecutionAllowed,
    sellOnlyAllowed: engineMode === 'SELL_ONLY' || engineMode === 'NORMAL' || engineMode === 'DEGRADED',
    shadowLearningAllowed: true,
    primaryReason: newBuyAllowed
      ? 'Market Gate allows candidate review.'
      : 'New buys are limited; observation and risk management come first.',
    riskSummary: marketGateStatus === 'RED'
      ? 'Macro conditions are weak. New entries remain blocked while position management continues.'
      : marketGateStatus === 'ORANGE'
        ? 'New entries require strict filtering and pullback confirmation.'
        : 'Condition-first candidate review is preferred over chasing.',
    leadingSectorsTop3: leading,
    weakSectorsTop3: weak,
    providerIssue,
    marketSignal: marketGateStatus === 'RED',
    executionImpact,
    dataConfidenceSummary,
    tomorrowWatchPoints: [
      'Check whether leading sector flow remains intact.',
      'Recheck Gate 3 timing and LastTrigger recovery.',
      'Confirm provider health and data freshness.',
    ],
  };
}
function sectorItem(score: SectorEnergyScore, index: number): SectorRotationItem {
  const flowDirection: SectorRotationItem['flowDirection'] = score.score >= 60 ? 'INFLOW' : score.score <= 40 ? 'OUTFLOW' : 'NEUTRAL';
  const alignment = sectorAlignment(score.score);
  return {
    sectorName: score.name,
    sectorScore: Math.round(score.score),
    relativeStrengthRank: index + 1,
    flowDirection,
    trendChange: score.score >= 60 ? 'UP' : score.score <= 40 ? 'DOWN' : 'FLAT',
    sectorGateStatus: sectorGateStatus(score.score),
    reason: flowDirection === 'INFLOW' ? 'Relative sector energy is strong.' : flowDirection === 'OUTFLOW' ? 'Relative sector energy is weak.' : 'Sector energy is neutral.',
    representativeStocks: [],
    cautionFlags: score.sourceTier && !['KIS_OFFICIAL_INDEX', 'KIS_OFFICIAL_DAILY', 'KRX_OFFICIAL_INDEX'].includes(score.sourceTier)
      ? [`source=${score.sourceTier}`]
      : [],
    dataConfidence: sectorDataConfidence(score),
    alignment,
  };
}

function buildSectorRotationCard(
  input: PublicReportAdapterInput,
  now: Date,
  sourceSnapshotId: string,
  asOf: string,
): SectorRotationCard {
  const sectors = [...(input.sectorEnergyResult?.scores ?? [])]
    .sort((a, b) => b.score - a.score)
    .map(sectorItem);

  return {
    reportDate: reportDate(now),
    sourceSnapshotId,
    asOf,
    sectors,
    topSectors: sectors.slice(0, 5),
    weakSectors: sectors.slice(-5).reverse(),
    summary: input.sectorEnergyResult?.summary ?? 'Sector data is summarized from public-card fields.',
  };
}

function buildStockDecisionCard(
  stock: StockRecommendation | undefined,
  marketGate: DailyMarketGateCard,
  sourceSnapshotId: string,
  asOf: string,
  sectorRotation?: SectorRotationCard,
): StockDecisionCard | undefined {
  if (!stock) return undefined;
  return buildCandidateDecisionCardModel(stock, {
    sourceSnapshotId,
    asOf,
    engineMode: marketGate.engineMode,
    marketGateStatus: marketGate.marketGateStatus,
    sectorRotation,
  });
}
function buildBuyBlockReasonCard(stockDecision: StockDecisionCard | undefined): BuyBlockReasonCard | undefined {
  if (!stockDecision || stockDecision.blockedReasons.length === 0) return undefined;
  const failedGate = stockDecision.blockedReasons.some((reason) => reason.includes('Gate 0'))
    ? 'GATE_0_MACRO'
    : stockDecision.blockedReasons.some((reason) => reason.includes('Gate 1'))
      ? 'GATE_1_SURVIVAL'
      : stockDecision.blockedReasons.some((reason) => reason.includes('Gate 2'))
        ? 'GATE_2_GROWTH'
        : stockDecision.blockedReasons.some((reason) => reason.includes('Gate 3'))
          ? 'GATE_3_TIMING'
          : 'DATA_CONFIDENCE';
  const executionImpact: BuyBlockReasonCard['executionImpact'] = stockDecision.executionImpact === 'LIVE_EXECUTION_BLOCKED'
    ? 'LIVE_EXECUTION_BLOCKED'
    : stockDecision.executionImpact === 'NEW_BUY_BLOCKED_ONLY'
      ? 'NEW_BUY_BLOCKED_ONLY'
      : 'NONE';

  return {
    stockName: stockDecision.stockName,
    blockLevel: failedGate === 'GATE_1_SURVIVAL' || failedGate === 'GATE_0_MACRO'
      ? 'HARD_BLOCK'
      : failedGate === 'DATA_CONFIDENCE'
        ? 'DATA_INSUFFICIENT'
        : 'TEMPORARY_WAIT',
    failedGate,
    blockedReasons: stockDecision.blockedReasons.slice(0, 5),
    riskFlags: stockDecision.riskDrivers.slice(0, 5),
    dataIssues: stockDecision.dataConfidenceSummary.notes,
    requiredConditionsForReentry: [
      'Blocked gate must recover.',
      'Data confidence must be verified or degraded without core missing inputs.',
      'Gate 3 timing and LastTrigger must be rechecked.',
    ],
    shadowOnlyAllowed: stockDecision.shadowTrackingStatus !== 'OFF',
    postOutcomeTrackingEnabled: true,
    executionImpact,
  };
}
function buildShadowPerformanceCard(shadowTrades: ShadowTrade[] = []): ShadowPerformanceCard {
  const targetHitCount = shadowTrades.filter((trade) => trade.status === 'HIT_TARGET').length;
  const stopLossHitCount = shadowTrades.filter((trade) => trade.status === 'HIT_STOP').length;
  const pendingCount = shadowTrades.filter((trade) => trade.status === 'PENDING').length;
  const openShadowPositions = shadowTrades.filter((trade) => trade.status === 'ACTIVE').length;
  const closed = targetHitCount + stopLossHitCount;
  const winRate = closed > 0 ? round((targetHitCount / closed) * 100, 1) : 0;
  const gains = shadowTrades.filter((trade) => (trade.returnPct ?? 0) > 0).reduce((sum, trade) => sum + (trade.returnPct ?? 0), 0);
  const losses = Math.abs(shadowTrades.filter((trade) => (trade.returnPct ?? 0) < 0).reduce((sum, trade) => sum + (trade.returnPct ?? 0), 0));

  return {
    period: 'Recent Shadow Records',
    totalShadowCandidates: shadowTrades.length,
    openShadowPositions,
    targetHitCount,
    stopLossHitCount,
    breakEvenCount: shadowTrades.filter((trade) => Math.abs(trade.returnPct ?? 999) <= 0.2).length,
    pendingCount,
    winRate,
    profitFactor: losses > 0 ? round(gains / losses, 2) : gains > 0 ? round(gains, 2) : 0,
    maxDrawdown: round(Math.min(0, ...shadowTrades.map((trade) => trade.returnPct ?? 0)), 1),
    averageHoldingDays: 0,
    sampleSizeSufficiency: shadowTrades.length >= 100 ? 'ENOUGH_FOR_REVIEW' : shadowTrades.length >= 30 ? 'WATCHING' : 'INSUFFICIENT',
    liveTransitionStatus: shadowTrades.length >= 100 && winRate >= 55 ? 'PARTIAL_READY' : 'NOT_READY',
    improvementNotes: [
      'Shadow performance is displayed separately from live execution.',
      'Live transition remains on hold until sample size is sufficient.',
    ],
  };
}

function newBuyStatusText(marketGate?: DailyMarketGateCard): string {
  if (!marketGate) return 'BLOCKED';
  if (marketGate.newBuyAllowed) return 'ALLOWED';
  if (marketGate.engineMode === 'SELL_ONLY' || marketGate.engineMode === 'SHADOW_ONLY' || marketGate.engineMode === 'OBSERVE_ONLY') return 'BLOCKED';
  return 'LIMITED';
}

function buildPublicSummary(marketGate: DailyMarketGateCard, stockDecision?: StockDecisionCard): string {
  const stockLine = stockDecision ? `${stockDecision.stockName}: ${stockDecision.displayDecision}` : 'No system candidate';
  const buyText = marketGate.newBuyAllowed ? 'allowed' : 'limited';
  return `Market Gate ${marketGate.marketGateStatus}, new buy ${buyText}, ${stockLine}.`;
}

function buildBlogTitle(model: Pick<PublicReportModel, 'reportDate' | 'marketGate' | 'sectorRotation' | 'stockDecision'>): string {
  const date = model.reportDate.replace(/-/g, '.');
  const market = model.marketGate;
  const stock = model.stockDecision;
  const topSectors = model.sectorRotation?.topSectors.slice(0, 3).map((item) => item.sectorName).filter(Boolean) ?? [];

  if (market?.marketGateStatus === 'RED' || market?.engineMode === 'SELL_ONLY' || market?.engineMode === 'OBSERVE_ONLY') {
    return `${date} 시장 Gate: 왜 신규 매수가 차단됐나 - QuantMaster 리포트`;
  }

  if (stock?.finalDecision === 'BLOCKED' || stock?.finalDecision === 'WAIT_PULLBACK' || stock?.finalDecision === 'DATA_INSUFFICIENT') {
    return `${date} 좋은 후보도 바로 사지 않는 이유 - Gate 판정 리포트`;
  }

  if (topSectors.length > 0) {
    return `${date} 오늘의 주도 섹터: ${topSectors.join('·')} - QuantMaster 리포트`;
  }

  return `${date} 오늘 시장은 매수 가능한 장인가? - QuantMaster Gate 리포트`;
}

function buildOneLineConclusion(market?: DailyMarketGateCard, stock?: StockDecisionCard): string {
  if (!market) return '시장 Gate 데이터가 부족해 공개 리포트는 관찰 모드로 유지합니다.';
  const newBuyText = newBuyStatusText(market);
  const shadowText = market.shadowLearningAllowed ? 'Shadow 추적은 유지합니다' : 'Shadow 추적 상태 확인이 필요합니다';
  const stockText = stock ? `${stock.stockName}은 ${stock.displayDecision} 상태입니다` : '대표 후보는 추가 검증이 필요합니다';
  return `시장 Gate는 ${market.marketGateStatus}, 신규 매수는 ${newBuyText}이며 ${shadowText}. ${stockText}.`;
}

function listLines(items: string[] | undefined, fallback: string, limit = 3): string[] {
  const values = (items ?? []).filter(Boolean).slice(0, limit);
  if (values.length === 0) return [`- ${fallback}`];
  return values.map((item) => `- ${item}`);
}

type PublicReportContentBase = Omit<
  PublicReportModel,
  'blogMarkdown' | 'blogHtml' | 'blogTags' | 'markdownOutput' | 'telegramSummary' | 'telegramOutput' | 'publicSummary'
>;

function buildBlogMarkdown(model: PublicReportContentBase): string {
  const market = model.marketGate;
  const sector = model.sectorRotation;
  const stock = model.stockDecision;
  const buyBlock = model.buyBlock;
  const shadow = model.shadowPerformance;
  const topSectors = sector?.topSectors.slice(0, 3) ?? [];
  const weakSectors = sector?.weakSectors.slice(0, 3) ?? [];

  return [
    `# ${model.blogTitle}`,
    '',
    '## 1. 오늘의 한 줄 결론',
    model.oneLineSummary,
    '',
    '## 2. 시장 Gate',
    `- 시장 상태: ${market?.marketGateStatus ?? 'GRAY'}`,
    `- 실행 모드: ${market?.engineMode ?? 'UNKNOWN'}`,
    `- 신규 매수: ${newBuyStatusText(market)}`,
    `- 보유 관리: ${market?.sellOnlyAllowed ? '가능' : '제한'}`,
    `- Shadow Learning: ${market?.shadowLearningAllowed ? 'ON' : 'OFF'}`,
    `- Macro Health Score: ${market?.macroHealthScore ?? 0}/100`,
    `- 핵심 이유: ${market?.primaryReason ?? 'N/A'}`,
    `- Provider Issue: ${market?.providerIssue ? '있음' : '없음'}`,
    `- Market Signal: ${market?.marketSignal ? '위험 신호' : '중립'}`,
    `- Execution Impact: ${market?.executionImpact ?? 'NONE'}`,
    '',
    '## 3. 섹터 로테이션',
    '',
    '오늘의 주도 섹터:',
    '',
    ...(topSectors.length > 0
      ? topSectors.map((item, index) => `${index + 1}. ${item.sectorName} - ${item.sectorScore}점 / ${item.flowDirection}`)
      : ['1. 데이터 확인 필요']),
    '',
    '위험 섹터:',
    '',
    ...(weakSectors.length > 0 ? weakSectors.map((item) => `- ${item.sectorName}`) : ['- 없음']),
    '',
    '해석:',
    '현재 후보 종목은 주도 섹터와 정렬될수록 우선순위가 높습니다. 약세 섹터 후보는 실거래보다 관찰 또는 Shadow 추적을 우선합니다.',
    '',
    '## 4. 오늘의 후보 요약',
    '',
    `- 강한 후보: ${model.candidateSummary.confirmedCandidateCount}개`,
    `- 진입 가능 후보: ${model.candidateSummary.buyCandidateCount}개`,
    `- 관찰 후보: ${model.candidateSummary.watchCount}개`,
    `- 눌림목 대기: ${model.candidateSummary.waitPullbackCount}개`,
    `- 매수 차단: ${model.candidateSummary.blockedCount}개`,
    `- Shadow 추적: ${model.candidateSummary.shadowTrackingCount}개`,
    '',
    '## 5. 대표 후보 판정',
    '',
    `### ${stock ? `${stock.stockName} (${stock.stockCode})` : '대표 후보 없음'}`,
    '',
    `- 섹터: ${stock?.sector ?? 'N/A'}`,
    `- 최종 판정: ${stock?.displayDecision ?? 'DATA_INSUFFICIENT'}`,
    `- 데이터 신뢰도: VERIFIED ${stock?.calculatedIndicatorCount ?? 0} / AI_ESTIMATED ${stock?.aiEstimatedIndicatorCount ?? 0} / MISSING ${stock?.missingIndicatorCount ?? 0}`,
    `- Gate 0 시장환경: ${stock?.gate0MacroStatus ?? 'N/A'}`,
    `- Gate 1 생존필터: ${stock?.gate1SurvivalResult ?? 'N/A'}`,
    `- Gate 2 성장검증: ${stock?.gate2GrowthResult ?? 'N/A'}`,
    `- Gate 3 타이밍: ${stock?.gate3TimingResult ?? 'N/A'}`,
    `- 섹터 정렬: ${stock?.sectorAlignment.sectorName ?? 'N/A'} / ${stock?.sectorAlignment.sectorAlignment ?? 'N/A'} / ${stock?.sectorAlignment.sectorScore ?? 0}점`,
    '',
    '긍정 사유:',
    ...listLines(stock?.positiveDrivers, '긍정 사유는 추가 검증이 필요합니다.'),
    '',
    '위험 사유:',
    ...listLines(stock?.riskDrivers, '주요 위험 사유는 아직 확인되지 않았습니다.'),
    '',
    '## 6. 매수 차단 또는 대기 사유',
    '',
    ...(buyBlock?.blockedReasons.slice(0, 5).map((reason) => `- ${reason}`) ?? ['- 공개용 주요 차단 사유 없음']),
    '',
    '시스템 판단:',
    buyBlock
      ? '좋은 종목일 수 있으나 현재는 좋은 매수 자리가 아닙니다. 차단 사유가 해소될 때까지 Shadow 추적과 재검증을 우선합니다.'
      : '핵심 차단 사유는 없지만 공개 리포트에서는 가격 계획을 노출하지 않습니다.',
    '',
    '## 7. Shadow 추적 결과',
    '',
    `- 이번 주 Shadow 후보: ${shadow?.totalShadowCandidates ?? 0}개`,
    `- 진행 중: ${shadow?.openShadowPositions ?? 0}개`,
    `- 목표 도달: ${shadow?.targetHitCount ?? 0}개`,
    `- 손절 도달: ${shadow?.stopLossHitCount ?? 0}개`,
    `- 본절 종료: ${shadow?.breakEvenCount ?? 0}개`,
    `- 승률: ${shadow?.winRate ?? 0}%`,
    `- Profit Factor: ${shadow?.profitFactor ?? 0}`,
    `- MDD: ${shadow?.maxDrawdown ?? 0}%`,
    '',
    '해석:',
    shadow?.sampleSizeSufficiency === 'ENOUGH_FOR_TRANSITION'
      ? 'Shadow 표본이 충분해지고 있으나 실거래 전환은 별도 정책 검토가 필요합니다.'
      : 'Shadow 표본은 축적 중이며 실거래 전환은 아직 보류합니다.',
    '',
    '## 8. 내일 확인할 조건',
    '',
    ...((stock?.nextCheckConditions.length ? stock.nextCheckConditions : market?.tomorrowWatchPoints)?.slice(0, 5).map((point) => `- ${point}`) ?? ['- Recheck data freshness']),
    '',
    '## 투자 유의',
    '',
    INVESTMENT_NOTICE,
  ].join('\n');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function paragraphHtml(lines: string[]): string {
  return lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('\n');
}

function listHtml(items: string[]): string {
  return `<ul>\n${items.map((item) => `  <li>${escapeHtml(item.replace(/^-\s*/, ''))}</li>`).join('\n')}\n</ul>`;
}

function buildBlogHtml(model: Pick<PublicReportModel, 'blogTitle' | 'oneLineSummary' | 'marketGate' | 'sectorRotation' | 'candidateSummary' | 'stockDecision' | 'buyBlock' | 'shadowPerformance'>): string {
  const market = model.marketGate;
  const sector = model.sectorRotation;
  const stock = model.stockDecision;
  const buyBlock = model.buyBlock;
  const shadow = model.shadowPerformance;
  const topSectors = sector?.topSectors.slice(0, 3).map((item, index) => `${index + 1}. ${item.sectorName} - ${item.sectorScore}점 / ${item.flowDirection}`) ?? ['데이터 확인 필요'];
  const weakSectors = sector?.weakSectors.slice(0, 3).map((item) => item.sectorName) ?? ['없음'];

  return [
    `<h1>${escapeHtml(model.blogTitle)}</h1>`,
    '<h2>1. 오늘의 한 줄 결론</h2>',
    paragraphHtml([model.oneLineSummary]),
    '<h2>2. 시장 Gate</h2>',
    listHtml([
      `시장 상태: ${market?.marketGateStatus ?? 'GRAY'}`,
      `실행 모드: ${market?.engineMode ?? 'UNKNOWN'}`,
      `신규 매수: ${newBuyStatusText(market)}`,
      `Shadow Learning: ${market?.shadowLearningAllowed ? 'ON' : 'OFF'}`,
      `Macro Health Score: ${market?.macroHealthScore ?? 0}/100`,
      `Provider Issue: ${market?.providerIssue ? '있음' : '없음'}`,
      `Market Signal: ${market?.marketSignal ? '위험 신호' : '중립'}`,
    ]),
    '<h2>3. 섹터 로테이션</h2>',
    '<h3>오늘의 주도 섹터</h3>',
    listHtml(topSectors),
    '<h3>위험 섹터</h3>',
    listHtml(weakSectors),
    '<h2>4. 오늘의 후보 요약</h2>',
    listHtml([
      `강한 후보: ${model.candidateSummary.confirmedCandidateCount}개`,
      `진입 가능 후보: ${model.candidateSummary.buyCandidateCount}개`,
      `관찰 후보: ${model.candidateSummary.watchCount}개`,
      `눌림목 대기: ${model.candidateSummary.waitPullbackCount}개`,
      `매수 차단: ${model.candidateSummary.blockedCount}개`,
      `Shadow 추적: ${model.candidateSummary.shadowTrackingCount}개`,
    ]),
    '<h2>5. 대표 후보 판정</h2>',
    `<h3>${escapeHtml(stock ? `${stock.stockName} (${stock.stockCode})` : '대표 후보 없음')}</h3>`,
    listHtml([
      `섹터: ${stock?.sector ?? 'N/A'}`,
      `최종 판정: ${stock?.displayDecision ?? 'DATA_INSUFFICIENT'}`,
      `데이터 신뢰도: VERIFIED ${stock?.calculatedIndicatorCount ?? 0} / AI_ESTIMATED ${stock?.aiEstimatedIndicatorCount ?? 0} / MISSING ${stock?.missingIndicatorCount ?? 0}`,
      `Gate 0: ${stock?.gate0MacroStatus ?? 'N/A'}`,
      `Gate 1: ${stock?.gate1SurvivalResult ?? 'N/A'}`,
      `Gate 2: ${stock?.gate2GrowthResult ?? 'N/A'}`,
      `Gate 3: ${stock?.gate3TimingResult ?? 'N/A'}`,
    ]),
    '<h2>6. 매수 차단 또는 대기 사유</h2>',
    listHtml(buyBlock?.blockedReasons.slice(0, 5) ?? ['공개용 주요 차단 사유 없음']),
    '<h2>7. Shadow 추적 결과</h2>',
    listHtml([
      `이번 주 Shadow 후보: ${shadow?.totalShadowCandidates ?? 0}개`,
      `진행 중: ${shadow?.openShadowPositions ?? 0}개`,
      `목표 도달: ${shadow?.targetHitCount ?? 0}개`,
      `손절 도달: ${shadow?.stopLossHitCount ?? 0}개`,
      `승률: ${shadow?.winRate ?? 0}%`,
      `Profit Factor: ${shadow?.profitFactor ?? 0}`,
      `MDD: ${shadow?.maxDrawdown ?? 0}%`,
    ]),
    '<h2>투자 유의</h2>',
    paragraphHtml([INVESTMENT_NOTICE]),
  ].join('\n');
}

function buildBlogTags(model: Pick<PublicReportModel, 'marketGate' | 'sectorRotation' | 'stockDecision'>): string[] {
  const base = [
    '#QuantMaster',
    '#주식투자',
    '#주도주',
    '#퀀트투자',
    '#시장분석',
    '#섹터로테이션',
    '#수급분석',
    '#ShadowLearning',
    '#매수차단',
    '#투자리포트',
    '#한국증시',
  ];
  const sectorTags = [
    ...(model.sectorRotation?.topSectors.slice(0, 4).map((item) => `#${item.sectorName.replace(/\s+/g, '')}`) ?? []),
    ...(model.stockDecision?.sector ? [`#${model.stockDecision.sector.replace(/\s+/g, '')}`] : []),
  ];
  const marketTags = model.marketGate?.marketGateStatus ? [`#Gate${model.marketGate.marketGateStatus}`] : [];
  return [...new Set([...base, ...sectorTags, ...marketTags])].slice(0, 15);
}

function buildTelegramSummary(
  market: DailyMarketGateCard,
  sector: SectorRotationCard,
  summary: CandidateDecisionSummary,
  publicSummary: string,
): string {
  return [
    '[QuantMaster Daily Gate]',
    `시장 Gate: ${market.marketGateStatus} | MHS: ${market.macroHealthScore}/100`,
    `실행 모드: ${market.engineMode} | 신규 매수: ${newBuyStatusText(market)}`,
    `주도 섹터: ${sector.topSectors.slice(0, 3).map((item) => item.sectorName).join(' / ') || '확인 필요'}`,
    `위험 섹터: ${sector.weakSectors.slice(0, 2).map((item) => item.sectorName).join(' / ') || '없음'}`,
    `후보: WATCH ${summary.watchCount} / WAIT ${summary.waitPullbackCount} / BLOCKED ${summary.blockedCount}`,
    `Shadow: ${market.shadowLearningAllowed ? 'ON' : 'OFF'}`,
    `요약: ${publicSummary}`,
  ].join('\n');
}
function buildPaidPayload(input: PublicReportAdapterInput): Record<string, unknown> {
  return {
    candidates: input.recommendations?.map((stock) => ({
      code: stock.code,
      name: stock.name,
      decision: stock.type,
      gateEvaluation: stock.gateEvaluation,
      entryPrice: stock.entryPrice,
      stopLoss: stock.stopLoss,
      targetPrice: stock.targetPrice,
      tranchePlan: stock.tranchePlan,
    })) ?? [],
    sectorRanking: input.sectorEnergyResult?.scores ?? [],
  };
}

function buildPrivatePayload(input: PublicReportAdapterInput): Record<string, unknown> {
  return {
    generatedFrom: 'CLIENT_STORE_SNAPSHOT',
    privateFieldsExcludedFromPublic: [
      'raw logs',
      'provider responses',
      'execution traces',
      'scheduler internals',
      'entry/stop/target prices',
    ],
    sourceCounts: {
      recommendations: input.recommendations?.length ?? 0,
      sectorRows: input.sectorEnergyResult?.scores?.length ?? 0,
      shadowTrades: input.shadowTrades?.length ?? 0,
    },
  };
}

export function toPublicReport(input: PublicReportAdapterInput): PublicReportModel {
  const now = input.now ?? new Date();
  const sourceSnapshotId = extractSourceSnapshotId(input, now);
  const asOf = extractAsOf(input, now);
  const marketGate = buildDailyMarketGateCard(input, now, sourceSnapshotId, asOf);
  const sectorRotation = buildSectorRotationCard(input, now, sourceSnapshotId, asOf);
  const candidateSummary = buildCandidateDecisionSummary(input.recommendations ?? [], {
    engineMode: marketGate.engineMode,
    marketGateStatus: marketGate.marketGateStatus,
    sectorRotation,
  });
  const stockDecision = buildStockDecisionCard(input.recommendations?.[0], marketGate, sourceSnapshotId, asOf, sectorRotation);
  const buyBlock = buildBuyBlockReasonCard(stockDecision);
  const shadowPerformance = buildShadowPerformanceCard(input.shadowTrades);
  const dataConfidenceSummary = combineConfidenceSummaries((input.recommendations ?? []).map(mapConfidenceFromRecommendation));
  const oneLineSummary = buildOneLineConclusion(marketGate, stockDecision);
  const base = {
    reportId: createReportId(now),
    reportDate: reportDate(now),
    sourceSnapshotId,
    asOf,
    blogTitle: '',
    oneLineSummary,
    reportType: 'DAILY_FULL_REPORT' as const,
    visibility: input.visibility ?? 'PUBLIC',
    marketGate,
    sectorRotation,
    stockDecision,
    buyBlock,
    shadowPerformance,
    candidateSummary,
    dataConfidenceSummary,
    paidPayload: input.visibility === 'PAID' || input.visibility === 'PRIVATE' ? buildPaidPayload(input) : undefined,
    privatePayload: input.visibility === 'PRIVATE' ? buildPrivatePayload(input) : undefined,
    generatedAt: now.toISOString(),
  };
  const titledBase: PublicReportContentBase = {
    ...base,
    blogTitle: buildBlogTitle(base),
  };
  const publicSummary = buildPublicSummary(marketGate, stockDecision);
  const blogMarkdown = buildBlogMarkdown(titledBase);
  const blogHtml = buildBlogHtml(titledBase);
  const blogTags = buildBlogTags(titledBase);
  const telegramSummary = buildTelegramSummary(marketGate, sectorRotation, candidateSummary, publicSummary);

  return {
    ...titledBase,
    blogMarkdown,
    blogHtml,
    blogTags,
    telegramSummary,
    markdownOutput: blogMarkdown,
    telegramOutput: telegramSummary,
    publicSummary,
  };
}

export function createPublicReportSnapshot(report: PublicReportModel): PublicReportSnapshot {
  return {
    reportId: report.reportId,
    reportDate: report.reportDate,
    sourceSnapshotId: report.sourceSnapshotId,
    asOf: report.asOf,
    reportType: report.reportType,
    visibility: report.visibility,
    marketGate: report.marketGate,
    sectorRotation: report.sectorRotation,
    candidateSummary: report.candidateSummary,
    representativeCandidates: report.stockDecision ? [report.stockDecision] : [],
    buyBlockSummary: report.buyBlock,
    shadowPerformance: report.shadowPerformance,
    blogTitle: report.blogTitle,
    blogMarkdown: report.blogMarkdown,
    blogHtml: report.blogHtml,
    blogTags: report.blogTags,
    telegramSummary: report.telegramSummary,
    generatedAt: report.generatedAt,
    generatedBy: 'PUBLIC_REPORT_MODE',
  };
}

function readSnapshotStorage(storage: Pick<Storage, 'getItem'>): PublicReportSnapshot[] {
  try {
    const parsed = JSON.parse(storage.getItem(SNAPSHOT_STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed as PublicReportSnapshot[] : [];
  } catch {
    return [];
  }
}

export function savePublicReportSnapshot(report: PublicReportModel, storage: Pick<Storage, 'getItem' | 'setItem'> = window.localStorage): PublicReportSnapshot {
  const snapshot = createPublicReportSnapshot(report);
  const existing = readSnapshotStorage(storage).filter((item) => item.reportId !== snapshot.reportId);
  storage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify([snapshot, ...existing].slice(0, 20)));
  return snapshot;
}

export function listPublicReportSnapshots(storage: Pick<Storage, 'getItem'> = window.localStorage): PublicReportSnapshot[] {
  return readSnapshotStorage(storage);
}

export function deletePublicReportSnapshot(reportId: string, storage: Pick<Storage, 'getItem' | 'setItem'> = window.localStorage): void {
  const next = readSnapshotStorage(storage).filter((item) => item.reportId !== reportId);
  storage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(next));
}

export function summarizePublicReportSnapshots(snapshots: PublicReportSnapshot[]): PublicReportSnapshotListItem[] {
  return snapshots.map((snapshot) => ({
    reportId: snapshot.reportId,
    reportDate: snapshot.reportDate,
    reportType: snapshot.reportType,
    marketGateStatus: snapshot.marketGate?.marketGateStatus ?? 'UNKNOWN',
    topSectors: snapshot.sectorRotation?.topSectors.slice(0, 3).map((item) => item.sectorName) ?? [],
    candidateCount: snapshot.candidateSummary.totalCandidates,
    blockedCount: snapshot.candidateSummary.blockedCount,
    shadowCount: snapshot.candidateSummary.shadowTrackingCount,
    sourceSnapshotId: snapshot.sourceSnapshotId,
    generatedAt: snapshot.generatedAt,
  }));
}

export { INVESTMENT_NOTICE };
