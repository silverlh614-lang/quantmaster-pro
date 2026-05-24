// @responsibility Adapt internal UI/store snapshots into public report cards.

import type { MarketContext, MarketOverview, StockRecommendation } from '../services/stockService';
import type { ShadowTrade } from '../types/quant';
import type { SectorEnergyResult, SectorEnergyScore } from '../types/sectorEnergy';
import type {
  BuyBlockReasonCard,
  DailyMarketGateCard,
  DataConfidenceSummary,
  PublicDecisionStatus,
  PublicReportModel,
  ReportVisibility,
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
  '본 콘텐츠는 투자판단 참고용 데이터 리포트이며, 매수·매도 지시가 아닙니다. 모든 투자의 최종 판단과 책임은 투자자 본인에게 있습니다.';

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

function mapConfidenceFromRecommendation(stock?: StockRecommendation): DataConfidenceSummary {
  if (!stock) {
    return {
      overall: 'MISSING',
      calculatedIndicatorCount: 0,
      aiEstimatedIndicatorCount: 0,
      missingIndicatorCount: 1,
      providerIssue: false,
      marketSignal: false,
      notes: ['후보 판정 데이터가 없어 공개 리포트를 보수적으로 생성했습니다.'],
    };
  }

  const tiers = Object.values(stock.conditionSourceTiers ?? {});
  const aiEstimatedIndicatorCount = tiers.filter((tier) => tier === 'AI_INFERRED').length
    + (stock.dataSourceType === 'AI' ? 1 : 0);
  const calculatedIndicatorCount = Math.max(
    0,
    tiers.filter((tier) => tier === 'COMPUTED' || tier === 'API').length
      || Object.values(stock.checklist ?? {}).filter((value) => typeof value === 'number' && value > 0).length,
  );
  const missingIndicatorCount = [
    stock.currentPrice,
    stock.targetPrice,
    stock.stopLoss,
    stock.gateEvaluation?.finalScore,
  ].filter((value) => typeof value !== 'number' || !Number.isFinite(value)).length;
  const providerIssue = stock.dataSourceType === 'STALE';
  const overall: DataConfidenceSummary['overall'] = providerIssue
    ? 'STALE'
    : missingIndicatorCount > 0
      ? 'MISSING'
      : aiEstimatedIndicatorCount > calculatedIndicatorCount / 2
        ? 'AI_ESTIMATED'
        : 'VERIFIED';

  return {
    overall,
    calculatedIndicatorCount,
    aiEstimatedIndicatorCount,
    missingIndicatorCount,
    providerIssue,
    marketSignal: false,
    notes: [
      aiEstimatedIndicatorCount > 0 ? 'AI 추정 지표는 공개 리포트에서 추정으로 분리됩니다.' : '',
      providerIssue ? 'Provider 상태 저하가 시장 악재로 변환되지는 않습니다.' : '',
      missingIndicatorCount > 0 ? '일부 핵심 지표가 누락되어 보수적 판정을 적용했습니다.' : '',
    ].filter(Boolean),
  };
}

function buildDailyMarketGateCard(input: PublicReportAdapterInput, now: Date): DailyMarketGateCard {
  const kospiScore = statusToScore(input.marketContext?.kospi.status);
  const kosdaqScore = statusToScore(input.marketContext?.kosdaq.status);
  const iriScore = typeof input.marketContext?.iri === 'number' ? clamp(input.marketContext.iri) : 60;
  const macroHealthScore = Math.round((kospiScore + kosdaqScore + iriScore) / 3);
  const marketGateStatus = scoreToGateStatus(macroHealthScore);
  const engineMode = input.engineMode ?? (marketGateStatus === 'RED' ? 'SELL_ONLY' : 'NORMAL');
  const newBuyAllowed = engineMode === 'NORMAL' && (marketGateStatus === 'GREEN' || marketGateStatus === 'YELLOW');

  const leading = input.sectorEnergyResult?.leadingSectors?.map((sector) => sector.name).slice(0, 3)
    ?? input.marketOverview?.sectorRotation?.topSectors?.map((sector) => sector.name).slice(0, 3)
    ?? [];
  const weak = input.sectorEnergyResult?.laggingSectors?.map((sector) => sector.name).slice(0, 3) ?? [];

  return {
    reportDate: reportDate(now),
    marketSessionState: input.marketSessionState ?? 'UNKNOWN',
    engineMode,
    marketGateStatus,
    macroHealthScore,
    newBuyAllowed,
    sellOnlyAllowed: engineMode === 'SELL_ONLY' || engineMode === 'NORMAL' || engineMode === 'DEGRADED',
    shadowLearningAllowed: true,
    primaryReason: newBuyAllowed
      ? '시장 Gate는 관찰 가능한 상태입니다.'
      : '신규 매수보다 관찰과 리스크 관리가 우선인 상태입니다.',
    riskSummary: marketGateStatus === 'RED'
      ? '거시 환경이 약해 신규 진입은 제한하고 보유 관리 중심으로 대응합니다.'
      : marketGateStatus === 'ORANGE'
        ? '신규 진입은 제한적으로만 검토하고 눌림목 확인이 필요합니다.'
        : '추격보다 조건 충족 후보 중심의 관찰이 유리합니다.',
    leadingSectorsTop3: leading,
    weakSectorsTop3: weak,
    tomorrowWatchPoints: [
      '주도 섹터의 수급 유지 여부',
      'Gate 3 타이밍 조건 회복 여부',
      'Provider 상태와 데이터 신뢰도 변화',
    ],
  };
}

function sectorItem(score: SectorEnergyScore, index: number): SectorRotationItem {
  const flowDirection: SectorRotationItem['flowDirection'] = score.score >= 60 ? 'INFLOW' : score.score <= 40 ? 'OUTFLOW' : 'NEUTRAL';
  return {
    sectorName: score.name,
    sectorScore: Math.round(score.score),
    relativeStrengthRank: index + 1,
    flowDirection,
    trendChange: score.score >= 60 ? 'UP' : score.score <= 40 ? 'DOWN' : 'FLAT',
    sectorGateStatus: sectorGateStatus(score.score),
    reason: flowDirection === 'INFLOW' ? '상대 강도와 섹터 에너지가 우위입니다.' : flowDirection === 'OUTFLOW' ? '상대 약세와 수급 둔화가 관찰됩니다.' : '중립 구간입니다.',
    representativeStocks: [],
    cautionFlags: score.sourceTier && !['KIS_OFFICIAL_INDEX', 'KIS_OFFICIAL_DAILY', 'KRX_OFFICIAL_INDEX'].includes(score.sourceTier)
      ? [`source=${score.sourceTier}`]
      : [],
  };
}

function buildSectorRotationCard(input: PublicReportAdapterInput, now: Date): SectorRotationCard {
  const sectors = [...(input.sectorEnergyResult?.scores ?? [])]
    .sort((a, b) => b.score - a.score)
    .map(sectorItem);

  return {
    reportDate: reportDate(now),
    sectors,
    topSectors: sectors.slice(0, 5),
    weakSectors: sectors.slice(-5).reverse(),
    summary: input.sectorEnergyResult?.summary ?? '섹터 데이터는 공개 카드 기준으로 요약되었습니다.',
  };
}

function stockSector(stock?: StockRecommendation): string {
  return stock?.sectorAnalysis?.sectorName
    ?? stock?.relatedSectors?.[0]
    ?? stock?.correlationGroup
    ?? 'UNCLASSIFIED';
}

function gateText(score?: number, passed?: boolean): string {
  if (typeof score !== 'number') return 'N/A';
  return `${round(score, 1)} ${passed === false ? '미통과' : '확인'}`;
}

function mapPublicDecision(stock: StockRecommendation | undefined, confidence: DataConfidenceSummary, marketGate: DailyMarketGateCard): PublicDecisionStatus {
  if (!stock) return 'DATA_INSUFFICIENT';
  if (marketGate.engineMode === 'SELL_ONLY') return 'SELL_ONLY';
  if (marketGate.engineMode === 'SHADOW_ONLY' || marketGate.engineMode === 'OBSERVE_ONLY') return 'WATCH';
  if (confidence.overall === 'MISSING' || confidence.overall === 'STALE') return 'DATA_INSUFFICIENT';
  if (stock.gateEvaluation?.gate1Passed === false) return 'BLOCKED';
  if (stock.gateEvaluation?.gate2Passed === false) return 'WATCH';
  if (stock.gateEvaluation?.gate3Passed === false) return 'WAIT_PULLBACK';
  if (stock.type === 'STRONG_BUY') return confidence.aiEstimatedIndicatorCount > 0 ? 'BUY' : 'CONFIRMED_BUY';
  if (stock.type === 'BUY') return confidence.aiEstimatedIndicatorCount > 2 ? 'WATCH' : 'BUY';
  return 'HOLD';
}

function buildStockDecisionCard(stock: StockRecommendation | undefined, marketGate: DailyMarketGateCard): StockDecisionCard | undefined {
  if (!stock) return undefined;
  const confidence = mapConfidenceFromRecommendation(stock);
  const finalDecision = mapPublicDecision(stock, confidence, marketGate);
  const finalScore = Math.round(stock.gateEvaluation?.finalScore ?? stock.quantGateScore?.value ?? stock.confidenceScore ?? 0);
  const blockedReasons = [
    stock.gateEvaluation?.gate1Passed === false ? 'Gate 1 생존 필터 미통과' : '',
    stock.gateEvaluation?.gate2Passed === false ? 'Gate 2 성장 검증 부족' : '',
    stock.gateEvaluation?.gate3Passed === false ? 'Gate 3 타이밍 부족' : '',
    confidence.overall === 'MISSING' ? '핵심 지표 데이터 부족' : '',
    confidence.overall === 'STALE' ? '일부 데이터 최신성 저하' : '',
  ].filter(Boolean);

  return {
    stockCode: stock.code,
    stockName: stock.name,
    sector: stockSector(stock),
    finalDecision,
    finalScore,
    gate0MacroStatus: marketGate.marketGateStatus,
    gate1SurvivalResult: gateText(stock.gateEvaluation?.gate1?.score, stock.gateEvaluation?.gate1Passed),
    gate2GrowthResult: gateText(stock.gateEvaluation?.gate2?.score, stock.gateEvaluation?.gate2Passed),
    gate3TimingResult: gateText(stock.gateEvaluation?.gate3?.score, stock.gateEvaluation?.gate3Passed),
    calculatedIndicatorCount: confidence.calculatedIndicatorCount,
    aiEstimatedIndicatorCount: confidence.aiEstimatedIndicatorCount,
    missingIndicatorCount: confidence.missingIndicatorCount,
    dataConfidenceSummary: confidence,
    bullishReasons: [stock.reason, ...(stock.patterns ?? []).slice(0, 3)].filter(Boolean),
    bearishReasons: stock.riskFactors?.slice(0, 5) ?? [],
    blockedReasons,
    shadowRegistrationStatus: marketGate.newBuyAllowed ? 'REGISTERED' : 'SHADOW_ONLY',
    executionImpact: marketGate.newBuyAllowed ? 'LIVE_EXECUTION_ALLOWED' : marketGate.engineMode === 'SELL_ONLY' ? 'SELL_ONLY' : 'NONE',
  };
}

function buildBuyBlockReasonCard(stockDecision: StockDecisionCard | undefined): BuyBlockReasonCard | undefined {
  if (!stockDecision || stockDecision.blockedReasons.length === 0) return undefined;
  const failedGate = stockDecision.blockedReasons.some((reason) => reason.includes('Gate 1'))
    ? 'GATE_1_SURVIVAL'
    : stockDecision.blockedReasons.some((reason) => reason.includes('Gate 2'))
      ? 'GATE_2_GROWTH'
      : stockDecision.blockedReasons.some((reason) => reason.includes('Gate 3'))
        ? 'GATE_3_TIMING'
        : 'DATA_CONFIDENCE';

  return {
    stockName: stockDecision.stockName,
    blockLevel: failedGate === 'GATE_1_SURVIVAL' ? 'HARD_BLOCK' : failedGate === 'DATA_CONFIDENCE' ? 'DATA_INSUFFICIENT' : 'TEMPORARY_WAIT',
    failedGate,
    blockedReasons: stockDecision.blockedReasons,
    riskFlags: stockDecision.bearishReasons,
    dataIssues: stockDecision.dataConfidenceSummary.notes,
    requiredConditionsForReentry: [
      '차단 Gate 재통과',
      '데이터 신뢰도 회복',
      '손익비와 타이밍 조건 재확인',
    ],
    shadowOnlyAllowed: true,
    postOutcomeTrackingEnabled: true,
    executionImpact: 'NONE',
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
    period: '최근 Shadow 기록',
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
      'Shadow 성과는 실거래 성과와 분리해 표시합니다.',
      '표본 수가 충분해지기 전까지 실거래 전환은 보류합니다.',
    ],
  };
}

function buildPublicSummary(marketGate: DailyMarketGateCard, stockDecision?: StockDecisionCard): string {
  const stockLine = stockDecision ? `${stockDecision.stockName}: ${stockDecision.finalDecision}` : '시스템 후보 없음';
  return `시장 Gate ${marketGate.marketGateStatus}, 신규 매수 ${marketGate.newBuyAllowed ? '관찰 가능' : '제한'}, ${stockLine}.`;
}

function buildBlogMarkdown(model: Omit<PublicReportModel, 'markdownOutput' | 'telegramOutput' | 'publicSummary'>): string {
  const market = model.marketGate;
  const sector = model.sectorRotation;
  const stock = model.stockDecision;
  const buyBlock = model.buyBlock;
  const shadow = model.shadowPerformance;

  return [
    '# 오늘 시장은 매수 가능한 장인가? - QuantMaster Gate 리포트',
    '',
    '## 1. 오늘의 한 줄 결론',
    market ? `${market.primaryReason} ${market.riskSummary}` : '시장 데이터가 부족해 공개 리포트를 보수적으로 생성했습니다.',
    '',
    '## 2. 시장 Gate',
    `- 시장 상태: ${market?.marketGateStatus ?? 'GRAY'}`,
    `- 신규 매수: ${market?.newBuyAllowed ? '관찰 가능' : '제한'}`,
    `- 보유 관리: ${market?.sellOnlyAllowed ? '가능' : '제한'}`,
    `- Shadow Learning: ${market?.shadowLearningAllowed ? 'ON' : 'OFF'}`,
    `- Macro Health Score: ${market?.macroHealthScore ?? 0}/100`,
    `- 주도 섹터: ${market?.leadingSectorsTop3.join(' / ') || '확인 필요'}`,
    `- 위험 섹터: ${market?.weakSectorsTop3.join(' / ') || '확인 필요'}`,
    '',
    '## 3. 섹터 로테이션',
    ...(sector?.topSectors.slice(0, 5).map((item, index) => `- ${index + 1}위: ${item.sectorName} ${item.sectorScore}점 ${item.flowDirection}`) ?? ['- 데이터 확인 필요']),
    '',
    '## 4. 오늘의 후보 요약',
    `- WATCH: ${stock?.finalDecision === 'WATCH' ? 1 : 0}`,
    `- WAIT_PULLBACK: ${stock?.finalDecision === 'WAIT_PULLBACK' ? 1 : 0}`,
    `- BLOCKED: ${stock?.finalDecision === 'BLOCKED' ? 1 : 0}`,
    '',
    '## 5. 종목 판정',
    `- 종목명: ${stock?.stockName ?? '후보 없음'}`,
    `- 최종 판정: ${stock?.finalDecision ?? 'DATA_INSUFFICIENT'}`,
    `- Gate 0: ${stock?.gate0MacroStatus ?? 'N/A'}`,
    `- Gate 1: ${stock?.gate1SurvivalResult ?? 'N/A'}`,
    `- Gate 2: ${stock?.gate2GrowthResult ?? 'N/A'}`,
    `- Gate 3: ${stock?.gate3TimingResult ?? 'N/A'}`,
    `- 데이터 신뢰도: ${stock?.dataConfidenceSummary.overall ?? 'MISSING'}`,
    '',
    '## 6. 매수 차단 사유',
    ...(buyBlock?.blockedReasons.map((reason, index) => `- 차단 사유 ${index + 1}: ${reason}`) ?? ['- 현재 주요 차단 사유 없음']),
    '',
    '## 7. Shadow 추적 결과',
    `- 후보 수: ${shadow?.totalShadowCandidates ?? 0}`,
    `- 승률: ${shadow?.winRate ?? 0}%`,
    `- PF: ${shadow?.profitFactor ?? 0}`,
    `- MDD: ${shadow?.maxDrawdown ?? 0}%`,
    `- 실거래 전환 상태: ${shadow?.liveTransitionStatus ?? 'NOT_READY'}`,
    '',
    '## 8. 내일 확인할 조건',
    ...(market?.tomorrowWatchPoints.map((point) => `- ${point}`) ?? ['- 데이터 신뢰도 회복 여부']),
    '',
    '## 투자 유의',
    INVESTMENT_NOTICE,
  ].join('\n');
}

function buildTelegramSummary(market: DailyMarketGateCard, sector: SectorRotationCard, stock?: StockDecisionCard): string {
  return [
    '[QuantMaster Daily Gate]',
    `시장 Gate: ${market.marketGateStatus}`,
    `신규 매수: ${market.newBuyAllowed ? '관찰 가능' : '제한'}`,
    `주도 섹터: ${sector.topSectors.slice(0, 3).map((item) => item.sectorName).join(' / ') || '확인 필요'}`,
    `오늘 후보: ${stock ? `${stock.stockName} ${stock.finalDecision}` : '후보 없음'}`,
    'Shadow Learning: ON',
    '판단: 추격매수보다 조건 확인과 눌림목 대기',
    INVESTMENT_NOTICE,
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
  const marketGate = buildDailyMarketGateCard(input, now);
  const sectorRotation = buildSectorRotationCard(input, now);
  const stockDecision = buildStockDecisionCard(input.recommendations?.[0], marketGate);
  const buyBlock = buildBuyBlockReasonCard(stockDecision);
  const shadowPerformance = buildShadowPerformanceCard(input.shadowTrades);
  const base = {
    reportId: createReportId(now),
    reportDate: reportDate(now),
    reportType: 'DAILY_FULL_REPORT' as const,
    visibility: input.visibility ?? 'PUBLIC',
    marketGate,
    sectorRotation,
    stockDecision,
    buyBlock,
    shadowPerformance,
    paidPayload: input.visibility === 'PAID' || input.visibility === 'PRIVATE' ? buildPaidPayload(input) : undefined,
    privatePayload: input.visibility === 'PRIVATE' ? buildPrivatePayload(input) : undefined,
    generatedAt: now.toISOString(),
  };

  return {
    ...base,
    markdownOutput: buildBlogMarkdown(base),
    telegramOutput: buildTelegramSummary(marketGate, sectorRotation, stockDecision),
    publicSummary: buildPublicSummary(marketGate, stockDecision),
  };
}

export function savePublicReportSnapshot(report: PublicReportModel, storage: Pick<Storage, 'getItem' | 'setItem'> = window.localStorage): void {
  const key = 'quantmaster-public-report-snapshots';
  const existing = JSON.parse(storage.getItem(key) ?? '[]') as PublicReportModel[];
  storage.setItem(key, JSON.stringify([report, ...existing].slice(0, 20)));
}

export { INVESTMENT_NOTICE };
