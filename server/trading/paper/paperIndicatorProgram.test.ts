// @responsibility Verify bounded generated arithmetic cannot escape its data contract.
import { describe, expect, it } from 'vitest';
import { sealPaperProgram, validSealedPaperFormula } from './paperIndicatorProgram.js';
import { evaluatePaperProgram, paperProgramIssue, validPaperProgramNode, type PaperProgramNode } from '../../../src/types/paperIndicatorProgram.js';
import { paperIndicatorFormulaId, paperIndicatorFormulaOperands, paperIndicatorFormulaValue } from '../../../src/types/paperIndicatorFormula.js';

const feature = (key: 'rsi14' | 'volumeRatio20'): PaperProgramNode => ({ op: 'feature', key });
const expression: PaperProgramNode = { op: 'subtract', left: feature('volumeRatio20'), right: { op: 'abs', value: feature('rsi14') } };
const proposal = (root: PaperProgramNode = expression) => ({ title: '거래량 대비 가격 힘', hypothesis: '거래량과 가격 힘의 차이가 성과와 연관되는지 시험합니다.',
  interpretation: '거래량 환산값이 커지면 높아지고 RSI의 기준 이탈 폭이 커지면 낮아집니다.', limitation: '하락 중 거래량 증가도 포함됩니다.', expression: root });

describe('generated calculation programs', () => {
  it('calculates nonlinear expressions from recorded features with stable identities', () => {
    const program = sealPaperProgram(proposal());
    expect(validSealedPaperFormula(program)).toBe(true);
    expect(paperIndicatorFormulaOperands(program).map(item => item.feature)).toEqual(['rsi14', 'volumeRatio20']);
    expect(paperIndicatorFormulaValue(program, { rsi14: 10, volumeRatio20: 4 })).toBe(1);
    expect(paperIndicatorFormulaValue(program, { rsi14: 90, volumeRatio20: 4 })).toBe(1);
    expect(paperIndicatorFormulaId(program)).toMatch(/^invented:program:[a-f0-9]{64}$/);
    expect(sealPaperProgram({ ...proposal(), title: '다른 이름' }).digest).toBe(program.digest);
    expect(sealPaperProgram(proposal({ op: 'add', left: feature('rsi14'), right: feature('volumeRatio20') })).digest).not.toBe(program.digest);
    expect(validSealedPaperFormula({ ...program, expression: { op: 'add', left: feature('rsi14'), right: feature('volumeRatio20') } })).toBe(false);
  });
  it('supports branches while requiring every declared input to be available', () => {
    const program = sealPaperProgram(proposal({ op: 'ifPositive', condition: feature('volumeRatio20'),
      positive: feature('rsi14'), otherwise: { op: 'negate', value: feature('rsi14') } }));
    expect(paperIndicatorFormulaValue(program, { rsi14: 90, volumeRatio20: 2 })).toBe(1);
    expect(paperIndicatorFormulaValue(program, { rsi14: 90, volumeRatio20: 0 })).toBe(-1);
    for (const missing of [null, undefined, NaN, Infinity]) expect(paperIndicatorFormulaValue(program, { rsi14: missing, volumeRatio20: 2 })).toBeNull();
  });
  it('treats zero division as unavailable and bounds large intermediate results', () => {
    const program = sealPaperProgram(proposal({ op: 'divide', left: feature('rsi14'), right: feature('volumeRatio20') }));
    expect(evaluatePaperProgram(program, key => key === 'rsi14' ? 1 : 0)).toBeNull();
    expect(evaluatePaperProgram(program, key => key === 'rsi14' ? 3 : 0.01)).toBe(3);
  });
  it('rejects executable strings, unknown fields, future outputs and unbounded trees', () => {
    for (const bad of [null, 'process.env', { op: 'fetch', url: 'https://example.com' },
      { op: 'feature', key: 'futureReturn' }, { op: 'feature', key: 'constructor' },
      { ...expression, code: 'run()' }, { op: 'constant', value: 100 },
      { op: 'add', left: feature('rsi14'), right: feature('rsi14') }]) expect(validPaperProgramNode(bad)).toBe(false);
    let deep: PaperProgramNode = expression;
    for (let i = 0; i < 7; i++) deep = { op: 'abs', value: deep };
    expect(validPaperProgramNode(deep)).toBe(false);
    const cycle: Record<string, unknown> = { op: 'abs' }; cycle.value = cycle;
    expect(validPaperProgramNode(cycle)).toBe(false);
    expect(() => sealPaperProgram({ ...proposal(), hypothesis: '<script>' })).toThrow();
  });
  it('names the first failed check without echoing raw AI text', () => {
    const sealed = (value: object) => ({ ...value, version: 'feature-program-v1', digest: '0'.repeat(64) });
    let deep: PaperProgramNode = expression;
    for (let i = 0; i < 5; i++) deep = { op: 'abs', value: deep };
    const cases: Array<[object, string]> = [
      [{ ...proposal(), interpretation: 'RSI > 70이면 높습니다.' }, '해석에 꺾쇠 기호'],
      [{ ...proposal(), title: '가'.repeat(61) }, '제목 60자 초과'],
      [{ ...proposal(), limitation: '첫 줄\n둘째 줄' }, '한계에 줄바꿈·제어문자'],
      [{ ...proposal(), id: 'x', name: 'y' }, '허용되지 않은 항목 id·name'],
      [{ ...proposal(), '<b>': 1 }, '허용되지 않은 항목 기타'],
      [proposal({ op: 'feature', key: 'futureReturn' } as unknown as PaperProgramNode), '없는 재료 futureReturn'],
      [proposal({ op: 'power', left: feature('rsi14'), right: feature('volumeRatio20') } as unknown as PaperProgramNode), '허용되지 않은 연산 power'],
      [proposal(deep), '깊이 6 초과'],
      [proposal({ op: 'add', left: feature('rsi14'), right: { op: 'constant', value: 5 } }), '상수 -3~3 범위 초과'],
      [proposal({ op: 'add', left: feature('rsi14'), right: feature('rsi14') }), '서로 다른 재료 2개 미만'],
    ];
    for (const [value, issue] of cases) {
      expect(paperProgramIssue(sealed(value))).toBe(issue);
      expect(() => sealPaperProgram(value)).toThrow(issue);
    }
    expect(paperProgramIssue(sealed(proposal()))).toBeNull();
  });
});
