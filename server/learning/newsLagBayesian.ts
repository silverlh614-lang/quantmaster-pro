// @responsibility newsLagBayesian 학습 엔진 모듈
/**
 * newsLagBayesian.ts — 뉴스-수급 시차 분포 베이지안 사후 분포 학습 (P3-6 구현)
 *
 * 사용자 P3-6 의견:
 *   "뉴스 유형별 반응 시차 분포도를 자동 학습하는 베이지안 업데이트 모델"
 *   예: "미국 방산 수주 → 한국 방산주 → T+0.3 ± 0.8d (표본 47)"
 *
 * 모델: Normal-Inverse-Gamma conjugate prior on (μ, σ²)
 *   μ ~ N(μ₀, σ²/κ₀)
 *   σ² ~ Inv-Gamma(α₀, β₀)
 *
 * 관측치 X = {x₁, ..., xₙ} 에 대한 posterior:
 *   κₙ = κ₀ + n
 *   μₙ = (κ₀·μ₀ + n·x̄) / κₙ
 *   αₙ = α₀ + n/2
 *   βₙ = β₀ + ½·Σ(xᵢ - x̄)² + (κ₀·n·(x̄ - μ₀)²) / (2·κₙ)
 *
 * Predictive (다음 관측치 분포): t-분포(2αₙ) with mean μₙ and scale √(βₙ(κₙ+1)/(αₙ·κₙ))
 *
 * 이 모듈은 newsType + sector 조합별로 posterior 를 디스크에 영속화한다.
 * `recordReaction()` 호출 시마다 1회 업데이트되며, 같은 조합의 prior 는 누적된다.
 *
 * "lag" 의 정의:
 *   T+1·T+3·T+5 EWY/주가 변화율 중 절댓값이 가장 큰 시점을 "반응 피크 시점" 으로 간주.
 *   정수가 아니라 보간 — t1=0.3%, t3=2.5%, t5=1.2% 라면 t3 (=3일) 가 피크.
 *   더 정밀한 보간은 향후 Spline 도입 시 가능.
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../persistence/paths.js';

// ── 디스크 영속화 경로 ───────────────────────────────────────────────────────
export const NEWS_LAG_POSTERIOR_FILE = path.join(DATA_DIR, 'news-lag-posterior.json');

// ── 사전 분포 (uninformative-ish prior) ──────────────────────────────────────
//   μ₀ = 3 영업일 (T+3 가 직관적 중앙값)
//   κ₀ = 0.5 (관측 0.5개에 해당하는 약한 신뢰)
//   α₀ = 1.5, β₀ = 1.5 → 기대 분산 ≈ β₀/(α₀-1) = 3
const PRIOR_MU    = 3.0;
const PRIOR_KAPPA = 0.5;
const PRIOR_ALPHA = 1.5;
const PRIOR_BETA  = 1.5;

// ── 타입 ─────────────────────────────────────────────────────────────────────

export interface NormalInverseGamma {
  /** Posterior mean of μ (current best estimate of the lag in business days) */
  mu: number;
  /** Posterior pseudo-count for μ — 신뢰도 강도 */
  kappa: number;
  /** Posterior shape for σ² */
  alpha: number;
  /** Posterior scale for σ² */
  beta: number;
  /** Number of observations folded in */
  n: number;
}

export interface PosteriorEntry {
  /** "newsType:sector" 키 */
  key: string;
  newsType: string;
  sector: string;
  posterior: NormalInverseGamma;
  /** 마지막 관측 ISO 시각 */
  lastObservedAt: string;
  /** 관측 개수의 누적 (post.n 과 동일하지만 역사 추적용 별도 카운터) */
  totalObservations: number;
}

export interface PosteriorStore {
  version: 1;
  updatedAt: string;
  entries: Record<string, PosteriorEntry>;
}

const EMPTY_STORE: PosteriorStore = { version: 1, updatedAt: new Date(0).toISOString(), entries: {} };

// ── I/O ──────────────────────────────────────────────────────────────────────

export function loadPosteriorStore(): PosteriorStore {
  try {
    if (!fs.existsSync(NEWS_LAG_POSTERIOR_FILE)) return { ...EMPTY_STORE };
    const raw = JSON.parse(fs.readFileSync(NEWS_LAG_POSTERIOR_FILE, 'utf-8'));
    if (raw && raw.version === 1 && raw.entries) return raw as PosteriorStore;
    return { ...EMPTY_STORE };
  } catch {
    return { ...EMPTY_STORE };
  }
}

function savePosteriorStore(store: PosteriorStore): void {
  store.updatedAt = new Date().toISOString();
  fs.writeFileSync(NEWS_LAG_POSTERIOR_FILE, JSON.stringify(store, null, 2));
}

function makeKey(newsType: string, sector: string): string {
  return `${newsType.trim()}:${sector.trim()}`;
}

// ── Bayesian update — Normal-Inverse-Gamma ──────────────────────────────────

/**
 * 단일 관측치 lag (영업일 단위) 로 posterior 를 갱신한다.
 *
 * 단일 관측 시 표본 분산 항이 0 이므로 식이 단순해진다:
 *   κ' = κ + 1
 *   μ' = (κ·μ + lag) / κ'
 *   α' = α + 0.5
 *   β' = β + (κ · (lag - μ)²) / (2·κ')
 */
export function updatePosterior(prior: NormalInverseGamma, lag: number): NormalInverseGamma {
  const newKappa = prior.kappa + 1;
  const newMu    = (prior.kappa * prior.mu + lag) / newKappa;
  const newAlpha = prior.alpha + 0.5;
  const dev      = lag - prior.mu;
  const newBeta  = prior.beta + (prior.kappa * dev * dev) / (2 * newKappa);
  return { mu: newMu, kappa: newKappa, alpha: newAlpha, beta: newBeta, n: prior.n + 1 };
}

/**
 * Predictive distribution 의 평균과 95% 구간 (Student's t).
 *   X ~ t(2α) with mean μ, scale √(β(κ+1)/(α·κ))
 *   95% 구간 ≈ μ ± 1.96 · scale (대표본 근사). 표본이 5 미만이면 보수적으로 t(2α) 분위 미사용.
 */
export function predictiveSummary(post: NormalInverseGamma): {
  mean: number;
  std: number;
  ci95Low: number;
  ci95High: number;
  effectiveN: number;
} {
  // σ² 추정값 = β/(α-1) (α>1 일 때)
  const sigmaSq = post.alpha > 1 ? post.beta / (post.alpha - 1) : post.beta;
  const scaleSq = sigmaSq * (post.kappa + 1) / post.kappa;
  const std = Math.sqrt(Math.max(0, scaleSq));
  // 95% 구간 — n 작을 땐 t-분포가 더 두꺼운 꼬리이지만, 단순화 위해 1.96 사용
  // (운영 알림 용도로는 충분, 최소 표본 가드는 호출자가 책임)
  const z = 1.96;
  return {
    mean: post.mu,
    std,
    ci95Low:  post.mu - z * std,
    ci95High: post.mu + z * std,
    effectiveN: post.n,
  };
}

// ── 외부 API ─────────────────────────────────────────────────────────────────

/**
 * (newsType, sector) 조합에 새 lag 관측치를 베이지안 업데이트한다.
 * 영속화는 함수 내부에서 처리.
 *
 * @param lagBusinessDays - 0 이상의 실수. 0 이면 당일(T+0), 1 이면 다음 영업일.
 * @returns 갱신 후 PosteriorEntry
 */
export function recordLagObservation(
  newsType: string,
  sector: string,
  lagBusinessDays: number,
): PosteriorEntry {
  if (!Number.isFinite(lagBusinessDays) || lagBusinessDays < 0) {
    throw new Error(`invalid lag observation: ${lagBusinessDays}`);
  }
  const store = loadPosteriorStore();
  const key   = makeKey(newsType, sector);
  const prior = store.entries[key]?.posterior ?? {
    mu: PRIOR_MU, kappa: PRIOR_KAPPA, alpha: PRIOR_ALPHA, beta: PRIOR_BETA, n: 0,
  };
  const posterior = updatePosterior(prior, lagBusinessDays);
  const entry: PosteriorEntry = {
    key,
    newsType,
    sector,
    posterior,
    lastObservedAt: new Date().toISOString(),
    totalObservations: (store.entries[key]?.totalObservations ?? 0) + 1,
  };
  store.entries[key] = entry;
  savePosteriorStore(store);
  return entry;
}

/**
 * 운영자/엔진이 "지금 막 발생한 newsType + sector" 에 대해 최적 진입 윈도우를 조회.
 * 표본이 부족하면(n < 3) null 반환 — 호출자가 fallback 의사결정.
 */
export function getOptimalEntryWindow(newsType: string, sector: string): {
  newsType: string;
  sector: string;
  meanLagDays: number;
  stdDays: number;
  ci95LowDays: number;
  ci95HighDays: number;
  sampleSize: number;
} | null {
  const store = loadPosteriorStore();
  const entry = store.entries[makeKey(newsType, sector)];
  if (!entry || entry.posterior.n < 3) return null;
  const summary = predictiveSummary(entry.posterior);
  return {
    newsType,
    sector,
    meanLagDays:  Number(summary.mean.toFixed(2)),
    stdDays:      Number(summary.std.toFixed(2)),
    ci95LowDays:  Number(Math.max(0, summary.ci95Low).toFixed(2)),
    ci95HighDays: Number(summary.ci95High.toFixed(2)),
    sampleSize:   summary.effectiveN,
  };
}

/** 모든 학습된 entry 의 요약 — 전체 알파 카탈로그 노출용 (Telegram /news_patterns) */
export function listAllOptimalWindows(minSampleSize = 3): Array<NonNullable<ReturnType<typeof getOptimalEntryWindow>>> {
  const store = loadPosteriorStore();
  const out: Array<NonNullable<ReturnType<typeof getOptimalEntryWindow>>> = [];
  for (const e of Object.values(store.entries)) {
    if (e.posterior.n < minSampleSize) continue;
    const summary = predictiveSummary(e.posterior);
    out.push({
      newsType: e.newsType,
      sector: e.sector,
      meanLagDays:  Number(summary.mean.toFixed(2)),
      stdDays:      Number(summary.std.toFixed(2)),
      ci95LowDays:  Number(Math.max(0, summary.ci95Low).toFixed(2)),
      ci95HighDays: Number(summary.ci95High.toFixed(2)),
      sampleSize:   summary.effectiveN,
    });
  }
  return out.sort((a, b) => b.sampleSize - a.sampleSize);
}

// ── lag 추정 헬퍼 — T+1/T+3/T+5 변화율 → 피크 시점 ──────────────────────────

/**
 * T+1, T+3, T+5 시점의 변화율 (%) 중 절댓값이 최대인 시점을 "반응 피크 일수" 로 환산.
 * 셋 다 undefined 면 null.
 *
 * 더 정확히는 Spline 보간이 이상적이지만, 운영 가독성을 위해 가장 큰 점을 채택.
 */
export function inferLagFromTSeries(
  t1Change: number | undefined,
  t3Change: number | undefined,
  t5StockAvg: number | undefined,
): number | null {
  type Point = { day: number; absChange: number };
  const pts: Point[] = [];
  if (t1Change != null && Number.isFinite(t1Change)) pts.push({ day: 1, absChange: Math.abs(t1Change) });
  if (t3Change != null && Number.isFinite(t3Change)) pts.push({ day: 3, absChange: Math.abs(t3Change) });
  if (t5StockAvg != null && Number.isFinite(t5StockAvg)) pts.push({ day: 5, absChange: Math.abs(t5StockAvg) });
  if (pts.length === 0) return null;
  // 절댓값 0 인 점만 있으면 "반응 없음" → null (학습 표본에서 제외)
  if (pts.every(p => p.absChange === 0)) return null;
  pts.sort((a, b) => b.absChange - a.absChange);
  return pts[0].day;
}
