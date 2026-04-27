/**
 * @responsibility VCP Score + Latent Catalyst Score 산출 — 사전 신호 정량화 SSOT
 *
 * ADR-0030 (PR-N, 페어 D): 페어 A (PR-L+M) 가 사후 측정이라면, 본 모듈은 사전
 * 신호. Mark Minervini 식 VCP 4조건 + 외인/기관 수급 5일 누적 z-score 합성.
 * 순수 함수 — 외부 호출 0, 영속 0, 부작용 0. 입력은 호출자 책임.
 *
 * preBreakoutAccumulationDetector 와 다른 차원: 매집 패턴 vs 변동성 압축.
 */

// ─── VCP Score (Volatility Contraction Pattern) ──────────────────────────────

export interface VcpInput {
  /** 5주/3주/1주 평균 ATR (단위 무관, 동일 단위) */
  atr5w: number;
  atr3w: number;
  atr1w: number;
  /** 5주/3주/1주 평균 거래량 */
  vol5w: number;
  vol3w: number;
  vol1w: number;
  /** 상대강도 0~100 (KOSPI 대비 분위) */
  relativeStrength: number;
  /** 종가 / 200일 이동평균 — 1.0 초과 = MA200 위 */
  priceMa200Ratio: number;
}

export interface VcpScoreResult {
  /** 0~100, 4 sub-criteria 각 25점 */
  score: number;
  /** ATR 단조감소 (atr5w > atr3w > atr1w) */
  atrContracting: boolean;
  /** 거래량 단조감소 */
  volumeDrying: boolean;
  /** RS ≥ 80 */
  strongRs: boolean;
  /** MA200 위 */
  aboveMa200: boolean;
  /** 4=A, 3=B, 2=C, 그 외 NONE */
  grade: 'A' | 'B' | 'C' | 'NONE';
}

/** RS 강함 임계 */
export const VCP_RS_THRESHOLD = 80;

/**
 * VCP 4조건 점수화. NaN/Infinity 입력은 false 처리 안전 fallback.
 */
export function computeVcpScore(input: VcpInput): VcpScoreResult {
  const validNum = (v: number) => Number.isFinite(v) && v > 0;

  // ATR 단조감소 — 모든 값이 양수이고 atr5w > atr3w > atr1w
  const atrContracting =
    validNum(input.atr5w) && validNum(input.atr3w) && validNum(input.atr1w) &&
    input.atr5w > input.atr3w && input.atr3w > input.atr1w;

  // 거래량 단조감소 — 동일
  const volumeDrying =
    validNum(input.vol5w) && validNum(input.vol3w) && validNum(input.vol1w) &&
    input.vol5w > input.vol3w && input.vol3w > input.vol1w;

  // RS ≥ 80
  const strongRs =
    Number.isFinite(input.relativeStrength) && input.relativeStrength >= VCP_RS_THRESHOLD;

  // MA200 위 (priceMa200Ratio > 1.0)
  const aboveMa200 =
    Number.isFinite(input.priceMa200Ratio) && input.priceMa200Ratio > 1.0;

  const passCount =
    (atrContracting ? 1 : 0) +
    (volumeDrying ? 1 : 0) +
    (strongRs ? 1 : 0) +
    (aboveMa200 ? 1 : 0);

  const score = passCount * 25;

  let grade: VcpScoreResult['grade'];
  if (passCount === 4) grade = 'A';
  else if (passCount === 3) grade = 'B';
  else if (passCount === 2) grade = 'C';
  else grade = 'NONE';

  return { score, atrContracting, volumeDrying, strongRs, aboveMa200, grade };
}

// ─── Latent Catalyst Score ───────────────────────────────────────────────────

export interface LatentCatalystInput {
  /** 외국인 5일 누적 순매수 z-score (호출자가 사전 계산, 단위: 표준편차) */
  foreignNetBuy5dZ: number;
  /** 기관 5일 누적 순매수 z-score */
  institutionalNetBuy5dZ: number;
  /** 거래량 5/10/20일 단조증가 점수 0~10 (호출자가 사전 계산) */
  volumeProgression: number;
  /** 5일 변동성 z-score — 음수 = 변동성 정상화 (사전 신호) */
  volatility5dZ: number;
}

export interface LatentCatalystResult {
  /** -3 ~ +5 합성 점수 (clamp 없음, 산식 결과 그대로) */
  score: number;
  /** ≥ +1.5 = LATENT_CATALYST / +0.5 ~ +1.5 = WEAK_SIGNAL / 그 외 NONE */
  tag: 'LATENT_CATALYST' | 'WEAK_SIGNAL' | 'NONE';
  components: {
    foreignContribution: number;
    institutionalContribution: number;
    volumeContribution: number;
    volatilityContribution: number;
  };
}

/** Latent Catalyst 태그 임계 */
export const LATENT_CATALYST_THRESHOLD = 1.5;
/** 약한 신호 임계 */
export const WEAK_SIGNAL_THRESHOLD = 0.5;

const safeNum = (v: number, fallback = 0) =>
  Number.isFinite(v) ? v : fallback;

/**
 * 4축 합성 점수.
 * score = (foreignZ + institutionalZ + volumeProg/10×2 - volatilityZ) / 4
 *
 * - 외인/기관 z 가 양수면 매수 우위 — 점수 상승
 * - 거래량 단조증가 점수 (0~10) 는 0~2 범위로 정규화
 * - 변동성 z 가 음수 (정상화) 면 점수 상승 (부호 역전)
 */
export function computeLatentCatalystScore(
  input: LatentCatalystInput,
): LatentCatalystResult {
  const foreignContribution = safeNum(input.foreignNetBuy5dZ);
  const institutionalContribution = safeNum(input.institutionalNetBuy5dZ);
  const volumeContribution = safeNum(input.volumeProgression) / 10 * 2;
  const volatilityContribution = -safeNum(input.volatility5dZ); // 음수면 +기여

  const raw = (foreignContribution + institutionalContribution +
               volumeContribution + volatilityContribution) / 4;
  const score = Number(raw.toFixed(3));

  let tag: LatentCatalystResult['tag'];
  if (score >= LATENT_CATALYST_THRESHOLD) tag = 'LATENT_CATALYST';
  else if (score >= WEAK_SIGNAL_THRESHOLD) tag = 'WEAK_SIGNAL';
  else tag = 'NONE';

  return {
    score,
    tag,
    components: {
      foreignContribution: Number(foreignContribution.toFixed(3)),
      institutionalContribution: Number(institutionalContribution.toFixed(3)),
      volumeContribution: Number(volumeContribution.toFixed(3)),
      volatilityContribution: Number(volatilityContribution.toFixed(3)),
    },
  };
}

// ─── 통합 등급 ───────────────────────────────────────────────────────────────

export interface CombinedSignalGrade {
  /** VCP A + Latent ≥ +1.5 = STRONG_PRE_BREAKOUT (양 신호 결합) */
  combined: 'STRONG_PRE_BREAKOUT' | 'PRE_BREAKOUT' | 'WATCH' | 'NONE';
}

/**
 * 두 점수 결합 등급:
 *  - VCP=A + Latent=LATENT_CATALYST → STRONG_PRE_BREAKOUT (즉시 진입 후보)
 *  - VCP=A 또는 Latent=LATENT_CATALYST 단독 → PRE_BREAKOUT (관찰 강화)
 *  - VCP=B/C 또는 Latent=WEAK_SIGNAL → WATCH (예비 등록)
 *  - 그 외 → NONE
 */
export function combinedSignalGrade(
  vcp: VcpScoreResult,
  latent: LatentCatalystResult,
): CombinedSignalGrade {
  const vcpStrong = vcp.grade === 'A';
  const latentStrong = latent.tag === 'LATENT_CATALYST';
  const vcpModerate = vcp.grade === 'B' || vcp.grade === 'C';
  const latentModerate = latent.tag === 'WEAK_SIGNAL';

  let combined: CombinedSignalGrade['combined'];
  if (vcpStrong && latentStrong) combined = 'STRONG_PRE_BREAKOUT';
  else if (vcpStrong || latentStrong) combined = 'PRE_BREAKOUT';
  else if (vcpModerate || latentModerate) combined = 'WATCH';
  else combined = 'NONE';

  return { combined };
}
