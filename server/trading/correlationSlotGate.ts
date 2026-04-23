/**
 * correlationSlotGate.ts — Idea 5: Correlation-Aware Slot Allocation.
 *
 * "개수 기반 슬롯 한도" 를 "독립성 기반 슬롯 한도" 로 전환. 이미 보유한 포지션과
 * 평균 상관계수 (또는 섹터 프록시 기반 근사값) 가 THRESHOLD 이상이면 신규 진입 차단.
 *
 * 배경:
 *   - portfolioRiskEngine.ts 의 checkCorrelation 은 same-sector→0.8 프록시를 사용.
 *   - 본 게이트는 그 프록시를 "후보 vs 기존 포지션" 방향으로 재활용해 게이팅까지 수행.
 *   - 진짜 피어슨 상관을 계산하려면 일별 수익률 히스토리 DB 가 필요 — 현 단계에서는
 *     섹터 기반 휴리스틱으로 시작하고 계약·유지 비용 없는 범위에서 점진 고도화 가능.
 *
 * 철학:
 *   - 실효 독립 샘플 = n / (1 + (n-1)ρ̄). n=5, ρ̄=0.6 → 실효 2.3개. n=5, ρ̄=0.2 → 실효 4.5.
 *   - 포지션 개수만 늘리는 건 독립 샘플 수를 늘리지 못한다.
 */

import { loadShadowTrades } from '../persistence/shadowTradeRepo.js';
import { isOpenShadowStatus } from './entryEngine.js';
import { getSectorByCode } from '../screener/sectorMap.js';

/**
 * 신규 진입 차단 평균 상관 임계. 후보와 기존 포지션의 평균 페어와이즈 상관이
 * 이 값 이상이면 게이트 차단. 0.4 = 대략 같은 섹터 1/2 허용선 (섹터 프록시 0.8 기준).
 */
export const CORRELATION_BLOCK_THRESHOLD = Number(process.env.CORRELATION_BLOCK_THRESHOLD ?? '0.4');

/** 섹터 일치 → 상관 프록시 (portfolioRiskEngine 과 정합). */
const SAME_SECTOR_RHO = 0.8;
/** 섹터 불일치 → 낮은 기저 상관. */
const DIFFERENT_SECTOR_RHO = 0.15;

export interface CorrelationGateInput {
  candidateCode: string;
  candidateSector?: string | null;
  /** 테스트용 — 미주입 시 loadShadowTrades() */
  trades?: Array<{ stockCode: string; status: string }>;
}

export interface CorrelationGateResult {
  /** 허용 여부 */
  allowed: boolean;
  /** 후보 vs 기존 포지션 평균 상관 추정 (0~1) */
  avgCorrelation: number;
  /** 기준 임계 */
  threshold: number;
  /** 기존 포지션 수 */
  existingCount: number;
  /** 실효 독립 샘플 수 (Kish 공식) — 현재 포트폴리오 기준 */
  effectiveIndependentCount: number;
  /** 차단/허용 사유 */
  reason: string;
}

function pairwiseCorrelation(codeA: string, sectorA: string, codeB: string, sectorB: string): number {
  if (codeA === codeB) return 1;
  if (sectorA && sectorB && sectorA === sectorB && sectorA !== '기타' && sectorA !== '미분류') {
    return SAME_SECTOR_RHO;
  }
  return DIFFERENT_SECTOR_RHO;
}

/**
 * 포트폴리오의 실효 독립 샘플 수 (Kish): n / (1 + (n-1) ρ̄).
 * ρ̄ 는 모든 페어와이즈 상관의 평균.
 */
export function effectiveIndependentCount(codes: string[]): number {
  const n = codes.length;
  if (n <= 1) return n;
  const sectors = codes.map(c => getSectorByCode(c) || '미분류');
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      sum += pairwiseCorrelation(codes[i], sectors[i], codes[j], sectors[j]);
      pairs++;
    }
  }
  const rhoBar = pairs > 0 ? sum / pairs : 0;
  return n / (1 + (n - 1) * rhoBar);
}

/**
 * 후보가 기존 포지션과 얼마나 독립적인지 평가하여 신규 진입 허용 여부를 결정.
 * 기존 포지션이 0~1개일 때는 무조건 허용 (비교 기준 없음).
 */
export function evaluateCorrelationGate(input: CorrelationGateInput): CorrelationGateResult {
  const trades = input.trades ?? loadShadowTrades();
  const open = trades
    .filter(t => isOpenShadowStatus(t.status as any) && t.stockCode !== input.candidateCode);
  const existingCount = open.length;

  if (existingCount < 2) {
    return {
      allowed: true,
      avgCorrelation: 0,
      threshold: CORRELATION_BLOCK_THRESHOLD,
      existingCount,
      effectiveIndependentCount: existingCount,
      reason: existingCount === 0
        ? '기존 포지션 없음 — 독립성 게이트 비적용'
        : '기존 포지션 1개 — 최소 비교 쌍 부족, 허용',
    };
  }

  const candidateSector = input.candidateSector ?? getSectorByCode(input.candidateCode) ?? '미분류';
  let sum = 0;
  for (const t of open) {
    const sec = getSectorByCode(t.stockCode) ?? '미분류';
    sum += pairwiseCorrelation(input.candidateCode, candidateSector, t.stockCode, sec);
  }
  const avgCorrelation = sum / existingCount;

  const currentEffective = effectiveIndependentCount(open.map(t => t.stockCode));

  const allowed = avgCorrelation < CORRELATION_BLOCK_THRESHOLD;
  const reason = allowed
    ? `후보 vs 기존 ρ̄=${avgCorrelation.toFixed(2)} < ${CORRELATION_BLOCK_THRESHOLD} — 독립성 충족`
    : `후보 vs 기존 ρ̄=${avgCorrelation.toFixed(2)} ≥ ${CORRELATION_BLOCK_THRESHOLD} — 고상관 중복 진입 차단` +
      ` (현재 실효 독립 ${currentEffective.toFixed(1)} / 실 개수 ${existingCount})`;

  return {
    allowed,
    avgCorrelation,
    threshold: CORRELATION_BLOCK_THRESHOLD,
    existingCount,
    effectiveIndependentCount: currentEffective,
    reason,
  };
}
