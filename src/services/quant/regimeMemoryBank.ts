/**
 * @responsibility 레짐별 가중치 분리 영속 + feedbackLoop 분리 학습 헬퍼 (ADR-0024)
 *
 * EXPANSION/CRISIS 등 시장 국면별로 다른 조건이 알파를 만든다는 천재 아이디어 #2
 * 의 영속 레이어. 글로벌 weights 와 별개의 byRegime store + trade.entryRegime
 * 기반 분리 학습.
 */
import type { TradeRecord, FeedbackLoopResult } from '../../types/portfolio';
import { evaluateFeedbackLoop } from './feedbackLoopEngine';

export type RegimeKey =
  | 'RECOVERY'
  | 'EXPANSION'
  | 'SLOWDOWN'
  | 'RECESSION'
  | 'RANGE_BOUND'
  | 'UNCERTAIN'
  | 'CRISIS';

export const ALL_REGIMES: RegimeKey[] = [
  'RECOVERY', 'EXPANSION', 'SLOWDOWN', 'RECESSION',
  'RANGE_BOUND', 'UNCERTAIN', 'CRISIS',
];

const REGIME_WEIGHTS_KEY = 'k-stock-evolution-weights-by-regime';
const GLOBAL_WEIGHTS_KEY = 'k-stock-evolution-weights';

interface RegimeStore {
  byRegime: Partial<Record<RegimeKey, Record<number, number>>>;
}

function isDisabled(): boolean {
  if (typeof process === 'undefined' || !process.env) return false;
  return process.env.LEARNING_REGIME_BANK_DISABLED === 'true';
}

function readRegimeStore(): RegimeStore {
  if (typeof window === 'undefined') return { byRegime: {} };
  try {
    const raw = localStorage.getItem(REGIME_WEIGHTS_KEY);
    if (!raw) return { byRegime: {} };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.byRegime) {
      return { byRegime: {} };
    }
    return parsed as RegimeStore;
  } catch {
    return { byRegime: {} };
  }
}

function readGlobalWeights(): Record<number, number> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(GLOBAL_WEIGHTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const result: Record<number, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const numKey = parseInt(k, 10);
      if (!isNaN(numKey) && typeof v === 'number' && v >= 0.5 && v <= 1.5) {
        result[numKey] = v;
      }
    }
    return result;
  } catch {
    return {};
  }
}

function writeRegimeStore(store: RegimeStore): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(REGIME_WEIGHTS_KEY, JSON.stringify(store));
  } catch (e) {
    console.error('Failed to save regime weights:', e);
  }
}

/**
 * 특정 regime 의 weight map 을 반환한다.
 * regime 별 데이터 부재 또는 disable 시 글로벌 fallback.
 */
export function getEvolutionWeightsByRegime(
  regime: RegimeKey | null | undefined,
): Record<number, number> {
  if (isDisabled() || !regime) return readGlobalWeights();
  const store = readRegimeStore();
  const regimeWeights = store.byRegime[regime];
  return regimeWeights ?? readGlobalWeights();
}

/**
 * 특정 regime 의 weight map 을 저장한다.
 * disable 시 no-op.
 */
export function saveEvolutionWeightsByRegime(
  regime: RegimeKey,
  weights: Record<number, number>,
): void {
  if (isDisabled()) return;
  const store = readRegimeStore();
  store.byRegime[regime] = { ...weights };
  writeRegimeStore(store);
}

/**
 * 거래 기록을 regime 으로 필터링한 뒤 feedbackLoop 학습 실행.
 *
 * @param closedTrades 전체 종료 거래
 * @param regime 학습 대상 regime (null/undefined → 전체 학습 = 기존 동작)
 * @param currentWeights regime 별 현재 가중치 (글로벌 fallback)
 */
export function evaluateFeedbackLoopByRegime(
  closedTrades: TradeRecord[],
  regime: RegimeKey | null | undefined,
  currentWeights: Record<number, number> = {},
): FeedbackLoopResult {
  if (isDisabled() || !regime) {
    return evaluateFeedbackLoop(closedTrades, currentWeights);
  }
  const filtered = closedTrades.filter(t => t.entryRegime === regime);
  return evaluateFeedbackLoop(filtered, currentWeights);
}

/**
 * 모든 regime 의 학습을 일괄 실행 — 야간 배치 / UI 진단용.
 * 각 regime 별로 독립 saveEvolutionWeightsByRegime.
 */
export function evaluateAllRegimes(
  closedTrades: TradeRecord[],
): Partial<Record<RegimeKey, FeedbackLoopResult>> {
  const result: Partial<Record<RegimeKey, FeedbackLoopResult>> = {};
  for (const regime of ALL_REGIMES) {
    const filtered = closedTrades.filter(t => t.entryRegime === regime);
    if (filtered.length === 0) continue;
    const currentWeights = getEvolutionWeightsByRegime(regime);
    result[regime] = evaluateFeedbackLoop(filtered, currentWeights);
  }
  return result;
}

/** 테스트용 reset. */
export function __resetRegimeBankForTests(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(REGIME_WEIGHTS_KEY);
  } catch { /* ignore */ }
}
