/**
 * @responsibility timeframeConfluenceGate 회귀 테스트 (ADR-0067 PR-Q)
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  timeframeConfluenceGate,
  countTimeframeAlignment,
  CONFLUENCE_BLOCK_THRESHOLD,
  CONFLUENCE_PROBING_THRESHOLD,
  CONFLUENCE_STANDARD_THRESHOLD,
} from '../timeframeConfluenceGate';
import { ENTRY_GATES_PHASE_B, timeframeConfluenceGate as exportedGate } from '../index';
import { makeMockCtx } from './_testHelpers';

const ORIGINAL_ENV = process.env.ENTRY_TIMEFRAME_CONFLUENCE_DISABLED;
afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.ENTRY_TIMEFRAME_CONFLUENCE_DISABLED;
  } else {
    process.env.ENTRY_TIMEFRAME_CONFLUENCE_DISABLED = ORIGINAL_ENV;
  }
});

describe('countTimeframeAlignment', async () => {
  it('undefined 입력 → 0/0', async () => {
    expect(countTimeframeAlignment(undefined)).toEqual({ passedCount: 0, totalCount: 0 });
  });

  it('빈 객체 → 0/0', async () => {
    expect(countTimeframeAlignment({})).toEqual({ passedCount: 0, totalCount: 0 });
  });

  it('3 timeframe 모두 정의 + 모두 통과 → 3/3', async () => {
    expect(countTimeframeAlignment({ daily: true, weekly: true, intraday30m: true }))
      .toEqual({ passedCount: 3, totalCount: 3 });
  });

  it('3 timeframe 모두 정의 + 1 통과 → 1/3', async () => {
    expect(countTimeframeAlignment({ daily: true, weekly: false, intraday30m: false }))
      .toEqual({ passedCount: 1, totalCount: 3 });
  });

  it('부분 데이터 — daily 만 정의 → undefined 는 분모 제외', async () => {
    expect(countTimeframeAlignment({ daily: true }))
      .toEqual({ passedCount: 1, totalCount: 1 });
    expect(countTimeframeAlignment({ daily: false }))
      .toEqual({ passedCount: 0, totalCount: 1 });
  });
});

describe('timeframeConfluenceGate — 핵심 분기', async () => {
  it('데이터 부재 (timeframeConfluence undefined) → PASS skip', async () => {
    const ctx = makeMockCtx();
    const r = await timeframeConfluenceGate(ctx);
    expect(r.pass).toBe(true);
    if (r.pass) {
      expect(r.passLogMessage).toBeUndefined();
    }
  });

  it('빈 객체 → PASS skip (totalCount=0)', async () => {
    const ctx = makeMockCtx({ timeframeConfluence: {} });
    const r = await timeframeConfluenceGate(ctx);
    expect(r.pass).toBe(true);
  });

  it('0/3 통과 → FAIL + counter=gateMisses + pushTrace=true', async () => {
    const ctx = makeMockCtx({
      timeframeConfluence: { daily: false, weekly: false, intraday30m: false },
    });
    const r = await timeframeConfluenceGate(ctx);
    expect(r.pass).toBe(false);
    if (!r.pass) {
      expect(r.logMessage).toContain('다중 시간프레임 부정렬');
      expect(r.logMessage).toContain('confluence=0/3');
      expect(r.counter).toBe('gateMisses');
      expect(r.pushTrace).toBe(true);
      expect(r.stageLog).toEqual({ key: 'timeframeConfluence', value: 'FAIL(0/3)' });
    }
  });

  it('1/3 통과 → PASS + PROBING 권장 메시지', async () => {
    const ctx = makeMockCtx({
      timeframeConfluence: { daily: true, weekly: false, intraday30m: false },
    });
    const r = await timeframeConfluenceGate(ctx);
    expect(r.pass).toBe(true);
    if (r.pass) {
      expect(r.passLogMessage).toContain('PROBING 권장');
      expect(r.passLogMessage).toContain('1/3');
    }
  });

  it('2/3 통과 → PASS + CONVICTION 권장', async () => {
    const ctx = makeMockCtx({
      timeframeConfluence: { daily: true, weekly: true, intraday30m: false },
    });
    const r = await timeframeConfluenceGate(ctx);
    expect(r.pass).toBe(true);
    if (r.pass) {
      expect(r.passLogMessage).toContain('CONVICTION 권장');
      expect(r.passLogMessage).toContain('2/3');
    }
  });

  it('3/3 통과 → PASS + CONVICTION 권장 (≥STANDARD 임계 적용)', async () => {
    const ctx = makeMockCtx({
      timeframeConfluence: { daily: true, weekly: true, intraday30m: true },
    });
    const r = await timeframeConfluenceGate(ctx);
    expect(r.pass).toBe(true);
    if (r.pass) {
      expect(r.passLogMessage).toContain('CONVICTION 권장');
      expect(r.passLogMessage).toContain('3/3');
    }
  });

  it('부분 데이터 — daily 만 true → 1/1 → PROBING 권장', async () => {
    const ctx = makeMockCtx({ timeframeConfluence: { daily: true } });
    const r = await timeframeConfluenceGate(ctx);
    expect(r.pass).toBe(true);
    if (r.pass) {
      expect(r.passLogMessage).toContain('1/1');
      expect(r.passLogMessage).toContain('PROBING 권장');
    }
  });

  it('부분 데이터 — daily 만 false → 0/1 → FAIL', async () => {
    const ctx = makeMockCtx({ timeframeConfluence: { daily: false } });
    const r = await timeframeConfluenceGate(ctx);
    expect(r.pass).toBe(false);
    if (!r.pass) {
      expect(r.logMessage).toContain('0/1');
    }
  });

  it('ENV ENTRY_TIMEFRAME_CONFLUENCE_DISABLED=true → 0/3 이라도 PASS', async () => {
    process.env.ENTRY_TIMEFRAME_CONFLUENCE_DISABLED = 'true';
    const ctx = makeMockCtx({
      timeframeConfluence: { daily: false, weekly: false, intraday30m: false },
    });
    const r = await timeframeConfluenceGate(ctx);
    expect(r.pass).toBe(true);
  });
});

describe('상수 SSOT', async () => {
  it('CONFLUENCE_BLOCK=0 / PROBING=1 / STANDARD=2', async () => {
    expect(CONFLUENCE_BLOCK_THRESHOLD).toBe(0);
    expect(CONFLUENCE_PROBING_THRESHOLD).toBe(1);
    expect(CONFLUENCE_STANDARD_THRESHOLD).toBe(2);
  });
});

describe('ENTRY_GATES_PHASE_B 통합', async () => {
  it('timeframeConfluenceGate 가 배열에 포함됨', async () => {
    expect(ENTRY_GATES_PHASE_B).toContain(exportedGate);
  });

  it('배열 마지막 게이트로 추가 (portfolioRiskGate 다음)', async () => {
    const lastIdx = ENTRY_GATES_PHASE_B.length - 1;
    expect(ENTRY_GATES_PHASE_B[lastIdx]).toBe(exportedGate);
  });

  it('총 8개 게이트 (기존 7 + PR-Q 1)', async () => {
    expect(ENTRY_GATES_PHASE_B).toHaveLength(8);
  });
});
