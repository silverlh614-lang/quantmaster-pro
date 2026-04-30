/**
 * @responsibility shadowRouter POST entryConditionScores propagate 정적 가드
 *
 * /api/auto-trade/shadow-trades 클라이언트 동기화 경로에서 baseline 영속
 * 누락 차단. 자동매매 buildBuyTrade (perSymbolEvaluation) 와 정합. ADR-0006.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const SOURCE = fs.readFileSync(
  path.join(__dirname, 'shadowRouter.ts'),
  'utf-8',
);

describe('shadowRouter POST entryConditionScores propagate (정적 가드, PR 2)', () => {
  it('serverTrade 객체에 entryConditionScores 조건부 propagate 존재', () => {
    expect(SOURCE).toMatch(
      /\.{3}\(trade\.entryConditionScores[\s\S]*?entryConditionScores:\s*trade\.entryConditionScores/,
    );
  });

  it('빈 객체 / 미전달 시 미영속 (학습 오염 차단)', () => {
    // Object.keys(...).length > 0 가드 존재
    expect(SOURCE).toMatch(
      /trade\.entryConditionScores[\s\S]*?Object\.keys\([^)]*entryConditionScores[^)]*\)\.length\s*>\s*0/,
    );
  });

  it('typeof object 가드 존재 (string/number 거짓 입력 차단)', () => {
    expect(SOURCE).toMatch(/typeof\s+trade\.entryConditionScores\s*===\s*['"]object['"]/);
  });

  it('ADR-0006 PR-2/3 주석 마커 존재', () => {
    expect(SOURCE).toMatch(/ADR-0006\s*\(PR-2\/3\)/);
  });

  it('Record<number, number> 타입 단언으로 propagate (학습 입력 정합)', () => {
    expect(SOURCE).toMatch(
      /entryConditionScores:\s*trade\.entryConditionScores\s+as\s+Record<number,\s*number>/,
    );
  });
});
