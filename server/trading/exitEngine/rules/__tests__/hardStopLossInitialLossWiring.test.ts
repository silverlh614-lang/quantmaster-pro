// @responsibility ADR-0626 hardStopLoss.ts → applyTwoBarBepGate 손실초기 2인자(stopLossExitType,returnPct) 전달 정적 가드
/**
 * hardStopLossInitialLossWiring.test.ts — ADR-0626 손실초기 2-bar 확대 wiring 정적 가드.
 * hardStopLoss 본체는 인자 2개 추가만(stopLossExitType·returnPct) — 기존 분기·청산 본체 불변.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const HARDSTOP_SRC = fs.readFileSync(
  path.resolve(__dirname, '../hardStopLoss.ts'),
  'utf8',
);

describe('hardStopLoss INITIAL_LOSS wiring (ADR-0626, 정적 가드)', () => {
  it('applyTwoBarBepGate 호출에 stopLossExitType 인자 전달', () => {
    const call = HARDSTOP_SRC.match(/applyTwoBarBepGate\s*\(\s*\{([\s\S]*?)\}\s*\)/);
    expect(call).not.toBeNull();
    expect(call?.[1]).toMatch(/stopLossExitType\s*,/);
  });

  it('applyTwoBarBepGate 호출에 returnPct 인자 전달', () => {
    const call = HARDSTOP_SRC.match(/applyTwoBarBepGate\s*\(\s*\{([\s\S]*?)\}\s*\)/);
    expect(call?.[1]).toMatch(/returnPct\s*,/);
  });

  it('isBepProtection 인자 보존 (기존 1순위 분기)', () => {
    expect(HARDSTOP_SRC).toMatch(
      /isBepProtection:\s*stopLossExitType\s*===\s*['"]PROFIT_PROTECTION['"]/,
    );
  });

  it('returnPct 는 ctx 에서 destructure 된 값 재사용 (신규 산출 0)', () => {
    expect(HARDSTOP_SRC).toMatch(/const\s*\{[^}]*returnPct[^}]*\}\s*=\s*ctx/);
  });

  it('ADR-0626 주석 명시', () => {
    expect(HARDSTOP_SRC).toMatch(/ADR-0626/);
  });
});
