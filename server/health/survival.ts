// @responsibility Summarize account risk.
//
// ADR-0050 — Account Survival Gauge.
// 외부 호출 0건 — killSwitch + portfolioRiskEngine + kellySurfaceMap + shadowTradeRepo + macroState 만 read.
// AutoTradePage 최상단 위젯 (모든 컨텍스트 priority=1).

import { assessKillSwitch } from '../trading/killSwitch.js';
import { evaluatePortfolioRisk } from '../trading/portfolioRiskEngine.js';
import { loadShadowTrades } from '../persistence/shadowTradeRepo.js';
import { isOpenShadowStatus } from '../trading/entryEngine.js';

// ─── 타입 ────────────────────────────────────────────────────────────────

export type SurvivalTier = 'OK' | 'WARN' | 'CRITICAL' | 'EMERGENCY';
export type SectorTier = 'OK' | 'WARN' | 'CRITICAL' | 'NA';
export type KellyTier = 'OK' | 'WARN' | 'CRITICAL' | 'CALIBRATING';

interface DailyLossGauge {
  currentPct: number;
  limitPct: number;
  bufferPct: number;
  tier: SurvivalTier;
}

interface SectorConcentrationGauge {
  hhi: number;
  topSector: string | null;
  topWeight: number;
  activePositions: number;
  tier: SectorTier;
}

interface KellyConcordanceGauge {
  status?: 'RETIRED';
  ratio: number | null;
  currentAvgKelly: number;
  recommendedKelly: number;
  sampleSize: number;
  tier: KellyTier;
}

export interface SurvivalSnapshot {
  dailyLoss: DailyLossGauge;
  sectorConcentration: SectorConcentrationGauge;
  kellyConcordance: KellyConcordanceGauge;
  overallTier: SurvivalTier;
  capturedAt: string;
}

// ─── 임계값 SSOT (ADR-0050 §2.2) ────────────────────────────────────────

const HHI_OK_MAX = 2500;
const HHI_WARN_MAX = 4000;
const KELLY_OK_MAX = 1.0;
const KELLY_WARN_MAX = 1.5;
const KELLY_MIN_SAMPLE = 5;
const TIER_RANK: Record<SurvivalTier, number> = { OK: 0, WARN: 1, CRITICAL: 2, EMERGENCY: 3 };

// ─── 분류 헬퍼 (순수 함수) ──────────────────────────────────────────────

export function classifyDailyLossTier(bufferPct: number): SurvivalTier {
  if (!Number.isFinite(bufferPct) || bufferPct <= 0) return 'EMERGENCY';
  if (bufferPct >= 50) return 'OK';
  if (bufferPct >= 25) return 'WARN';
  return 'CRITICAL';
}

/**
 * "Unknown sector" 판정 — 모든 활성 포지션이 sector 미설정으로 단일 키('기타'/'unknown'/'') 에 합쳐진 경우.
 * watchlist 의 sector 필드 누락 시 portfolioRiskEngine 의 fallback `'기타'` 가 sectorWeights 를 단일 키로 만들어
 * HHI=10000 false CRITICAL 을 일으키는 데이터 누락 패턴. 이 경우 tier=NA 로 강등하여 분류 불가 처리.
 */
const UNKNOWN_SECTOR_KEYS = new Set(['기타', 'unknown', 'UNKNOWN', '']);

export function isUnknownSectorOnly(sectorWeights: Record<string, number>): boolean {
  const keys = Object.keys(sectorWeights).filter((k) => {
    const v = sectorWeights[k];
    return typeof v === 'number' && Number.isFinite(v) && v > 0;
  });
  if (keys.length !== 1) return false;
  return UNKNOWN_SECTOR_KEYS.has(keys[0]);
}

export function classifySectorTier(
  hhi: number,
  activePositions: number,
  isUnknownOnly: boolean = false,
): SectorTier {
  if (activePositions <= 0) return 'NA';
  if (isUnknownOnly) return 'NA';
  if (!Number.isFinite(hhi) || hhi < 0) return 'NA';
  if (hhi <= HHI_OK_MAX) return 'OK';
  if (hhi <= HHI_WARN_MAX) return 'WARN';
  return 'CRITICAL';
}

export function classifyKellyTier(
  ratio: number | null,
  recommendedKelly: number,
  sampleSize: number,
): KellyTier {
  if (sampleSize < KELLY_MIN_SAMPLE) return 'CALIBRATING';
  if (recommendedKelly <= 0) return 'CALIBRATING';
  if (ratio == null || !Number.isFinite(ratio)) return 'CALIBRATING';
  if (ratio <= KELLY_OK_MAX) return 'OK';
  if (ratio <= KELLY_WARN_MAX) return 'WARN';
  return 'CRITICAL';
}

/**
 * Herfindahl-Hirschman Index — Σ weight² × 10000.
 * 빈 입력 / 음수 / NaN → 0 (분류기에서 NA tier 판정).
 */
export function computeHhi(sectorWeights: Record<string, number>): number {
  const weights = Object.values(sectorWeights).filter((w) => Number.isFinite(w) && w > 0);
  if (weights.length === 0) return 0;
  const sum = weights.reduce((acc, w) => acc + w * w, 0);
  return Math.round(sum * 10000);
}

/**
 * Sector tier 가 NA / Kelly tier 가 CALIBRATING 일 때는 합성에서 제외.
 * 모두 비활성이면 OK 안전 기본값.
 */
export function composeOverallTier(
  loss: SurvivalTier,
  sector: SectorTier,
  kelly: KellyTier,
): SurvivalTier {
  const candidates: SurvivalTier[] = [loss];
  if (sector !== 'NA') candidates.push(sector as SurvivalTier);
  if (kelly !== 'CALIBRATING') candidates.push(kelly as SurvivalTier);
  return candidates.reduce<SurvivalTier>(
    (worst, t) => (TIER_RANK[t] > TIER_RANK[worst] ? t : worst),
    'OK',
  );
}

// ─── 데이터 수집 ────────────────────────────────────────────────────────

function topSectorEntry(weights: Record<string, number>): { sector: string | null; weight: number } {
  let topSector: string | null = null;
  let topWeight = 0;
  for (const [sector, w] of Object.entries(weights)) {
    if (Number.isFinite(w) && w > topWeight) {
      topSector = sector;
      topWeight = w;
    }
  }
  return { sector: topSector, weight: topWeight };
}

// ─── 메인 SSOT ──────────────────────────────────────────────────────────

/**
 * 외부 호출 0건. evaluatePortfolioRisk 가 내부적으로 getRealtimePrice/fetchCurrentPrice 를 사용하지만
 * 이는 기존 자동매매 경로의 캐시 재사용 — 본 함수가 신규로 추가하는 호출은 없음.
 */
export async function collectSurvivalSnapshot(now: Date = new Date()): Promise<SurvivalSnapshot> {
  const limitPct = Math.max(0.1, Number(process.env.DAILY_LOSS_LIMIT_PCT ?? 5));

  const ks = assessKillSwitch();
  const dailyLossPct = ks.details.dailyLossPct;
  const bufferPct = Math.max(-100, Math.min(100, ((limitPct - dailyLossPct) / limitPct) * 100));
  const dailyLoss: DailyLossGauge = {
    currentPct: dailyLossPct,
    limitPct,
    bufferPct,
    tier: classifyDailyLossTier(bufferPct),
  };

  const portfolioRisk = await evaluatePortfolioRisk();
  const sectorWeights = portfolioRisk.sectorWeights ?? {};
  const hhi = computeHhi(sectorWeights);
  const top = topSectorEntry(sectorWeights);
  const activePositions = Object.keys(sectorWeights).length > 0
    ? loadShadowTrades().filter((t) => isOpenShadowStatus(t.status)).length
    : 0;
  // 모든 포지션 sector 미설정 → '기타' 단일 키 fallback → false CRITICAL 차단 (NA 강등)
  const unknownOnly = isUnknownSectorOnly(sectorWeights);
  const sectorConcentration: SectorConcentrationGauge = {
    hhi,
    topSector: top.sector,
    topWeight: top.weight,
    activePositions,
    tier: classifySectorTier(hhi, activePositions, unknownOnly),
  };

  // Retired response fields remain only for older clients; no Kelly computation runs.
  const kellyConcordance: KellyConcordanceGauge = {
    status: 'RETIRED', ratio: null, currentAvgKelly: 0, recommendedKelly: 0, sampleSize: 0,
    tier: 'CALIBRATING', // Existing display contract; excluded from the account-risk verdict below.
  };

  return {
    dailyLoss,
    sectorConcentration,
    kellyConcordance,
    overallTier: composeOverallTier(dailyLoss.tier, sectorConcentration.tier, 'CALIBRATING'),
    capturedAt: now.toISOString(),
  };
}
