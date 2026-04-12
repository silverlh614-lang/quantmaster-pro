import { describe, expect, it } from 'vitest';
import {
  evaluatePositionLifecycle,
  LIFECYCLE_LABELS,
  LIFECYCLE_DESCRIPTIONS,
  getLifecycleNextAction,
} from './quant/positionLifecycleEngine';
import type { PositionLifecycleState } from '../types/sell';

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

function makeState(overrides: Partial<PositionLifecycleState> = {}): PositionLifecycleState {
  return {
    stage: 'HOLD',
    entryScore: 7,
    currentScore: 7,
    gate1BreachCount: 0,
    stopLossTriggered: false,
    ...overrides,
  };
}

// ─── ENTRY → HOLD 전환 ────────────────────────────────────────────────────────

describe('evaluatePositionLifecycle — ENTRY → HOLD', () => {
  it('ENTRY 단계 → HOLD 전환 반환', () => {
    const result = evaluatePositionLifecycle(makeState({ stage: 'ENTRY' }));
    expect(result).not.toBeNull();
    expect(result!.prevStage).toBe('ENTRY');
    expect(result!.nextStage).toBe('HOLD');
    expect(result!.sellRatio).toBe(0);
    expect(result!.sendAlert).toBe(false);
  });
});

// ─── HOLD → ALERT 전환 ───────────────────────────────────────────────────────

describe('evaluatePositionLifecycle — HOLD → ALERT', () => {
  it('점수 20% 이상 하락 시 ALERT 전환', () => {
    // 7점에서 5.6점 이하 → 20% 하락
    const result = evaluatePositionLifecycle(makeState({ entryScore: 7, currentScore: 5 }));
    expect(result).not.toBeNull();
    expect(result!.nextStage).toBe('ALERT');
    expect(result!.sellRatio).toBe(0.5);
    expect(result!.sendAlert).toBe(true);
    expect(result!.severity).toBe('HIGH');
  });

  it('정확히 20% 하락 경계값 (entryScore=5, currentScore=4) — ALERT', () => {
    const result = evaluatePositionLifecycle(makeState({ entryScore: 5, currentScore: 4 }));
    expect(result!.nextStage).toBe('ALERT');
  });

  it('19.9% 하락 → 전환 없음 (null)', () => {
    // entryScore=10, 20% = 2점 하락 → currentScore=9 (10% 하락)은 유지
    const result = evaluatePositionLifecycle(makeState({ entryScore: 10, currentScore: 9 }));
    expect(result).toBeNull();
  });

  it('점수 동일 → 전환 없음', () => {
    const result = evaluatePositionLifecycle(makeState({ entryScore: 7, currentScore: 7 }));
    expect(result).toBeNull();
  });

  it('entryScore = 0이면 나누기 0 방어 → 전환 없음', () => {
    const result = evaluatePositionLifecycle(makeState({ entryScore: 0, currentScore: 0 }));
    expect(result).toBeNull();
  });
});

// ─── HOLD → EXIT_PREP 전환 ───────────────────────────────────────────────────

describe('evaluatePositionLifecycle — HOLD → EXIT_PREP (Gate 1 2개 이탈)', () => {
  it('Gate 1 이탈 2개 → EXIT_PREP 전환', () => {
    const result = evaluatePositionLifecycle(makeState({ gate1BreachCount: 2 }));
    expect(result).not.toBeNull();
    expect(result!.nextStage).toBe('EXIT_PREP');
    expect(result!.sellRatio).toBe(0.25);
    expect(result!.sendAlert).toBe(true);
    expect(result!.severity).toBe('HIGH');
  });

  it('Gate 1 이탈 1개 → 전환 없음', () => {
    const result = evaluatePositionLifecycle(makeState({ gate1BreachCount: 1 }));
    expect(result).toBeNull();
  });
});

// ─── ALERT → EXIT_PREP 전환 ──────────────────────────────────────────────────

describe('evaluatePositionLifecycle — ALERT → EXIT_PREP', () => {
  it('ALERT 단계에서 Gate 1 이탈 2개 → EXIT_PREP 전환', () => {
    const result = evaluatePositionLifecycle(makeState({ stage: 'ALERT', gate1BreachCount: 2 }));
    expect(result).not.toBeNull();
    expect(result!.nextStage).toBe('EXIT_PREP');
  });
});

// ─── FULL_EXIT 전환 (Gate 1 3개 이탈) ────────────────────────────────────────

describe('evaluatePositionLifecycle — FULL_EXIT (Gate 1 3개 이탈)', () => {
  it('HOLD에서 Gate 1 이탈 3개 → FULL_EXIT', () => {
    const result = evaluatePositionLifecycle(makeState({ gate1BreachCount: 3 }));
    expect(result).not.toBeNull();
    expect(result!.nextStage).toBe('FULL_EXIT');
    expect(result!.sellRatio).toBe(1.0);
    expect(result!.sendAlert).toBe(true);
    expect(result!.severity).toBe('CRITICAL');
  });

  it('EXIT_PREP에서 Gate 1 이탈 4개 → FULL_EXIT', () => {
    const result = evaluatePositionLifecycle(makeState({ stage: 'EXIT_PREP', gate1BreachCount: 4 }));
    expect(result).not.toBeNull();
    expect(result!.nextStage).toBe('FULL_EXIT');
  });

  it('ALERT에서 Gate 1 이탈 3개 → FULL_EXIT', () => {
    const result = evaluatePositionLifecycle(makeState({ stage: 'ALERT', gate1BreachCount: 3 }));
    expect(result).not.toBeNull();
    expect(result!.nextStage).toBe('FULL_EXIT');
  });

  it('Gate 1 이탈 2개여도 손절 발동 시 → FULL_EXIT', () => {
    const result = evaluatePositionLifecycle(makeState({ gate1BreachCount: 2, stopLossTriggered: true }));
    expect(result).not.toBeNull();
    expect(result!.nextStage).toBe('FULL_EXIT');
    expect(result!.reason).toContain('손절');
  });

  it('Gate 1 이탈 0개여도 손절 발동 시 → FULL_EXIT', () => {
    const result = evaluatePositionLifecycle(makeState({ stopLossTriggered: true }));
    expect(result).not.toBeNull();
    expect(result!.nextStage).toBe('FULL_EXIT');
  });
});

// ─── FULL_EXIT 단계 유지 ──────────────────────────────────────────────────────

describe('evaluatePositionLifecycle — FULL_EXIT 단계 재전환 없음', () => {
  it('이미 FULL_EXIT 단계 → null (더 이상 전환 없음)', () => {
    const result = evaluatePositionLifecycle(makeState({ stage: 'FULL_EXIT', gate1BreachCount: 5 }));
    expect(result).toBeNull();
  });
});

// ─── 우선순위 테스트 ─────────────────────────────────────────────────────────

describe('evaluatePositionLifecycle — 우선순위', () => {
  it('FULL_EXIT 조건 충족 시 ALERT/EXIT_PREP보다 우선 (점수 하락 + Gate1 3개)', () => {
    const result = evaluatePositionLifecycle(makeState({
      entryScore: 7,
      currentScore: 4,    // 점수 43% 하락 (ALERT 조건)
      gate1BreachCount: 3, // FULL_EXIT 조건
    }));
    expect(result!.nextStage).toBe('FULL_EXIT');
  });

  it('EXIT_PREP 조건 충족 시 ALERT보다 우선 (점수 하락 + Gate1 2개)', () => {
    const result = evaluatePositionLifecycle(makeState({
      entryScore: 7,
      currentScore: 4,    // 점수 하락 (ALERT 조건)
      gate1BreachCount: 2, // EXIT_PREP 조건
    }));
    expect(result!.nextStage).toBe('EXIT_PREP');
  });
});

// ─── LIFECYCLE_LABELS / DESCRIPTIONS 완전성 ──────────────────────────────────

describe('LIFECYCLE_LABELS / LIFECYCLE_DESCRIPTIONS', () => {
  const stages: PositionLifecycleState['stage'][] = ['ENTRY', 'HOLD', 'ALERT', 'EXIT_PREP', 'FULL_EXIT'];

  it('모든 단계에 레이블 존재', () => {
    stages.forEach(s => {
      expect(LIFECYCLE_LABELS[s]).toBeDefined();
      expect(LIFECYCLE_LABELS[s]).not.toBe('');
    });
  });

  it('모든 단계에 설명 존재', () => {
    stages.forEach(s => {
      expect(LIFECYCLE_DESCRIPTIONS[s]).toBeDefined();
      expect(LIFECYCLE_DESCRIPTIONS[s]).not.toBe('');
    });
  });
});

// ─── getLifecycleNextAction 단위 테스트 ───────────────────────────────────────

describe('getLifecycleNextAction', () => {
  it('HOLD 단계 — 점수 추이 정보 포함', () => {
    const msg = getLifecycleNextAction(makeState({ stage: 'HOLD', entryScore: 7, currentScore: 7, gate1BreachCount: 0 }));
    expect(msg).toContain('7');
    expect(msg).toContain('Gate 1 이탈');
  });

  it('ALERT 단계 — 50% 매도 완료 언급', () => {
    const msg = getLifecycleNextAction(makeState({ stage: 'ALERT', gate1BreachCount: 1 }));
    expect(msg).toContain('50%');
  });

  it('EXIT_PREP 단계 — 25% 매도 완료 언급', () => {
    const msg = getLifecycleNextAction(makeState({ stage: 'EXIT_PREP', gate1BreachCount: 2 }));
    expect(msg).toContain('25%');
  });

  it('FULL_EXIT 단계 — 포지션 종료 언급', () => {
    const msg = getLifecycleNextAction(makeState({ stage: 'FULL_EXIT' }));
    expect(msg).toContain('종료');
  });

  it('ENTRY 단계 — OCO 주문 언급', () => {
    const msg = getLifecycleNextAction(makeState({ stage: 'ENTRY' }));
    expect(msg).toContain('OCO');
  });
});
