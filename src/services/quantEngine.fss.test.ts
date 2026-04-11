import { describe, expect, it } from 'vitest';
import { classifyForeignSupplyDay, computeFSS } from './quant/fssEngine';
import type { ForeignSupplyDayRecord } from '../types/quant';

// ─── classifyForeignSupplyDay 단위 테스트 ─────────────────────────────────────

describe('classifyForeignSupplyDay', () => {
  it('Passive+Active 동반 순매도 → -3, BOTH_SELL', () => {
    const result = classifyForeignSupplyDay({
      date: '2026-04-01',
      passiveNetBuy: -500,
      activeNetBuy: -300,
    });
    expect(result.score).toBe(-3);
    expect(result.label).toBe('BOTH_SELL');
  });

  it('Passive+Active 동반 순매수 → +3, BOTH_BUY', () => {
    const result = classifyForeignSupplyDay({
      date: '2026-04-01',
      passiveNetBuy: 200,
      activeNetBuy: 100,
    });
    expect(result.score).toBe(3);
    expect(result.label).toBe('BOTH_BUY');
  });

  it('Passive만 순매도 → -1, PARTIAL_SELL', () => {
    const result = classifyForeignSupplyDay({
      date: '2026-04-01',
      passiveNetBuy: -200,
      activeNetBuy: 100,
    });
    expect(result.score).toBe(-1);
    expect(result.label).toBe('PARTIAL_SELL');
  });

  it('Active만 순매도 → -1, PARTIAL_SELL', () => {
    const result = classifyForeignSupplyDay({
      date: '2026-04-01',
      passiveNetBuy: 100,
      activeNetBuy: -50,
    });
    expect(result.score).toBe(-1);
    expect(result.label).toBe('PARTIAL_SELL');
  });

  it('Passive만 순매수 (Active=0) → +1, PARTIAL_BUY', () => {
    const result = classifyForeignSupplyDay({
      date: '2026-04-01',
      passiveNetBuy: 300,
      activeNetBuy: 0,
    });
    expect(result.score).toBe(1);
    expect(result.label).toBe('PARTIAL_BUY');
  });

  it('양쪽 모두 0 → 0, MIXED', () => {
    const result = classifyForeignSupplyDay({
      date: '2026-04-01',
      passiveNetBuy: 0,
      activeNetBuy: 0,
    });
    expect(result.score).toBe(0);
    expect(result.label).toBe('MIXED');
  });
});

// ─── computeFSS 통합 테스트 ───────────────────────────────────────────────────

describe('computeFSS', () => {
  /** 5일 동반 순매도 시나리오 → 누적 -15, HIGH_ALERT */
  it('5일 연속 동반 순매도 → HIGH_ALERT, 누적 -15', () => {
    const records: ForeignSupplyDayRecord[] = [
      { date: '2026-04-01', passiveNetBuy: -100, activeNetBuy: -200 },
      { date: '2026-04-02', passiveNetBuy: -150, activeNetBuy: -100 },
      { date: '2026-04-03', passiveNetBuy: -80, activeNetBuy: -50 },
      { date: '2026-04-04', passiveNetBuy: -200, activeNetBuy: -300 },
      { date: '2026-04-07', passiveNetBuy: -120, activeNetBuy: -180 },
    ];
    const result = computeFSS(records);
    expect(result.cumulativeScore).toBe(-15);
    expect(result.alertLevel).toBe('HIGH_ALERT');
    expect(result.consecutiveBothSellDays).toBe(5);
    expect(result.supplyExitDefenseRecommended).toBe(true);
    expect(result.dailyScores).toHaveLength(5);
  });

  /** 2일 동반 매도 + 3일 동반 매수 → 누적 -6+9=+3, NORMAL */
  it('혼합 시나리오 → NORMAL', () => {
    const records: ForeignSupplyDayRecord[] = [
      { date: '2026-04-01', passiveNetBuy: -100, activeNetBuy: -200 },
      { date: '2026-04-02', passiveNetBuy: -50, activeNetBuy: -100 },
      { date: '2026-04-03', passiveNetBuy: 200, activeNetBuy: 300 },
      { date: '2026-04-04', passiveNetBuy: 150, activeNetBuy: 100 },
      { date: '2026-04-07', passiveNetBuy: 80, activeNetBuy: 50 },
    ];
    const result = computeFSS(records);
    expect(result.cumulativeScore).toBe(-6 + 9); // -3*2 + 3*3 = +3
    expect(result.alertLevel).toBe('NORMAL');
    expect(result.consecutiveBothSellDays).toBe(0);
    expect(result.supplyExitDefenseRecommended).toBe(false);
  });

  /** 경계 값: 누적 정확히 -5 → HIGH_ALERT */
  it('누적 -5 경계 → HIGH_ALERT', () => {
    const records: ForeignSupplyDayRecord[] = [
      { date: '2026-04-01', passiveNetBuy: -100, activeNetBuy: -200 }, // -3
      { date: '2026-04-02', passiveNetBuy: -50, activeNetBuy: 100 },   // -1
      { date: '2026-04-03', passiveNetBuy: -80, activeNetBuy: 50 },    // -1
      { date: '2026-04-04', passiveNetBuy: 0, activeNetBuy: 0 },       //  0
      { date: '2026-04-07', passiveNetBuy: 0, activeNetBuy: 0 },       //  0
    ];
    const result = computeFSS(records);
    expect(result.cumulativeScore).toBe(-5);
    expect(result.alertLevel).toBe('HIGH_ALERT');
  });

  /** 경계 값: 누적 -4 → CAUTION */
  it('누적 -4 → CAUTION', () => {
    const records: ForeignSupplyDayRecord[] = [
      { date: '2026-04-01', passiveNetBuy: -100, activeNetBuy: -200 }, // -3
      { date: '2026-04-02', passiveNetBuy: -50, activeNetBuy: 100 },   // -1
      { date: '2026-04-03', passiveNetBuy: 0, activeNetBuy: 0 },       //  0
      { date: '2026-04-04', passiveNetBuy: 0, activeNetBuy: 0 },       //  0
      { date: '2026-04-07', passiveNetBuy: 0, activeNetBuy: 0 },       //  0
    ];
    const result = computeFSS(records);
    expect(result.cumulativeScore).toBe(-4);
    expect(result.alertLevel).toBe('CAUTION');
  });

  /** 경계 값: 누적 -3 → CAUTION */
  it('누적 -3 경계 → CAUTION', () => {
    const records: ForeignSupplyDayRecord[] = [
      { date: '2026-04-01', passiveNetBuy: -100, activeNetBuy: -200 }, // -3
      { date: '2026-04-02', passiveNetBuy: 0, activeNetBuy: 0 },       //  0
      { date: '2026-04-03', passiveNetBuy: 0, activeNetBuy: 0 },       //  0
      { date: '2026-04-04', passiveNetBuy: 0, activeNetBuy: 0 },       //  0
      { date: '2026-04-07', passiveNetBuy: 0, activeNetBuy: 0 },       //  0
    ];
    const result = computeFSS(records);
    expect(result.cumulativeScore).toBe(-3);
    expect(result.alertLevel).toBe('CAUTION');
  });

  /** 경계 값: 누적 -2 → NORMAL */
  it('누적 -2 → NORMAL', () => {
    const records: ForeignSupplyDayRecord[] = [
      { date: '2026-04-01', passiveNetBuy: -50, activeNetBuy: 100 },   // -1
      { date: '2026-04-02', passiveNetBuy: 100, activeNetBuy: -30 },   // -1
      { date: '2026-04-03', passiveNetBuy: 0, activeNetBuy: 0 },       //  0
      { date: '2026-04-04', passiveNetBuy: 0, activeNetBuy: 0 },       //  0
      { date: '2026-04-07', passiveNetBuy: 0, activeNetBuy: 0 },       //  0
    ];
    const result = computeFSS(records);
    expect(result.cumulativeScore).toBe(-2);
    expect(result.alertLevel).toBe('NORMAL');
  });

  /** 데이터가 5일 미만 — 존재하는 데이터만으로 계산 */
  it('3일 데이터만 전달 → 3일 기준 계산', () => {
    const records: ForeignSupplyDayRecord[] = [
      { date: '2026-04-01', passiveNetBuy: -100, activeNetBuy: -200 }, // -3
      { date: '2026-04-02', passiveNetBuy: -50, activeNetBuy: -80 },   // -3
      { date: '2026-04-03', passiveNetBuy: 100, activeNetBuy: 200 },   // +3
    ];
    const result = computeFSS(records);
    expect(result.cumulativeScore).toBe(-3);
    expect(result.alertLevel).toBe('CAUTION');
    expect(result.dailyScores).toHaveLength(3);
    expect(result.consecutiveBothSellDays).toBe(0); // 마지막이 BOTH_BUY
  });

  /** 7일 데이터 전달 → 최근 5일만 사용 */
  it('7일 데이터 → 최근 5일만 슬라이스', () => {
    const records: ForeignSupplyDayRecord[] = [
      { date: '2026-03-28', passiveNetBuy: -999, activeNetBuy: -999 }, // 제외
      { date: '2026-03-31', passiveNetBuy: -999, activeNetBuy: -999 }, // 제외
      { date: '2026-04-01', passiveNetBuy: 100, activeNetBuy: 100 },   // +3
      { date: '2026-04-02', passiveNetBuy: 100, activeNetBuy: 100 },   // +3
      { date: '2026-04-03', passiveNetBuy: 100, activeNetBuy: 100 },   // +3
      { date: '2026-04-04', passiveNetBuy: 100, activeNetBuy: 100 },   // +3
      { date: '2026-04-07', passiveNetBuy: 100, activeNetBuy: 100 },   // +3
    ];
    const result = computeFSS(records);
    expect(result.dailyScores).toHaveLength(5);
    expect(result.cumulativeScore).toBe(15);
    expect(result.alertLevel).toBe('NORMAL');
  });

  /** 역순 입력도 올바르게 정렬하여 처리 */
  it('역순 데이터 → 올바른 정렬 후 계산', () => {
    const records: ForeignSupplyDayRecord[] = [
      { date: '2026-04-07', passiveNetBuy: -100, activeNetBuy: -100 }, // -3 (최신)
      { date: '2026-04-04', passiveNetBuy: -100, activeNetBuy: -100 }, // -3
      { date: '2026-04-03', passiveNetBuy: 100, activeNetBuy: 100 },   // +3
      { date: '2026-04-02', passiveNetBuy: -100, activeNetBuy: -100 }, // -3
      { date: '2026-04-01', passiveNetBuy: -100, activeNetBuy: -100 }, // -3
    ];
    const result = computeFSS(records);
    expect(result.dailyScores[0].date).toBe('2026-04-01'); // 오름차순 정렬 확인
    expect(result.cumulativeScore).toBe(-9);
    expect(result.alertLevel).toBe('HIGH_ALERT');
    expect(result.consecutiveBothSellDays).toBe(2); // 04-04, 04-07
  });

  /** 빈 배열 → 누적 0, NORMAL */
  it('빈 배열 → 누적 0, NORMAL', () => {
    const result = computeFSS([]);
    expect(result.cumulativeScore).toBe(0);
    expect(result.alertLevel).toBe('NORMAL');
    expect(result.dailyScores).toHaveLength(0);
    expect(result.consecutiveBothSellDays).toBe(0);
    expect(result.supplyExitDefenseRecommended).toBe(false);
  });

  /** actionMessage 가 alertLevel에 맞게 생성되는지 확인 */
  it('HIGH_ALERT 시 행동 권고 메시지 포함', () => {
    const records: ForeignSupplyDayRecord[] = Array.from({ length: 5 }, (_, i) => ({
      date: `2026-04-0${i + 1}`,
      passiveNetBuy: -100,
      activeNetBuy: -100,
    }));
    const result = computeFSS(records);
    expect(result.actionMessage).toContain('수급 이탈');
    expect(result.actionMessage).toContain('FSS');
  });
});
