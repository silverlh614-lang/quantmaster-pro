// @responsibility 보유 종목 일별 수익률 → Pearson 상관계수 매트릭스 순수 함수 (PR-N)

/**
 * 일별 close 가격 배열 → 일별 수익률 배열 (log return).
 * 길이 1 이하 → 빈 배열.
 */
export function dailyReturns(closes: ReadonlyArray<number>): number[] {
  if (closes.length < 2) return [];
  const result: number[] = [];
  for (let i = 1; i < closes.length; i += 1) {
    const prev = closes[i - 1];
    const curr = closes[i];
    if (!Number.isFinite(prev) || !Number.isFinite(curr) || prev <= 0 || curr <= 0) {
      result.push(0);
      continue;
    }
    result.push(Math.log(curr / prev));
  }
  return result;
}

/**
 * Pearson 상관계수.
 * 표본 < 2 또는 분산 0 → null (정의 불가).
 */
export function pearsonCorrelation(
  a: ReadonlyArray<number>,
  b: ReadonlyArray<number>,
): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 2) return null;

  let sumA = 0, sumB = 0;
  for (let i = 0; i < n; i += 1) {
    sumA += a[i];
    sumB += b[i];
  }
  const meanA = sumA / n;
  const meanB = sumB / n;

  let cov = 0, varA = 0, varB = 0;
  for (let i = 0; i < n; i += 1) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }

  if (varA === 0 || varB === 0) return null;
  return cov / Math.sqrt(varA * varB);
}

export interface CorrelationMatrix {
  symbols: string[];
  /** matrix[i][j] = symbols[i] vs symbols[j] 상관계수, null = 정의 불가 */
  matrix: Array<Array<number | null>>;
}

/**
 * symbol → 일별 수익률 배열 매핑 → NxN 상관계수 매트릭스.
 *
 * - 길이 다른 배열은 짧은 길이 기준 align (pearsonCorrelation 내부 처리)
 * - i==j → 1.0 (자기 자신)
 * - 한쪽이라도 분산 0 → null
 */
export function correlationMatrix(
  returnsBySymbol: Record<string, ReadonlyArray<number>>,
): CorrelationMatrix {
  const symbols = Object.keys(returnsBySymbol);
  const n = symbols.length;
  const matrix: Array<Array<number | null>> = [];

  for (let i = 0; i < n; i += 1) {
    const row: Array<number | null> = [];
    for (let j = 0; j < n; j += 1) {
      if (i === j) {
        row.push(1);
        continue;
      }
      // i,j 와 j,i 같은 값이지만 단순화 위해 매 셀 계산
      row.push(pearsonCorrelation(returnsBySymbol[symbols[i]], returnsBySymbol[symbols[j]]));
    }
    matrix.push(row);
  }

  return { symbols, matrix };
}

export type CorrelationTone = 'STRONG_POS' | 'POS' | 'NEUTRAL' | 'NEG' | 'STRONG_NEG' | 'UNDEF';

export function classifyCorrelation(coef: number | null): CorrelationTone {
  if (coef == null || !Number.isFinite(coef)) return 'UNDEF';
  if (coef >= 0.7) return 'STRONG_POS';
  if (coef >= 0.4) return 'POS';
  if (coef <= -0.7) return 'STRONG_NEG';
  if (coef <= -0.4) return 'NEG';
  return 'NEUTRAL';
}
