// @responsibility portfolioRiskEngine 매매 엔진 모듈
/**
 * portfolioRiskEngine.ts — 포트폴리오 수준 리스크 관리 엔진
 *
 * 개별 종목 신호가 아무리 정교해도 포트폴리오 전체가 동일 방향으로 쏠리면
 * 체계적 리스크에 노출된다. 이 엔진은 4가지 포트폴리오 리스크를 실시간 평가하여
 * 신규 진입을 차단하거나 경보를 발송한다.
 *
 * ① 섹터 집중도: 동일 섹터 합산 > 포트폴리오 30% → 신규 진입 차단
 * ② 가중 베타 합산: 포트폴리오 가중 베타 > 1.5 → 진입 제한
 * ③ 상관관계 경보: 60일 수익률 상관 ≥ 0.7 쌍 ≥ 3개 → "허위 분산 경보"
 * ④ 일일 최대 손실: 계좌 기준 -2% → 신규 진입 중단
 */

import {
  loadShadowTrades,
  type ServerShadowTrade,
} from '../persistence/shadowTradeRepo.js';
import { loadWatchlist } from '../persistence/watchlistRepo.js';
import { isOpenShadowStatus } from './entryEngine.js';
import { getRealtimePrice } from '../clients/kisStreamClient.js';
import { fetchCurrentPrice } from '../clients/kisClient.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { getDailyLossPct } from '../state.js';
import { getTradingMode } from '../state.js';
import { safePctChange } from '../utils/safePctChange.js';
import { loadTradingSettings } from '../persistence/tradingSettingsRepo.js';
import { computeShadowAccount } from '../persistence/shadowAccountRepo.js';

// ─── 설정 상수 ───────────────────────────────────────────────────────────────

/** 동일 섹터 최대 비중 (30%) — 신규 진입 차단/보유 내부 구성비 참고용. */
const MAX_SECTOR_WEIGHT      = parseFloat(process.env.MAX_SECTOR_WEIGHT ?? '0.30');
/** 섹터 집중도 자동 대응 시 트레일링 후보 비율 (현재가 ×0.99 = -1% 후보, ADR-0028 §Phase B). */
export const SECTOR_TIGHT_STOP_RATIO = 0.99;

export type SectorType = 'INDUSTRY' | 'THEME' | 'MARKET_SEGMENT' | 'RISK_BUCKET' | 'UNKNOWN';

export type SectorRiskReason =
  | 'SECTOR_EXPOSURE_LIMIT_EXCEEDED'
  | 'OPEN_POSITION_CONCENTRATION_ONLY'
  | 'SINGLE_POSITION_ARTIFACT'
  | 'SMALL_EXPOSURE_ARTIFACT'
  | 'MARKET_SEGMENT_NOT_INDUSTRY_SECTOR'
  | 'SHADOW_POSITION_OBSERVE_ONLY'
  | 'INSUFFICIENT_POSITION_COUNT'
  | 'INSUFFICIENT_CAPITAL_EXPOSURE'
  | 'AUTO_ACTION_DISABLED_FOR_SHADOW'
  | 'VALID_LIVE_SECTOR_RISK';

export interface ExposureMetrics {
  sectorName: string;
  sectorType: SectorType;
  positionCount: number;
  sectorExposureAmount: number;
  totalOpenPositionExposure: number;
  baseCapital: number;
  accountNAV: number | null;
  activeRiskBudget: number | null;
  concentrationByOpenPositionsPct: number;
  exposureByBaseCapitalPct: number;
  exposureByNAVPct: number | null;
  exposureByRiskBudgetPct: number | null;
  isSmallExposure: boolean;
  isSinglePositionArtifact: boolean;
}

export interface SectorRiskConfig {
  maxSectorConcentrationByOpenPositionsPct: number;
  maxSectorExposureByCapitalPct: number;
  maxSectorExposureByNavPct: number;
  minPositionsForSectorAutoAction: number;
  minSectorExposureAmount: number;
  minSectorExposureByCapitalPct: number;
  allowShadowSectorAutoAction: boolean;
  allowLiveSectorAutoAction: boolean;
}

export const DEFAULT_SECTOR_RISK_CONFIG: SectorRiskConfig = Object.freeze({
  maxSectorConcentrationByOpenPositionsPct: Number(process.env.MAX_SECTOR_CONCENTRATION_BY_OPEN_POSITIONS_PCT ?? 30),
  maxSectorExposureByCapitalPct: Number(process.env.MAX_SECTOR_EXPOSURE_BY_CAPITAL_PCT ?? 30),
  maxSectorExposureByNavPct: Number(process.env.MAX_SECTOR_EXPOSURE_BY_NAV_PCT ?? 30),
  minPositionsForSectorAutoAction: Number(process.env.MIN_POSITIONS_FOR_SECTOR_AUTO_ACTION ?? 2),
  minSectorExposureAmount: Number(process.env.MIN_SECTOR_EXPOSURE_AMOUNT ?? 3_000_000),
  minSectorExposureByCapitalPct: Number(process.env.MIN_SECTOR_EXPOSURE_BY_CAPITAL_PCT ?? 3),
  allowShadowSectorAutoAction: process.env.ALLOW_SHADOW_SECTOR_AUTO_ACTION === 'true',
  allowLiveSectorAutoAction: process.env.ALLOW_LIVE_SECTOR_AUTO_ACTION !== 'false',
});

/**
 * 섹터 집중도 자동 대응에서 리스크 액션 후보로 표시할 포지션 메타.
 * PATCH-008 이후 이 값은 즉시 손절선 변경/청산이 아니라 LIVE risk action candidate
 * 또는 SHADOW 학습용 트레일링 후보 메시지에만 사용한다.
 */
export interface SectorTighteningMeta {
  stockName: string;
  stockCode: string;
  currentPrice: number;
  tightStop: number;
  pnlPct: number;
}

const MarketSegmentLabels = new Set([
  '우량기업부',
  '벤처기업부',
  '중견기업부',
  '기술성장기업부',
  '관리종목',
  '투자주의환기종목',
  'KOSPI',
  'KOSDAQ',
  'KONEX',
]);

const KnownIndustrySectors = new Set([
  '반도체', '이차전지', '자동차', '바이오', '금융', '방산', '소프트웨어',
  '화학', '철강', '유통', '건설', '통신', '에너지', '엔터', '조선',
]);
const KnownThemeBuckets = new Set(['원전', '전력기기', '로봇', 'AI', '조선']);
const KnownRiskBuckets = new Set(['고베타', '저유동성', '단기급등', '상관고위험']);

export function classifySectorType(label: string): SectorType {
  if (MarketSegmentLabels.has(label)) return 'MARKET_SEGMENT';
  if (KnownIndustrySectors.has(label)) return 'INDUSTRY';
  if (KnownThemeBuckets.has(label)) return 'THEME';
  if (KnownRiskBuckets.has(label)) return 'RISK_BUCKET';
  return 'UNKNOWN';
}

export function calculateExposureMetrics(input: {
  sectorName: string;
  sectorExposureAmount: number;
  totalOpenPositionExposure: number;
  positionCount: number;
  baseCapital: number;
  accountNAV?: number | null;
  activeRiskBudget?: number | null;
  config?: SectorRiskConfig;
}): ExposureMetrics {
  const config = input.config ?? DEFAULT_SECTOR_RISK_CONFIG;
  const accountNAV = input.accountNAV ?? null;
  const activeRiskBudget = input.activeRiskBudget ?? null;
  const exposureByBaseCapitalPct = input.baseCapital > 0
    ? (input.sectorExposureAmount / input.baseCapital) * 100
    : 0;

  return {
    sectorName: input.sectorName,
    sectorType: classifySectorType(input.sectorName),
    positionCount: input.positionCount,
    sectorExposureAmount: input.sectorExposureAmount,
    totalOpenPositionExposure: input.totalOpenPositionExposure,
    baseCapital: input.baseCapital,
    accountNAV,
    activeRiskBudget,
    concentrationByOpenPositionsPct: input.totalOpenPositionExposure > 0
      ? (input.sectorExposureAmount / input.totalOpenPositionExposure) * 100
      : 0,
    exposureByBaseCapitalPct,
    exposureByNAVPct: accountNAV !== null && accountNAV > 0
      ? (input.sectorExposureAmount / accountNAV) * 100
      : null,
    exposureByRiskBudgetPct: activeRiskBudget !== null && activeRiskBudget > 0
      ? (input.sectorExposureAmount / activeRiskBudget) * 100
      : null,
    isSmallExposure: input.sectorExposureAmount < config.minSectorExposureAmount
      || exposureByBaseCapitalPct < config.minSectorExposureByCapitalPct,
    isSinglePositionArtifact: input.positionCount === 1,
  };
}

export function evaluateSectorRiskAutoAction(input: {
  metrics: ExposureMetrics;
  mode: 'LIVE' | 'SHADOW';
  config?: SectorRiskConfig;
}): { canTriggerAutoAction: boolean; reasons: SectorRiskReason[]; singlePositionRisk: boolean } {
  const config = input.config ?? DEFAULT_SECTOR_RISK_CONFIG;
  const { metrics } = input;
  const reasons: SectorRiskReason[] = [];

  const exceedsCapitalLimit = metrics.exposureByBaseCapitalPct >= config.maxSectorExposureByCapitalPct;
  const exceedsNavLimit = metrics.exposureByNAVPct !== null
    && metrics.exposureByNAVPct >= config.maxSectorExposureByNavPct;
  const hasEnoughPositions = metrics.positionCount >= config.minPositionsForSectorAutoAction;
  const hasEnoughExposure = metrics.sectorExposureAmount >= config.minSectorExposureAmount
    && metrics.exposureByBaseCapitalPct >= config.minSectorExposureByCapitalPct;
  const isValidSectorType = metrics.sectorType === 'INDUSTRY'
    || metrics.sectorType === 'THEME'
    || metrics.sectorType === 'RISK_BUCKET';

  if (metrics.concentrationByOpenPositionsPct >= config.maxSectorConcentrationByOpenPositionsPct
      && !exceedsCapitalLimit && !exceedsNavLimit) {
    reasons.push('OPEN_POSITION_CONCENTRATION_ONLY');
  }
  if (!hasEnoughPositions) reasons.push('INSUFFICIENT_POSITION_COUNT');
  if (metrics.isSinglePositionArtifact) reasons.push('SINGLE_POSITION_ARTIFACT');
  if (!hasEnoughExposure || metrics.isSmallExposure) {
    reasons.push('SMALL_EXPOSURE_ARTIFACT', 'INSUFFICIENT_CAPITAL_EXPOSURE');
  }
  if (metrics.sectorType === 'MARKET_SEGMENT') reasons.push('MARKET_SEGMENT_NOT_INDUSTRY_SECTOR');
  if (input.mode === 'SHADOW') {
    reasons.push('SHADOW_POSITION_OBSERVE_ONLY');
    if (!config.allowShadowSectorAutoAction) reasons.push('AUTO_ACTION_DISABLED_FOR_SHADOW');
  }
  if ((exceedsCapitalLimit || exceedsNavLimit) && isValidSectorType) {
    reasons.push('SECTOR_EXPOSURE_LIMIT_EXCEEDED');
  }

  const modeAllowed = input.mode === 'LIVE'
    ? config.allowLiveSectorAutoAction
    : config.allowShadowSectorAutoAction;
  const canTriggerAutoAction = modeAllowed
    && isValidSectorType
    && hasEnoughPositions
    && hasEnoughExposure
    && (exceedsCapitalLimit || exceedsNavLimit);

  if (canTriggerAutoAction && input.mode === 'LIVE') reasons.push('VALID_LIVE_SECTOR_RISK');

  return {
    canTriggerAutoAction,
    reasons: Array.from(new Set(reasons)),
    singlePositionRisk: metrics.positionCount === 1 && (exceedsCapitalLimit || exceedsNavLimit),
  };
}

export function buildSectorObserveOnlyAlert(input: {
  metrics: ExposureMetrics;
  posNames: string;
  reasons: SectorRiskReason[];
}): string {
  const { metrics, posNames, reasons } = input;
  return [
    `ℹ️ <b>[섹터 집중도 참고 – 자동대응 없음]</b>`,
    `분류: <b>${metrics.sectorName}</b>`,
    `분류유형: ${metrics.sectorType}`,
    `보유 종목: ${posNames} ${metrics.positionCount}개`,
    `보유 기준 비중: ${metrics.concentrationByOpenPositionsPct.toFixed(1)}%`,
    `원금 대비 노출: ${metrics.exposureByBaseCapitalPct.toFixed(2)}%`,
    `평가금액: 약 ${Math.round(metrics.sectorExposureAmount).toLocaleString()}원`,
    ``,
    `판정: 초기/소형 SHADOW 포지션 착시`,
    `자동 액션: 없음`,
    `사유: ${reasons.join(', ')}`,
  ].join('\n');
}

export function buildShadowProfitProtectionCandidateAlert(input: {
  target: SectorTighteningMeta;
  previousStop: number;
}): string {
  const pnlSign = input.target.pnlPct >= 0 ? '+' : '';
  return [
    `🟡 <b>[SHADOW 수익 보호 후보]</b>`,
    `종목: ${input.target.stockName}(${input.target.stockCode})`,
    `현재 수익률: ${pnlSign}${input.target.pnlPct.toFixed(2)}%`,
    `현재가: ${input.target.currentPrice.toLocaleString()}원`,
    `기존 손절: ${input.previousStop.toLocaleString()}원`,
    `트레일링 후보: ${input.target.tightStop.toLocaleString()}원`,
    ``,
    `판정: 수익 보호 조건 후보`,
    `주의: 실계좌 주문 아님 / 섹터 집중도 대응 아님`,
  ].join('\n');
}

/**
 * LIVE 전용 섹터 노출 초과 알림 빌더.
 * PATCH-008: 즉시 손절선 긴축/청산 표현을 제거하고 후보 액션만 표시한다.
 */
export function buildSectorOverflowAlert(input: {
  sector: string;
  weightPct: number;
  limitPct: number;
  posNames: string;
  exitTarget: SectorTighteningMeta | null;
  metrics?: ExposureMetrics;
}): string {
  const { sector, weightPct, limitPct, posNames, metrics } = input;
  const exposureByCapital = metrics?.exposureByBaseCapitalPct ?? weightPct;
  const exposureByNav = metrics?.exposureByNAVPct;
  return [
    `⚠️ <b>[LIVE 섹터 노출 초과]</b>`,
    `섹터: <b>${sector}</b>`,
    `보유 종목: ${posNames}${metrics ? ` (${metrics.positionCount}개)` : ''}`,
    metrics ? `섹터 평가금액: ${Math.round(metrics.sectorExposureAmount).toLocaleString()}원` : null,
    `원금 대비 노출: ${exposureByCapital.toFixed(1)}%`,
    `NAV 대비 노출: ${exposureByNav === null || exposureByNav === undefined ? 'N/A' : `${exposureByNav.toFixed(1)}%`}`,
    `한도: ${limitPct.toFixed(1)}%`,
    ``,
    `자동 액션 후보:`,
    `1. 신규 매수 제한`,
    `2. 추가 진입 차단`,
    `3. 최저 기대값 포지션 축소 후보`,
    `4. 트레일링 스탑 강화 후보`,
    ``,
    `executionImpact=RISK_CONTROL_ONLY`,
    `engineAlive=true`,
    `positionExitAllowed=true`,
  ].filter((line): line is string => line !== null).join('\n');
}
/** 포트폴리오 가중 베타 한도 */
const MAX_PORTFOLIO_BETA     = parseFloat(process.env.MAX_PORTFOLIO_BETA ?? '1.5');
/** 상관관계 경보 임계: 상관계수 */
const CORRELATION_THRESHOLD  = 0.7;
/** 상관관계 경보 임계: 고상관 쌍 수 */
const CORRELATION_PAIR_LIMIT = 3;
/** 일일 손실 한도 (계좌 기준 %) — checkDailyLossLimit과 별도로 진입 차단용 */
const DAILY_LOSS_ENTRY_BLOCK = parseFloat(process.env.DAILY_LOSS_ENTRY_BLOCK ?? '2');

// ─── 종목별 섹터 베타 데이터 ─────────────────────────────────────────────────
// 실제로는 외부 DB/API에서 가져와야 하지만, 한국 주요 섹터의 대표 베타 값을 사용.
// watchlist의 sector 필드와 매칭하여 사용한다.

const SECTOR_BETA: Record<string, number> = {
  '반도체':     1.3,
  '이차전지':   1.4,
  '자동차':     1.1,
  '조선':       1.2,
  '바이오':     1.5,
  '금융':       0.8,
  '방산':       0.9,
  '소프트웨어': 1.2,
  '화학':       1.0,
  '철강':       1.1,
  '유통':       0.9,
  '건설':       1.0,
  '통신':       0.7,
  '에너지':     1.1,
  '엔터':       1.3,
  'AI':         1.5,
  '로봇':       1.4,
};

const DEFAULT_BETA = 1.0;

// ─── 포트폴리오 리스크 평가 결과 ─────────────────────────────────────────────

export interface PortfolioRiskResult {
  /** 신규 진입 가능 여부 */
  entryAllowed: boolean;
  /** 차단 사유 목록 */
  blockReasons: string[];
  /** 경고 메시지 (차단 아니지만 주의 필요) */
  warnings: string[];

  // 세부 지표
  sectorWeights: Record<string, number>;     // 보유 포지션 내부 섹터별 상대 비중 (0-1)
  sectorExposureMetrics?: ExposureMetrics[];  // 원금/NAV/리스크예산 대비 실제 노출률
  portfolioBeta: number;                      // 가중 베타
  highCorrelationPairs: [string, string, number][]; // [종목A, 종목B, 상관계수]
  dailyLossPct: number;                       // 당일 손실률
}

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

interface PositionSnapshot {
  stockCode: string;
  stockName: string;
  sector: string;
  entryPrice: number;
  currentPrice: number;
  quantity: number;
  marketValue: number;   // currentPrice × quantity
  beta: number;
  mode: 'LIVE' | 'SHADOW';
}

async function buildPositionSnapshots(): Promise<PositionSnapshot[]> {
  const shadows = loadShadowTrades();
  const watchlist = loadWatchlist();
  const wlMap = new Map(watchlist.map(w => [w.code, w]));

  const openPositions = shadows.filter(s => isOpenShadowStatus(s.status) && s.quantity > 0);
  const snapshots: PositionSnapshot[] = [];

  for (const pos of openPositions) {
    const currentPrice = getRealtimePrice(pos.stockCode)
      ?? await fetchCurrentPrice(pos.stockCode).catch(() => null)
      ?? pos.shadowEntryPrice;

    const wl = wlMap.get(pos.stockCode);
    // NOTE: profileType은 A/B/C/D 품질 티어이지 산업 섹터가 아니다. 과거 fallback에
    // pos.profileType이 포함돼 섹터 집중도·상관 계산이 전부 티어 기준으로 왜곡됐다.
    const sector = wl?.sector ?? '기타';
    const beta = SECTOR_BETA[sector] ?? DEFAULT_BETA;

    snapshots.push({
      stockCode: pos.stockCode,
      stockName: pos.stockName,
      sector,
      entryPrice: pos.shadowEntryPrice,
      currentPrice,
      quantity: pos.quantity,
      marketValue: currentPrice * pos.quantity,
      beta,
      mode: pos.mode === 'LIVE' ? 'LIVE' : 'SHADOW',
    });
  }

  return snapshots;
}

// ─── ① 섹터 집중도 체크 ──────────────────────────────────────────────────────

function checkSectorConcentration(
  snapshots: PositionSnapshot[],
  totalValue: number,
  candidateSector?: string,
): { weights: Record<string, number>; blocked: boolean; reason?: string } {
  const sectorValues: Record<string, number> = {};
  for (const s of snapshots) {
    sectorValues[s.sector] = (sectorValues[s.sector] ?? 0) + s.marketValue;
  }

  const weights: Record<string, number> = {};
  for (const [sector, value] of Object.entries(sectorValues)) {
    weights[sector] = totalValue > 0 ? value / totalValue : 0;
  }

  // 후보 종목 섹터가 이미 30% 초과인지 확인
  // '기타'는 섹터 미분류 버킷이므로 집중도 판정에서 제외.
  if (candidateSector && candidateSector !== '기타' && (weights[candidateSector] ?? 0) >= MAX_SECTOR_WEIGHT) {
    return {
      weights,
      blocked: true,
      reason: `섹터 집중도 초과: ${candidateSector} ${((weights[candidateSector] ?? 0) * 100).toFixed(1)}% ≥ ${(MAX_SECTOR_WEIGHT * 100).toFixed(0)}%`,
    };
  }

  return { weights, blocked: false };
}

function buildSectorExposureMetrics(
  snapshots: PositionSnapshot[],
  totalValue: number,
): ExposureMetrics[] {
  const settings = loadTradingSettings();
  const baseCapital = Number(process.env.AUTO_TRADE_ASSETS || settings.startingCapital);
  const currentPrices = Object.fromEntries(snapshots.map(s => [s.stockCode, s.currentPrice]));
  const accountNAV = computeShadowAccount(loadShadowTrades(), baseCapital, currentPrices).totalAssets;
  const bySector = new Map<string, { exposure: number; count: number }>();

  for (const s of snapshots) {
    const prev = bySector.get(s.sector) ?? { exposure: 0, count: 0 };
    prev.exposure += s.marketValue;
    prev.count += 1;
    bySector.set(s.sector, prev);
  }

  return Array.from(bySector.entries()).map(([sectorName, v]) => calculateExposureMetrics({
    sectorName,
    sectorExposureAmount: v.exposure,
    totalOpenPositionExposure: totalValue,
    positionCount: v.count,
    baseCapital,
    accountNAV,
    activeRiskBudget: null,
  }));
}

// ─── ② 가중 베타 합산 ───────────────────────────────────────────────────────

function checkPortfolioBeta(
  snapshots: PositionSnapshot[],
  totalValue: number,
): { beta: number; blocked: boolean; reason?: string } {
  if (totalValue <= 0 || snapshots.length === 0) return { beta: 0, blocked: false };

  let weightedBeta = 0;
  for (const s of snapshots) {
    const weight = s.marketValue / totalValue;
    weightedBeta += weight * s.beta;
  }

  if (weightedBeta > MAX_PORTFOLIO_BETA) {
    return {
      beta: weightedBeta,
      blocked: true,
      reason: `포트폴리오 가중 베타 초과: ${weightedBeta.toFixed(2)} > ${MAX_PORTFOLIO_BETA}`,
    };
  }

  return { beta: weightedBeta, blocked: false };
}

// ─── ③ 상관관계 경보 ────────────────────────────────────────────────────────
// 보유 종목 간 60일 일별 수익률 상관계수를 계산.
// 실시간 일별 수익률 히스토리는 없으므로, 같은 섹터 내 종목 쌍을
// 높은 상관(0.8) 으로 간주하는 휴리스틱 사용 (섹터 기반 프록시).
// 향후 일별 수익률 DB 구축 시 피어슨 상관으로 교체 가능.

function checkCorrelation(
  snapshots: PositionSnapshot[],
): { pairs: [string, string, number][]; warning: boolean; reason?: string } {
  const pairs: [string, string, number][] = [];

  for (let i = 0; i < snapshots.length; i++) {
    for (let j = i + 1; j < snapshots.length; j++) {
      const a = snapshots[i];
      const b = snapshots[j];
      // 동일 섹터 → 높은 상관 (0.8 가정)
      if (a.sector === b.sector && a.sector !== '기타') {
        pairs.push([a.stockName, b.stockName, 0.8]);
      }
    }
  }

  const highPairs = pairs.filter(p => p[2] >= CORRELATION_THRESHOLD);
  if (highPairs.length >= CORRELATION_PAIR_LIMIT) {
    return {
      pairs: highPairs,
      warning: true,
      reason: `허위 분산 경보: 상관계수 ≥${CORRELATION_THRESHOLD} 쌍 ${highPairs.length}개 (≥${CORRELATION_PAIR_LIMIT})`,
    };
  }

  return { pairs: highPairs, warning: false };
}

// ─── ④ 일일 손실 한도 ───────────────────────────────────────────────────────

function checkDailyLossForEntry(): { lossPct: number; blocked: boolean; reason?: string } {
  const lossPct = getDailyLossPct();
  if (lossPct >= DAILY_LOSS_ENTRY_BLOCK) {
    return {
      lossPct,
      blocked: true,
      reason: `일일 손실 한도: -${lossPct.toFixed(2)}% ≥ -${DAILY_LOSS_ENTRY_BLOCK}% — 신규 진입 중단`,
    };
  }
  return { lossPct, blocked: false };
}

// ─── 통합 평가 함수 ──────────────────────────────────────────────────────────

/**
 * 포트폴리오 리스크를 종합 평가하여 신규 진입 가능 여부를 반환한다.
 *
 * @param candidateSector 진입 후보 종목의 섹터 (optional — 섹터 집중도 체크용)
 * @returns PortfolioRiskResult
 */
export async function evaluatePortfolioRisk(
  candidateSector?: string,
): Promise<PortfolioRiskResult> {
  const snapshots = await buildPositionSnapshots();
  const totalValue = snapshots.reduce((sum, s) => sum + s.marketValue, 0);

  const blockReasons: string[] = [];
  const warnings: string[] = [];

  // ① 섹터 집중도
  const sector = checkSectorConcentration(snapshots, totalValue, candidateSector);
  const sectorExposureMetrics = buildSectorExposureMetrics(snapshots, totalValue);
  if (sector.blocked && sector.reason) blockReasons.push(sector.reason);

  // ② 가중 베타
  const beta = checkPortfolioBeta(snapshots, totalValue);
  if (beta.blocked && beta.reason) blockReasons.push(beta.reason);

  // ③ 상관관계 경보
  const corr = checkCorrelation(snapshots);
  if (corr.warning && corr.reason) warnings.push(corr.reason);

  // ④ 일일 손실
  const loss = checkDailyLossForEntry();
  if (loss.blocked && loss.reason) blockReasons.push(loss.reason);

  return {
    entryAllowed: blockReasons.length === 0,
    blockReasons,
    warnings,
    sectorWeights: sector.weights,
    sectorExposureMetrics,
    portfolioBeta: beta.beta,
    highCorrelationPairs: corr.pairs,
    dailyLossPct: loss.lossPct,
  };
}

// ─── 정기 리스크 모니터링 (cron 연동) ────────────────────────────────────────

/** 허위 분산 경보 발송 이력 (같은 장중 중복 방지) */
let _lastCorrelationAlertDate = '';
/** 섹터 집중도 긴급 경보 발송 이력 (섹터별, 장중 1회) */
let _lastSectorAlertDate = '';
const _alertedSectors = new Set<string>();

/**
 * 포트폴리오 리스크 정기 점검 — scheduler에서 호출.
 * 경보 조건 충족 시 텔레그램 발송.
 * 섹터 한도 초과 시 해당 섹터 포지션을 exitPending으로 마킹하여 자동 청산을 유도한다.
 */
export async function runPortfolioRiskCheck(): Promise<void> {
  const result = await evaluatePortfolioRisk();
  const today = new Date().toISOString().slice(0, 10);

  // 날짜 변경 시 경보 이력 초기화
  if (_lastSectorAlertDate !== today) {
    _lastSectorAlertDate = today;
    _alertedSectors.clear();
  }

  // 허위 분산 경보 (하루 1회)
  if (result.warnings.length > 0 && _lastCorrelationAlertDate !== today) {
    _lastCorrelationAlertDate = today;
    const pairList = result.highCorrelationPairs
      .map(([a, b, r]) => `  • ${a} ↔ ${b} (${r.toFixed(2)})`)
      .join('\n');
    await sendTelegramAlert(
      `⚠️ <b>[허위 분산 경보]</b>\n` +
      `고상관 종목 쌍 ${result.highCorrelationPairs.length}개 감지:\n` +
      `${pairList}\n\n` +
      `포트폴리오 β: ${result.portfolioBeta.toFixed(2)}\n` +
      `일일 손실: -${result.dailyLossPct.toFixed(2)}%`,
      { priority: 'HIGH', dedupeKey: `portfolio_corr_${today}` },
    ).catch(console.error);
  }

  // 베타 경고 (차단 시)
  if (result.blockReasons.some(r => r.includes('베타'))) {
    console.warn(`[PortfolioRisk] ${result.blockReasons.find(r => r.includes('베타'))}`);
  }

  // ── 섹터 집중도 자동 대응 ──────────────────────────────────────────────────
  const shadows = loadShadowTrades();
  const wlMap = new Map(loadWatchlist().map(w => [w.code, w]));
  let shadowsChanged = false;
  const runtimeMode = getTradingMode();

  for (const metrics of result.sectorExposureMetrics ?? []) {
    if (metrics.sectorName === '기타') continue;

    const sectorPositions = shadows.filter(s => {
      if (!isOpenShadowStatus(s.status)) return false;
      const wl = wlMap.get(s.stockCode);
      return (wl?.sector ?? '기타') === metrics.sectorName;
    });
    const sectorMode: 'LIVE' | 'SHADOW' = sectorPositions.some(p => p.mode === 'LIVE') || runtimeMode === 'LIVE'
      ? 'LIVE'
      : 'SHADOW';
    const decision = evaluateSectorRiskAutoAction({ metrics, mode: sectorMode });
    const posNames = sectorPositions.map(s => s.stockName).join(', ');

    console.warn(
      `[SECTOR_CONCENTRATION_EVALUATED] ` +
      `mode=${sectorMode} ` +
      `sectorName=${metrics.sectorName} ` +
      `sectorType=${metrics.sectorType} ` +
      `positionCount=${metrics.positionCount} ` +
      `sectorExposureAmount=${Math.round(metrics.sectorExposureAmount)} ` +
      `baseCapital=${Math.round(metrics.baseCapital)} ` +
      `concentrationByOpenPositionsPct=${metrics.concentrationByOpenPositionsPct.toFixed(2)} ` +
      `exposureByBaseCapitalPct=${metrics.exposureByBaseCapitalPct.toFixed(2)} ` +
      `limitByOpenPositionsPct=${DEFAULT_SECTOR_RISK_CONFIG.maxSectorConcentrationByOpenPositionsPct.toFixed(2)} ` +
      `limitByCapitalPct=${DEFAULT_SECTOR_RISK_CONFIG.maxSectorExposureByCapitalPct.toFixed(2)} ` +
      `canTriggerAutoAction=${decision.canTriggerAutoAction} ` +
      `reasons=${decision.reasons.join(',')} ` +
      `executionImpact=${decision.canTriggerAutoAction ? 'RISK_CONTROL_ONLY' : 'NONE'}`,
    );

    if (!decision.canTriggerAutoAction) {
      console.warn(
        `[SECTOR_AUTO_ACTION_BLOCKED] ` +
        `reason=${decision.reasons.includes('SINGLE_POSITION_ARTIFACT') && decision.reasons.includes('SMALL_EXPOSURE_ARTIFACT') && sectorMode === 'SHADOW'
          ? 'SINGLE_SMALL_SHADOW_POSITION_ARTIFACT'
          : decision.reasons[0] ?? 'OPEN_POSITION_CONCENTRATION_ONLY'} ` +
        `mode=${sectorMode} ` +
        `autoAction=NONE ` +
        `engineAlive=true ` +
        `shadowLearning=${sectorMode === 'SHADOW'} ` +
        `positionExitAllowed=true`,
      );

      if (metrics.concentrationByOpenPositionsPct >= DEFAULT_SECTOR_RISK_CONFIG.maxSectorConcentrationByOpenPositionsPct
          && !_alertedSectors.has(metrics.sectorName)) {
        _alertedSectors.add(metrics.sectorName);
        await sendTelegramAlert(
          buildSectorObserveOnlyAlert({ metrics, posNames, reasons: decision.reasons }),
          { priority: 'LOW', dedupeKey: `sector_observe_${metrics.sectorName}_${today}` },
        ).catch(console.error);
      }
      continue;
    }

    if (sectorMode !== 'LIVE') continue;

    if (!_alertedSectors.has(metrics.sectorName)) {
      _alertedSectors.add(metrics.sectorName);
      await sendTelegramAlert(
        buildSectorOverflowAlert({
          sector: metrics.sectorName,
          weightPct: metrics.concentrationByOpenPositionsPct,
          limitPct: DEFAULT_SECTOR_RISK_CONFIG.maxSectorExposureByCapitalPct,
          posNames,
          exitTarget: null,
          metrics,
        }),
        { priority: 'HIGH', dedupeKey: `sector_exposure_${metrics.sectorName}_${today}` },
      ).catch(console.error);
    }
  }

  if (shadowsChanged) {
    const { saveShadowTrades } = await import('../persistence/shadowTradeRepo.js');
    saveShadowTrades(shadows);
  }
}
