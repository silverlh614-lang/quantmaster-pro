// @responsibility perSymbolEvaluation 4 매수 site entryConditionScores wiring 정적 가드 (PR-1, ADR-0006)
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const SOURCE = fs.readFileSync(
  path.join(__dirname, 'perSymbolEvaluation.ts'),
  'utf-8',
);

describe('perSymbolEvaluation 4 매수 site entryConditionScores 정적 wiring (PR-1)', () => {
  it('buildEntryConditionScores import 존재', () => {
    expect(SOURCE).toMatch(
      /import\s*\{\s*buildEntryConditionScores\s*\}\s*from\s*['"]\.\.\/\.\.\/learning\/entryConditionScores\.js['"]/,
    );
  });

  it('site 1 (PRE_BREAKOUT_FOLLOWTHROUGH) — buildEntryConditionScores(["PRE_BREAKOUT_FOLLOWTHROUGH"]) 호출', () => {
    expect(SOURCE).toMatch(
      /entryConditionScores:\s*buildEntryConditionScores\(\['PRE_BREAKOUT_FOLLOWTHROUGH'\]\)/,
    );
  });

  it('site 2 (PRE_BREAKOUT) — buildEntryConditionScores(["PRE_BREAKOUT"]) 호출', () => {
    expect(SOURCE).toMatch(
      /entryConditionScores:\s*buildEntryConditionScores\(\['PRE_BREAKOUT'\]\)/,
    );
  });

  it('site 3 (메인 buyList) — buildEntryConditionScores(stock.conditionKeys ?? []) 호출 (진짜 27조건 baseline)', () => {
    expect(SOURCE).toMatch(
      /entryConditionScores:\s*buildEntryConditionScores\(stock\.conditionKeys\s*\?\?\s*\[\]\)/,
    );
  });

  it('site 4 (INTRADAY_STRONG) — buildEntryConditionScores(["INTRADAY_STRONG"]) 호출', () => {
    expect(SOURCE).toMatch(
      /entryConditionScores:\s*buildEntryConditionScores\(\['INTRADAY_STRONG'\]\)/,
    );
  });

  it('전체 — 4 site 모두 entryConditionScores 인자 전달 (정확히 4건)', () => {
    const matches = SOURCE.match(/entryConditionScores:\s*buildEntryConditionScores/g) ?? [];
    expect(matches.length).toBe(4);
  });

  it('ADR-0006 PR-19 baseline 주석 모든 매수 site 부착 (drift 차단 가드)', () => {
    // 4 매수 site 모두 ADR-0006 PR-19 baseline 마커 인근에 buildEntryConditionScores 호출
    const baselineMarkers = SOURCE.match(/ADR-0006 PR-19 baseline \(PR-1\)/g) ?? [];
    expect(baselineMarkers.length).toBeGreaterThanOrEqual(4);
  });

  it('회귀 차단 — buildBuyTrade 호출이 5건 (1 import + 4 site 호출 — 후속 PR 추가 시 이 단언 갱신)', () => {
    const callsiteMatches = SOURCE.match(/buildBuyTrade\(/g) ?? [];
    // 라인 109 (import) 는 매치 안됨 (괄호 부재). 4 site 호출만 매치.
    expect(callsiteMatches.length).toBe(4);
  });
});
