/**
 * counterfactualOutcomeMaturityBridge.test.ts — outcome 소스 분해 진단 회귀.
 *
 * 운영 실측(2026-07-31): Total recorded 1580 · Mature D1/D3/D5/D10 = 1143/863/632/0.
 * 성숙 카운트는 GATE1 행에서만 나오고 counterfactual/legacy 행은 outcome 을 싣지 않는다.
 */
import { describe, it, expect } from 'vitest';
import {
  buildOutcomeMaturityBySource,
  formatOutcomeMaturityLines,
  appendOutcomeMaturityDiagnostic,
  type OutcomeMaturityInputRow,
} from './counterfactualOutcomeMaturityBridge.js';

function row(
  sourceType: string,
  returns: Partial<Pick<OutcomeMaturityInputRow, 'returnD1' | 'returnD3' | 'returnD5' | 'returnD10'>> = {},
): OutcomeMaturityInputRow {
  return {
    sourceType,
    returnD1: returns.returnD1 ?? null,
    returnD3: returns.returnD3 ?? null,
    returnD5: returns.returnD5 ?? null,
    returnD10: returns.returnD10 ?? null,
  };
}

describe('buildOutcomeMaturityBySource', () => {
  it('소스별 행 수와 호라이즌 성숙 수를 분리 집계', () => {
    const rows = [
      row('GATE1_DRY_RUN_OBSERVATION', { returnD1: 1, returnD3: 2, returnD5: 3 }),
      row('GATE1_DRY_RUN_OBSERVATION', { returnD1: 1 }),
      row('COUNTERFACTUAL_LEDGER'),
      row('COUNTERFACTUAL_LEDGER'),
      row('LEGACY_COUNTERFACTUAL'),
    ];
    const b = buildOutcomeMaturityBySource(rows);
    const gate1 = b.find((x) => x.sourceType === 'GATE1_DRY_RUN_OBSERVATION')!;
    expect(gate1.rows).toBe(2);
    expect(gate1.withAnyOutcome).toBe(2);
    expect(gate1.maturedD1).toBe(2);
    expect(gate1.maturedD5).toBe(1);
    expect(gate1.maturedD10).toBe(0);

    const cf = b.find((x) => x.sourceType === 'COUNTERFACTUAL_LEDGER')!;
    expect(cf.rows).toBe(2);
    // outcome 미탑재 — Total 에는 잡히나 성숙 카운트 기여 0.
    expect(cf.withAnyOutcome).toBe(0);
  });

  it('표시 순서 고정 + 미지 sourceType 은 뒤에 노출(은폐 금지)', () => {
    const b = buildOutcomeMaturityBySource([
      row('MYSTERY_SOURCE', { returnD1: 1 }),
      row('LEGACY_COUNTERFACTUAL'),
      row('GATE1_DRY_RUN_OBSERVATION', { returnD1: 1 }),
    ]);
    expect(b.map((x) => x.sourceType)).toEqual([
      'GATE1_DRY_RUN_OBSERVATION',
      'LEGACY_COUNTERFACTUAL',
      'MYSTERY_SOURCE',
    ]);
  });

  it('비유한 값(NaN/Infinity)은 성숙으로 세지 않는다', () => {
    const b = buildOutcomeMaturityBySource([
      { sourceType: 'GATE1_DRY_RUN_OBSERVATION', returnD1: Number.NaN, returnD3: Number.POSITIVE_INFINITY, returnD5: null, returnD10: null },
    ]);
    expect(b[0].maturedD1).toBe(0);
    expect(b[0].maturedD3).toBe(0);
    expect(b[0].withAnyOutcome).toBe(0);
  });

  it('판정은 경험적 — 미탑재 소스가 값을 싣기 시작하면 자동 반영', () => {
    const b = buildOutcomeMaturityBySource([row('COUNTERFACTUAL_LEDGER', { returnD5: 2.5 })]);
    expect(b[0].withAnyOutcome).toBe(1);
    expect(b[0].maturedD5).toBe(1);
  });
});

describe('formatOutcomeMaturityLines', () => {
  it('미탑재 소스를 명시하고 분모가 Total 과 다름을 밝힌다', () => {
    const text = formatOutcomeMaturityLines(
      buildOutcomeMaturityBySource([
        row('GATE1_DRY_RUN_OBSERVATION', { returnD1: 1, returnD5: 2 }),
        row('COUNTERFACTUAL_LEDGER'),
        row('COUNTERFACTUAL_LEDGER'),
      ]),
    );
    expect(text).toContain('outcome 미탑재');
    expect(text).toContain('Total recorded 3건과 다르다');
  });

  it('D5>0 인데 D10=0 이면 "성숙분 부재"로 해석을 좁혀준다', () => {
    const text = formatOutcomeMaturityLines(
      buildOutcomeMaturityBySource([
        row('GATE1_DRY_RUN_OBSERVATION', { returnD1: 1, returnD3: 1, returnD5: 1 }),
      ]),
    );
    expect(text).toContain('D10=0');
    expect(text).toContain('10영업일 성숙분 부재');
  });

  it('D5 도 0 이면 성숙 초기 단계로 표기', () => {
    const text = formatOutcomeMaturityLines(
      buildOutcomeMaturityBySource([row('GATE1_DRY_RUN_OBSERVATION', { returnD1: 1 })]),
    );
    expect(text).toContain('성숙 초기 단계');
  });

  it('행 0건이어도 throw 하지 않는다', () => {
    expect(formatOutcomeMaturityLines([])).toContain('행 없음');
  });
});

describe('appendOutcomeMaturityDiagnostic', () => {
  it('본문을 보존하고 진단을 덧붙인다', () => {
    const out = appendOutcomeMaturityDiagnostic('BASE_BODY', [
      row('GATE1_DRY_RUN_OBSERVATION', { returnD5: 1 }),
    ]);
    expect(out.startsWith('BASE_BODY')).toBe(true);
    expect(out).toContain('Outcome 소스 분해');
  });

  it('입력이 깨져도 본문은 유실되지 않는다 (표시 전용 계약)', () => {
    const out = appendOutcomeMaturityDiagnostic('BASE_BODY', null as never);
    expect(out.startsWith('BASE_BODY')).toBe(true);
  });
});
