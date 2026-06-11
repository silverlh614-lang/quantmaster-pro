// @responsibility ADR-0597 Gate1 횡단면 percentile shadow 보조점수 순수 산출 — 스캔 내 상대 순위 관측 전용 (Gate 판정·임계 무관여).

/** 시장 신호 블록 6종 — 상수/맥락 블록(WATCHLIST_PRIORITY·MARKET_REGIME·SUPPLY·INVESTOR_FLOW·
 *  SECTOR)을 제외한, 종목 변별력을 실제로 담는 컴포넌트 (리뷰 2026-06-11 §1.1). */
export const GATE1_MARKET_SIGNAL_COMPONENT_CODES = [
  'PRICE_MOMENTUM',
  'TECHNICAL_TREND',
  'VOLUME_LIQUIDITY',
  'RELATIVE_STRENGTH',
  'WATCHLIST_UPSTREAM_SCORE',
  'BREAKOUT_STRUCTURE',
] as const;

const MARKET_CODES: ReadonlySet<string> = new Set(GATE1_MARKET_SIGNAL_COMPONENT_CODES);

export interface Gate1CrossSectionalInputRow {
  symbol: string;
  name?: string;
  actualScore: number;
  positiveComponents?: ReadonlyArray<{ code: string; weightedScore: number }>;
}

export interface Gate1CrossSectionalSymbolScore {
  symbol: string;
  name?: string;
  totalScore: number;
  /** 시장 신호 블록 합 (≥0 clamp). 컴포넌트 부재 시 null — 결손은 0점이 아니다 (불변식 #6). */
  marketBlockScore: number | null;
  /** 스캔 내 midrank 백분위 0~100 (동률 0.5 가중, n=1 → 50). */
  totalPercentile: number;
  marketBlockPercentile: number | null;
  /** 1 = totalScore 최고. */
  rank: number;
}

export interface Gate1CrossSectionalShadowReportAdr0597 {
  candidates: number;
  /** totalScore 내림차순. */
  scores: Gate1CrossSectionalSymbolScore[];
  totalScoreMedian: number | null;
  totalScoreMax: number | null;
  marketBlockMedian: number | null;
  marketBlockMax: number | null;
  topSymbols: string[];
  executionImpact: 'NONE';
  thresholdAutoChanged: false;
  operatorApprovalRequired: true;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return round1(sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
}

/** midrank 백분위 — (strictlyBelow + 0.5×(동률−1)) / (n−1) × 100. n=1 은 중앙(50) 고정. */
function midrankPercentile(value: number, all: readonly number[]): number {
  if (all.length <= 1) return 50;
  let below = 0;
  let ties = 0;
  for (const other of all) {
    if (other < value) below += 1;
    else if (other === value) ties += 1;
  }
  return round1(((below + (ties - 1) * 0.5) / (all.length - 1)) * 100);
}

function marketBlockScoreOf(row: Gate1CrossSectionalInputRow): number | null {
  const components = (row.positiveComponents ?? []).filter((c) => MARKET_CODES.has(c.code));
  if (components.length === 0) return null;
  return round1(components.reduce((sum, c) => sum + Math.max(0, c.weightedScore), 0));
}

export function buildGate1CrossSectionalShadowReportAdr0597(
  rows: readonly Gate1CrossSectionalInputRow[],
): Gate1CrossSectionalShadowReportAdr0597 {
  const valid = rows.filter((row) => row.symbol && finite(row.actualScore));
  const totals = valid.map((row) => row.actualScore);
  const marketByIndex = valid.map(marketBlockScoreOf);
  const marketValues = marketByIndex.filter(finite);
  const scores: Gate1CrossSectionalSymbolScore[] = valid
    .map((row, index) => {
      const marketBlockScore = marketByIndex[index];
      return {
        symbol: row.symbol,
        ...(row.name ? { name: row.name } : {}),
        totalScore: round1(row.actualScore),
        marketBlockScore,
        totalPercentile: midrankPercentile(row.actualScore, totals),
        marketBlockPercentile:
          marketBlockScore === null ? null : midrankPercentile(marketBlockScore, marketValues),
        rank: 0,
      };
    })
    .sort((a, b) => b.totalScore - a.totalScore)
    .map((score, index) => ({ ...score, rank: index + 1 }));
  return {
    candidates: valid.length,
    scores,
    totalScoreMedian: median(totals),
    totalScoreMax: totals.length > 0 ? round1(Math.max(...totals)) : null,
    marketBlockMedian: median(marketValues),
    marketBlockMax: marketValues.length > 0 ? round1(Math.max(...marketValues)) : null,
    topSymbols: scores.slice(0, 5).map((score) => score.symbol),
    executionImpact: 'NONE',
    thresholdAutoChanged: false,
    operatorApprovalRequired: true,
  };
}
