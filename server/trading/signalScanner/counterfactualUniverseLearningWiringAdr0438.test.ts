/**
 * @responsibility ADR-0438 (= 사용자 명시 ADR-0442) 회귀 — `buildCandidateSummaries` invalid filter.
 *
 * 사용자 핵심 의도: invalid code 는 universe learning ledger 에 영구 박제 절대 금지.
 * NON_NUMERIC / INVALID_LENGTH / EMPTY 모두 skip + valid candidate 는 보존.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildCandidateSummaries } from './counterfactualUniverseLearningWiring.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('ADR-0438 buildCandidateSummaries — invalid code skip', () => {
  it('"0011TO" (NON_NUMERIC) → skip', () => {
    const result = buildCandidateSummaries([
      { symbol: '0011TO', name: '체비', lastPrice: 1000 },
    ]);
    expect(result).toHaveLength(0);
  });

  it('"ABCDEF" (NON_NUMERIC) → skip', () => {
    const result = buildCandidateSummaries([
      { symbol: 'ABCDEF', name: '잘못된종목' },
    ]);
    expect(result).toHaveLength(0);
  });

  it('"5930" (INVALID_LENGTH) → skip', () => {
    const result = buildCandidateSummaries([
      { symbol: '5930', name: '4자리 종목' },
    ]);
    expect(result).toHaveLength(0);
  });

  it('빈 symbol 또는 매핑된 stockCode 미보유 → skip', () => {
    const result = buildCandidateSummaries([
      { name: 'symbol 부재' },
      { symbol: '', name: '빈 symbol' },
    ]);
    expect(result).toHaveLength(0);
  });
});

describe('ADR-0438 buildCandidateSummaries — valid candidate 보존', () => {
  it('"005930" (정상) → 보존', () => {
    const result = buildCandidateSummaries([
      { symbol: '005930', name: '삼성전자', lastPrice: 75000 },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].symbol).toBe('005930');
    expect(result[0].name).toBe('삼성전자');
    expect(result[0].lastPrice).toBe(75000);
  });

  it('"005930.KS" suffix 포함 → symbol 그대로 보존 (정규화 통과)', () => {
    const result = buildCandidateSummaries([
      { symbol: '005930.KS', name: '삼성전자' },
    ]);
    // ADR-0438 invariant: SUFFIX_STRIPPED 도 valid 분기 → summary 보존.
    // symbol 필드 자체는 raw 보존 (ledger 영속용).
    expect(result).toHaveLength(1);
    expect(result[0].symbol).toBe('005930.KS');
  });
});

describe('ADR-0438 buildCandidateSummaries — 다중 invalid + valid mix', () => {
  it('5건 입력 (invalid 3 + valid 2) → valid 2건만 보존', () => {
    const result = buildCandidateSummaries([
      { symbol: '0011TO', name: 'invalid 1' },
      { symbol: '005930', name: '삼성전자' },
      { symbol: 'ABCDEF', name: 'invalid 2' },
      { symbol: '247540', name: '에코프로비엠' },
      { symbol: '5930', name: 'invalid 3' },
    ]);
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.symbol).sort()).toEqual(['005930', '247540']);
  });

  it('rank 부여 — invalid skip 후에도 i+1 기반', () => {
    const result = buildCandidateSummaries([
      { symbol: '0011TO', name: 'invalid' },
      { symbol: '005930', name: '삼성전자' },
    ]);
    // invalid skip 후 valid 만 남음. rank 는 호출자가 명시하지 않으면 i+1.
    expect(result).toHaveLength(1);
    expect(result[0].symbol).toBe('005930');
    // i=1 기준 rank=2 (invalid 도 index 차지)
    expect(result[0].rank).toBe(2);
  });
});

describe('ADR-0438 정적 grep 가드 — wiring 정합', () => {
  function readSrc(relPath: string): string {
    return readFileSync(join(__dirname, relPath), 'utf-8');
  }

  it('counterfactualUniverseLearningWiring.ts: normalizeKrxCodeSsot import 존재', () => {
    const src = readSrc('counterfactualUniverseLearningWiring.ts');
    expect(src).toMatch(
      /import\s*\{\s*normalizeKrxCode\s+as\s+normalizeKrxCodeSsot\s*\}\s+from\s+['"]\.\.\/\.\.\/utils\/symbolNormalizer\.js['"]/,
    );
  });

  it('counterfactualUniverseLearningWiring.ts: ADR-0438 추적 주석', () => {
    const src = readSrc('counterfactualUniverseLearningWiring.ts');
    expect(src).toMatch(/ADR-0438/);
  });

  it('counterfactualUniverseLearningWiring.ts: buildCandidateSummaries 안에 invalid filter 존재', () => {
    const src = readSrc('counterfactualUniverseLearningWiring.ts');
    expect(src).toMatch(/normalizeKrxCodeSsot\(symbol\)/);
    expect(src).toMatch(/!normalized\.valid.*continue/s);
  });

  it('counterfactualUniverseLearningWiring.ts: KIS 주문 함수 import 0건', () => {
    const src = readSrc('counterfactualUniverseLearningWiring.ts');
    expect(src).not.toMatch(/placeKisMarketBuyOrder/);
    expect(src).not.toMatch(/placeKisSellOrder/);
    expect(src).not.toMatch(/cancelKisOrder/);
  });
});
