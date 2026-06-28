// @responsibility regimeSwitchDwell — 레짐 전환 dwell 게이트 회귀(flapping 억제·확정·ENV)
import { describe, it, expect, afterEach } from 'vitest';
import {
  evaluateRegimeDwell,
  resolveRegimeDwellConfirmTicks,
  type RegimeDwellState,
} from './regimeSwitchDwell.js';

const EMPTY: RegimeDwellState = { pendingRegime: null, pendingRegimeCount: 0 };

describe('evaluateRegimeDwell — 전환 확정 dwell 게이트', () => {
  it('curr === confirmed → 변화 없음, 진행 후보 폐기', () => {
    const d = evaluateRegimeDwell('R4_NEUTRAL', 'R4_NEUTRAL', { pendingRegime: 'R3_EARLY', pendingRegimeCount: 1 }, 2);
    expect(d.confirmed).toBe(false);
    expect(d.nextPending).toBeNull();
    expect(d.nextPendingCount).toBe(0);
  });

  it('dwell=2: 새 후보 1번째 tick 은 미확정(후보 적재)', () => {
    const d = evaluateRegimeDwell('R4_NEUTRAL', 'R3_EARLY', EMPTY, 2);
    expect(d.confirmed).toBe(false);
    expect(d.nextPending).toBe('R3_EARLY');
    expect(d.nextPendingCount).toBe(1);
  });

  it('dwell=2: 같은 후보 2번째 연속 tick 에서 확정', () => {
    const d = evaluateRegimeDwell('R4_NEUTRAL', 'R3_EARLY', { pendingRegime: 'R3_EARLY', pendingRegimeCount: 1 }, 2);
    expect(d.confirmed).toBe(true);
    expect(d.nextPending).toBeNull();
    expect(d.nextPendingCount).toBe(0);
  });

  it('flapping(A→B→A→B)은 dwell=2 에서 영구 미확정', () => {
    let state: RegimeDwellState = EMPTY;
    // tick1: A→B 후보 적재
    let d = evaluateRegimeDwell('R4_NEUTRAL', 'R3_EARLY', state, 2);
    expect(d.confirmed).toBe(false);
    state = { pendingRegime: d.nextPending, pendingRegimeCount: d.nextPendingCount };
    // tick2: B→A 원복 → 후보 폐기
    d = evaluateRegimeDwell('R4_NEUTRAL', 'R4_NEUTRAL', state, 2);
    expect(d.confirmed).toBe(false);
    state = { pendingRegime: d.nextPending, pendingRegimeCount: d.nextPendingCount };
    expect(state.pendingRegime).toBeNull();
    // tick3: A→B 다시 후보 1 (확정 안 됨)
    d = evaluateRegimeDwell('R4_NEUTRAL', 'R3_EARLY', state, 2);
    expect(d.confirmed).toBe(false);
    expect(d.nextPendingCount).toBe(1);
  });

  it('dwell=1 → 즉시 확정(레거시 byte-equivalent)', () => {
    const d = evaluateRegimeDwell('R4_NEUTRAL', 'R3_EARLY', EMPTY, 1);
    expect(d.confirmed).toBe(true);
  });

  it('다른 후보로 바뀌면 카운트 재시작', () => {
    const d = evaluateRegimeDwell('R4_NEUTRAL', 'R2_BULL', { pendingRegime: 'R3_EARLY', pendingRegimeCount: 1 }, 2);
    expect(d.confirmed).toBe(false);
    expect(d.nextPending).toBe('R2_BULL');
    expect(d.nextPendingCount).toBe(1);
  });

  it('dwell=3 → 3 연속 tick 필요', () => {
    let state: RegimeDwellState = EMPTY;
    let d = evaluateRegimeDwell('R4_NEUTRAL', 'R3_EARLY', state, 3);
    expect(d.confirmed).toBe(false); // count 1
    state = { pendingRegime: d.nextPending, pendingRegimeCount: d.nextPendingCount };
    d = evaluateRegimeDwell('R4_NEUTRAL', 'R3_EARLY', state, 3);
    expect(d.confirmed).toBe(false); // count 2
    state = { pendingRegime: d.nextPending, pendingRegimeCount: d.nextPendingCount };
    d = evaluateRegimeDwell('R4_NEUTRAL', 'R3_EARLY', state, 3);
    expect(d.confirmed).toBe(true);  // count 3
  });

  it('dwellTicks≤0 도 하한 1 로 clamp → 즉시 확정', () => {
    expect(evaluateRegimeDwell('R4_NEUTRAL', 'R3_EARLY', EMPTY, 0).confirmed).toBe(true);
  });
});

describe('resolveRegimeDwellConfirmTicks — ENV 해석', () => {
  const orig = process.env.REGIME_SWITCH_DWELL_CONFIRM_TICKS;
  afterEach(() => {
    if (orig === undefined) delete process.env.REGIME_SWITCH_DWELL_CONFIRM_TICKS;
    else process.env.REGIME_SWITCH_DWELL_CONFIRM_TICKS = orig;
  });

  it('미설정 → default 2', () => {
    delete process.env.REGIME_SWITCH_DWELL_CONFIRM_TICKS;
    expect(resolveRegimeDwellConfirmTicks()).toBe(2);
  });

  it('=1 → 1 (레거시 롤백)', () => {
    process.env.REGIME_SWITCH_DWELL_CONFIRM_TICKS = '1';
    expect(resolveRegimeDwellConfirmTicks()).toBe(1);
  });

  it('=3 → 3', () => {
    process.env.REGIME_SWITCH_DWELL_CONFIRM_TICKS = '3';
    expect(resolveRegimeDwellConfirmTicks()).toBe(3);
  });

  it.each(['0', '-5', 'abc', ''])('비유효(%s) → default 2', (v) => {
    process.env.REGIME_SWITCH_DWELL_CONFIRM_TICKS = v;
    expect(resolveRegimeDwellConfirmTicks()).toBe(2);
  });

  it('소수 2.7 → trunc 2', () => {
    process.env.REGIME_SWITCH_DWELL_CONFIRM_TICKS = '2.7';
    expect(resolveRegimeDwellConfirmTicks()).toBe(2);
  });
});
