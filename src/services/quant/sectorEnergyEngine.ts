/**
 * sectorEnergyEngine.ts — 섹터 에너지 맵 & 로테이션 마스터 게이트
 *
 * 핵심 개념:
 *   KRX 12개 섹터 지수의 4주 수익률 × 0.4 + 거래량 증가율 × 0.3 + 외국인 집중도 × 0.3
 *   → Energy_Score = 가중합 × 계절성 배수
 *
 * 주도 섹터 (Top 3): Gate 2 통과 기준 -1 완화
 * 소외 섹터 (Bottom 3): 포지션 사이즈 40% 제한
 *
 * 계절성 보정:
 *   1월 (소형주): 소형주·코스닥 섹터 가중치 상향
 *   4~5월 (실적 시즌): 실적 민감 섹터 상향
 *   10~11월 (배당주 시즌): 금융·통신·유틸리티 상향
 */

import type {
  SectorEnergyInput,
  SectorEnergyScore,
  SectorEnergyResult,
  SectorTierResult,
  SectorTier,
  SeasonMonth,
} from '../../types/sectorEnergy';

// ─── 가중치 상수 ───────────────────────────────────────────────────────────────

const W_RETURN = 0.4;
const W_VOLUME = 0.3;
const W_FOREIGN = 0.3;

// ─── 계절성 배수 테이블 ─────────────────────────────────────────────────────────
// 섹터명 → [1월, 4~5월, 10~11월, 기타] 배수

const SEASONAL_MULTIPLIERS: Record<string, [number, number, number, number]> = {
  '반도체':          [1.0, 1.15, 1.05, 1.0],
  '이차전지':        [1.1, 1.10, 0.95, 1.0],
  '바이오/헬스케어': [1.2, 1.05, 1.10, 1.0],
  '인터넷/플랫폼':   [1.1, 1.10, 1.00, 1.0],
  '자동차':          [0.9, 1.15, 1.05, 1.0],
  '조선':            [1.0, 1.05, 1.05, 1.0],
  '방산':            [1.0, 1.05, 1.10, 1.0],
  '금융':            [0.9, 1.10, 1.20, 1.0],
  '유통/소비재':     [1.1, 1.00, 1.05, 1.0],
  '건설/부동산':     [0.9, 1.10, 0.95, 1.0],
  '에너지/화학':     [1.0, 1.05, 1.10, 1.0],
  '통신/유틸리티':   [0.9, 1.00, 1.25, 1.0],
};

// ─── 유틸리티 함수 ─────────────────────────────────────────────────────────────

/** 현재 월 기준 계절성 구분 반환 */
export function getSeasonMonth(month?: number): SeasonMonth {
  const m = month ?? new Date().getMonth() + 1; // 1-indexed
  if (m === 1) return 'JAN';
  if (m === 4 || m === 5) return 'APR_MAY';
  if (m === 10 || m === 11) return 'OCT_NOV';
  return 'OTHER';
}

/** 계절성 배수 조회 */
function getSeasonalMultiplier(sectorName: string, season: SeasonMonth): number {
  const arr = SEASONAL_MULTIPLIERS[sectorName] ?? [1.0, 1.0, 1.0, 1.0];
  const idx = { JAN: 0, APR_MAY: 1, OCT_NOV: 2, OTHER: 3 }[season];
  return arr[idx];
}

/**
 * 배열을 0–100 범위로 min-max 정규화한다.
 * 모든 값이 동일하면 50을 반환한다.
 */
function minMaxNormalize(values: number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 50);
  return values.map((v) => ((v - min) / (max - min)) * 100);
}

// ─── 핵심 공개 API ──────────────────────────────────────────────────────────────

/**
 * 섹터 에너지 점수 계산 및 주도/소외 섹터 분류.
 *
 * @param inputs - 섹터별 입력 데이터 배열
 * @param overrideMonth - 테스트용 월(1~12) 오버라이드
 */
export function evaluateSectorEnergy(
  inputs: SectorEnergyInput[],
  overrideMonth?: number,
): SectorEnergyResult {
  if (inputs.length === 0) {
    return {
      scores: [],
      leadingSectors: [],
      laggingSectors: [],
      neutralSectors: [],
      currentSeason: getSeasonMonth(overrideMonth),
      calculatedAt: new Date().toISOString(),
      summary: '입력 데이터 없음 — 섹터 데이터를 입력하세요.',
    };
  }

  const season = getSeasonMonth(overrideMonth);

  // ── 1단계: 각 섹터의 raw 가중합 계산 ──────────────────────────────────────
  // return4w와 volumeChangePct는 음수 가능; foreignConcentration은 0~100
  // 각 지표를 개별적으로 clamping하여 계산
  const rawScores = inputs.map((inp) => {
    const returnContrib = inp.return4w * W_RETURN;
    const volumeContrib = inp.volumeChangePct * W_VOLUME;
    const foreignContrib = inp.foreignConcentration * W_FOREIGN;
    const rawScore = returnContrib + volumeContrib + foreignContrib;
    const seasonalMultiplier = getSeasonalMultiplier(inp.name, season);
    return {
      name: inp.name,
      rawScore,
      returnContrib,
      volumeContrib,
      foreignContrib,
      seasonalMultiplier,
      energyScore: rawScore * seasonalMultiplier,
    };
  });

  // ── 2단계: energyScore를 0–100으로 정규화 ─────────────────────────────────
  const normalizedScores = minMaxNormalize(rawScores.map((r) => r.energyScore));

  const scores: SectorEnergyScore[] = rawScores.map((r, i) => ({
    ...r,
    score: parseFloat(normalizedScores[i].toFixed(1)),
  }));

  // ── 3단계: 점수 내림차순 정렬 + Top/Bottom 3 분류 ─────────────────────────
  const sorted = [...scores].sort((a, b) => b.score - a.score);
  const n = sorted.length;

  function getTier(rank: number): SectorTier {
    if (rank < 3) return 'LEADING';
    if (rank >= n - 3) return 'LAGGING';
    return 'NEUTRAL';
  }

  const tiers: SectorTierResult[] = sorted.map((s, rank) => {
    const tier = getTier(rank);
    return {
      name: s.name,
      energyScore: s.score,
      tier,
      gate2Adjustment: tier === 'LEADING' ? -1 : 0,
      positionSizeLimit: tier === 'LAGGING' ? 40 : 100,
    };
  });

  const leadingSectors = tiers.filter((t) => t.tier === 'LEADING');
  const laggingSectors = tiers.filter((t) => t.tier === 'LAGGING');
  const neutralSectors = tiers.filter((t) => t.tier === 'NEUTRAL');

  const topNames = leadingSectors.map((t) => t.name).join(', ');
  const botNames = laggingSectors.map((t) => t.name).join(', ');
  const summary =
    `주도 섹터: ${topNames || '없음'} | 소외 섹터: ${botNames || '없음'} | 계절: ${season}`;

  return {
    scores: sorted,
    leadingSectors,
    laggingSectors,
    neutralSectors,
    currentSeason: season,
    calculatedAt: new Date().toISOString(),
    summary,
  };
}

/**
 * 특정 종목의 섹터가 주도 섹터인지 판별하여 Gate 2 조정값 반환.
 * 주도 섹터면 -1, 그 외 0.
 */
export function getSectorGate2Adjustment(
  stockSectorName: string,
  result: SectorEnergyResult | null,
): number {
  if (!result) return 0;
  const tier = result.leadingSectors.find((t) => t.name === stockSectorName);
  return tier?.gate2Adjustment ?? 0;
}

/**
 * 특정 종목의 섹터 포지션 사이즈 상한 반환.
 * 소외 섹터면 40, 그 외 100.
 */
export function getSectorPositionLimit(
  stockSectorName: string,
  result: SectorEnergyResult | null,
): number {
  if (!result) return 100;
  const lag = result.laggingSectors.find((t) => t.name === stockSectorName);
  return lag?.positionSizeLimit ?? 100;
}
