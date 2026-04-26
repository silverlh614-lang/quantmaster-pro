/**
 * @responsibility fomcCalendar v2 정책 (2026-04-26 사용자 요청 적용) 회귀 테스트
 *
 * 변경: PRE_3 / PRE_2 = 1.0 (정상 운용) / PRE_1 / DAY = 0.0 (신규 진입 금지).
 * 매도(exitEngine) 는 본 게이트 무관 — 별도 cron 으로 정상 발동.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getFomcProximity,
  generateFomcIcs,
  applyFomcRelaxation,
  FOMC_DATES,
  FOMC_RELAXATION_THRESHOLDS,
} from './fomcCalendar.js';

function setNow(iso: string): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
}

describe('fomcCalendar v2 — D-1 부터 차단 정책 (사용자 요청 2026-04-26)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('PRE_3 (D-3) — 정상 운용 (v2 변경 핵심)', () => {
    it('FOMC 4/29 기준 4/26 (D-3) 은 PRE_3 + Kelly 1.0 + noNewEntry=false', () => {
      // KST 4/26 12:00 = UTC 4/26 03:00
      setNow('2026-04-26T03:00:00Z');
      const p = getFomcProximity();
      expect(p.phase).toBe('PRE_3');
      expect(p.daysUntil).toBe(3);
      expect(p.kellyMultiplier).toBe(1.0);
      expect(p.noNewEntry).toBe(false);
    });

    it('PRE_3 description 은 "정상 운용 (D-1 부터 진입 차단)" 안내 포함', () => {
      setNow('2026-04-26T03:00:00Z');
      const p = getFomcProximity();
      expect(p.description).toContain('FOMC D-3');
      expect(p.description).toContain('정상 운용');
      expect(p.description).toContain('D-1 부터');
      expect(p.description).not.toContain('신규 진입 금지');
    });
  });

  describe('PRE_2 (D-2) — 정상 운용 (v2 변경 핵심)', () => {
    it('FOMC 4/29 기준 4/27 (D-2) 은 PRE_2 + Kelly 1.0 + noNewEntry=false', () => {
      setNow('2026-04-27T03:00:00Z');
      const p = getFomcProximity();
      expect(p.phase).toBe('PRE_2');
      expect(p.daysUntil).toBe(2);
      expect(p.kellyMultiplier).toBe(1.0);
      expect(p.noNewEntry).toBe(false);
    });

    it('PRE_2 description 은 "정상 운용 (내일부터 진입 차단)"', () => {
      setNow('2026-04-27T03:00:00Z');
      const p = getFomcProximity();
      expect(p.description).toContain('FOMC D-2');
      expect(p.description).toContain('정상 운용');
      expect(p.description).toContain('내일부터');
    });
  });

  describe('PRE_1 (D-1) — 신규 진입 금지 (차단 시작)', () => {
    it('FOMC 4/29 기준 4/28 (D-1) 은 PRE_1 + Kelly 0 + noNewEntry=true', () => {
      setNow('2026-04-28T03:00:00Z');
      const p = getFomcProximity();
      expect(p.phase).toBe('PRE_1');
      expect(p.daysUntil).toBe(1);
      expect(p.kellyMultiplier).toBe(0.0);
      expect(p.noNewEntry).toBe(true);
    });

    it('PRE_1 description 은 "신규 진입 금지" 명시', () => {
      setNow('2026-04-28T03:00:00Z');
      const p = getFomcProximity();
      expect(p.description).toContain('FOMC D-1');
      expect(p.description).toContain('신규 진입 금지');
    });
  });

  describe('DAY (D+0) — 발표 당일 전면 관망', () => {
    it('FOMC 발표일 4/29 는 DAY + Kelly 0 + noNewEntry=true', () => {
      setNow('2026-04-29T03:00:00Z');
      const p = getFomcProximity();
      expect(p.phase).toBe('DAY');
      expect(p.daysUntil).toBe(0);
      expect(p.kellyMultiplier).toBe(0.0);
      expect(p.noNewEntry).toBe(true);
    });
  });

  describe('POST_1 (D+1) — 진입 재개 + Kelly 부스트', () => {
    it('FOMC 다음날 4/30 은 POST_1 + Kelly 1.30 + noNewEntry=false', () => {
      setNow('2026-04-30T03:00:00Z');
      const p = getFomcProximity();
      expect(p.phase).toBe('POST_1');
      expect(p.daysAfter).toBe(1);
      expect(p.kellyMultiplier).toBe(1.30);
      expect(p.noNewEntry).toBe(false);
    });
  });

  describe('hedgeSignal — v2 에선 항상 false (D-3 정상 운용으로 격하)', () => {
    it('PRE_3 시점에 hedgeSignal=false (v1 에선 true 였음, v2 변경)', () => {
      setNow('2026-04-26T03:00:00Z');
      const p = getFomcProximity();
      expect(p.phase).toBe('PRE_3');
      expect(p.hedgeSignal).toBe(false);
    });

    it('모든 phase 에서 hedgeSignal 항상 false (v2 정책)', () => {
      const dates = [
        '2026-04-26T03:00:00Z', // PRE_3
        '2026-04-27T03:00:00Z', // PRE_2
        '2026-04-28T03:00:00Z', // PRE_1
        '2026-04-29T03:00:00Z', // DAY
        '2026-04-30T03:00:00Z', // POST_1
        '2026-05-01T03:00:00Z', // POST_2
      ];
      for (const d of dates) {
        setNow(d);
        const p = getFomcProximity();
        expect(p.hedgeSignal).toBe(false);
      }
    });
  });

  describe('전체 차단 기간 — D-1 + D-day 2일만 (v2 핵심)', () => {
    it('4/26 ~ 5/1 6일 시뮬레이션 — 차단 정확히 2일 (D-1 + DAY)', () => {
      const days = [
        { iso: '2026-04-26T03:00:00Z', expected: false }, // D-3: 정상
        { iso: '2026-04-27T03:00:00Z', expected: false }, // D-2: 정상
        { iso: '2026-04-28T03:00:00Z', expected: true  }, // D-1: 차단
        { iso: '2026-04-29T03:00:00Z', expected: true  }, // D-day: 차단
        { iso: '2026-04-30T03:00:00Z', expected: false }, // D+1: 재개
        { iso: '2026-05-01T03:00:00Z', expected: false }, // D+2: 재개
      ];

      const blockedCount = days.filter((d) => {
        setNow(d.iso);
        return getFomcProximity().noNewEntry;
      }).length;

      expect(blockedCount).toBe(2);

      for (const d of days) {
        setNow(d.iso);
        const p = getFomcProximity();
        expect(p.noNewEntry).toBe(d.expected);
      }
    });
  });

  describe('NORMAL — FOMC 와 멀리 떨어진 평일', () => {
    it('FOMC 와 1주일 이상 거리면 NORMAL + Kelly 1.0', () => {
      setNow('2026-04-15T03:00:00Z');
      const p = getFomcProximity();
      expect(p.phase).toBe('NORMAL');
      expect(p.kellyMultiplier).toBe(1.0);
      expect(p.noNewEntry).toBe(false);
    });
  });

  describe('FOMC_DATES SSOT — 2026 일정 unchanged', () => {
    it('2026-04-29 가 FOMC_DATES 에 포함', () => {
      expect(FOMC_DATES).toContain('2026-04-29');
    });

    it('2026 일정 8회', () => {
      const y2026 = FOMC_DATES.filter((d) => d.startsWith('2026-'));
      expect(y2026.length).toBe(8);
    });
  });
});

describe('applyFomcRelaxation — 우호 환경 보수적 진입 허용 (사용자 요청 2026-04-26)', () => {
  describe('PRE_3 / PRE_2 — 차단 기간 아님, 완화 무관', () => {
    it('PRE_3 는 macro 와 무관하게 통과', () => {
      const r = applyFomcRelaxation('PRE_3', 1.0, { mhs: 70, regime: 'BULL_NORMAL', vkospi: 18 });
      expect(r.relaxed).toBe(false);
      expect(r.effectiveKelly).toBe(1.0);
      expect(r.noNewEntry).toBe(false);
      expect(r.reason).toContain('아님');
    });

    it('PRE_2 는 macro 와 무관하게 통과', () => {
      const r = applyFomcRelaxation('PRE_2', 1.0, { mhs: 30, regime: 'NEUTRAL', vkospi: 35 });
      expect(r.relaxed).toBe(false);
      expect(r.effectiveKelly).toBe(1.0);
      expect(r.noNewEntry).toBe(false);
    });

    it('NORMAL phase 도 완화 무관', () => {
      const r = applyFomcRelaxation('NORMAL', 1.0, { mhs: 70, regime: 'BULL_NORMAL', vkospi: 18 });
      expect(r.relaxed).toBe(false);
      expect(r.effectiveKelly).toBe(1.0);
    });
  });

  describe('PRE_1 / DAY — 차단 기간, macro 부재 시 보수적 차단 유지', () => {
    it('macro 미전달 시 차단 유지', () => {
      const r = applyFomcRelaxation('PRE_1', 0, undefined);
      expect(r.relaxed).toBe(false);
      expect(r.effectiveKelly).toBe(0);
      expect(r.noNewEntry).toBe(true);
      expect(r.reason).toContain('snapshot 부재');
    });

    it('mhs 누락 시 차단 유지', () => {
      const r = applyFomcRelaxation('DAY', 0, { regime: 'BULL_NORMAL', vkospi: 18 });
      expect(r.relaxed).toBe(false);
      expect(r.noNewEntry).toBe(true);
    });

    it('regime 누락 시 차단 유지', () => {
      const r = applyFomcRelaxation('PRE_1', 0, { mhs: 70, vkospi: 18 });
      expect(r.relaxed).toBe(false);
      expect(r.noNewEntry).toBe(true);
    });
  });

  describe('PRE_1 / DAY — 우호 환경 3조건 모두 충족 시 보수적 진입', () => {
    it('MHS 70 + BULL_NORMAL + VKOSPI 18 → 완화 적용', () => {
      const r = applyFomcRelaxation('PRE_1', 0, { mhs: 70, regime: 'BULL_NORMAL', vkospi: 18 });
      expect(r.relaxed).toBe(true);
      expect(r.effectiveKelly).toBe(FOMC_RELAXATION_THRESHOLDS.KELLY_RELAXED);
      expect(r.effectiveKelly).toBe(0.3);
      expect(r.noNewEntry).toBe(false);
      expect(r.reason).toContain('우호 환경');
      expect(r.reason).toContain('Kelly');
    });

    it('MHS 60 boundary 통과', () => {
      const r = applyFomcRelaxation('DAY', 0, { mhs: 60, regime: 'BULL_AGGRESSIVE', vkospi: 22 });
      expect(r.relaxed).toBe(true);
    });

    it('R1_BULL_AGGRESSIVE 레짐 별칭도 우호로 인정', () => {
      const r = applyFomcRelaxation('PRE_1', 0, { mhs: 65, regime: 'R1_BULL_AGGRESSIVE', vkospi: 20 });
      expect(r.relaxed).toBe(true);
    });
  });

  describe('PRE_1 / DAY — 우호 환경 일부 미충족 시 차단 유지', () => {
    it('MHS 59 (임계 미달) → 차단', () => {
      const r = applyFomcRelaxation('PRE_1', 0, { mhs: 59, regime: 'BULL_NORMAL', vkospi: 18 });
      expect(r.relaxed).toBe(false);
      expect(r.noNewEntry).toBe(true);
      expect(r.reason).toContain('MHS ❌');
    });

    it('NEUTRAL 레짐은 우호 아님 → 차단', () => {
      const r = applyFomcRelaxation('PRE_1', 0, { mhs: 70, regime: 'NEUTRAL', vkospi: 18 });
      expect(r.relaxed).toBe(false);
      expect(r.reason).toContain('Regime ❌');
    });

    it('R6_DEFENSE 는 우호 아님 → 차단', () => {
      const r = applyFomcRelaxation('PRE_1', 0, { mhs: 70, regime: 'R6_DEFENSE', vkospi: 18 });
      expect(r.relaxed).toBe(false);
      expect(r.noNewEntry).toBe(true);
    });

    it('VKOSPI 23 (임계 초과) → 차단', () => {
      const r = applyFomcRelaxation('DAY', 0, { mhs: 70, regime: 'BULL_NORMAL', vkospi: 23 });
      expect(r.relaxed).toBe(false);
      expect(r.reason).toContain('VKOSPI ❌');
    });

    it('VKOSPI 누락 시 차단 (보수적)', () => {
      const r = applyFomcRelaxation('PRE_1', 0, { mhs: 70, regime: 'BULL_NORMAL' });
      expect(r.relaxed).toBe(false);
    });

    it('VKOSPI NaN 시 차단 (안전 fallback)', () => {
      const r = applyFomcRelaxation('PRE_1', 0, { mhs: 70, regime: 'BULL_NORMAL', vkospi: NaN });
      expect(r.relaxed).toBe(false);
    });
  });

  describe('getFomcProximity(macro) 통합 동작', () => {
    afterEach(() => vi.useRealTimers());

    it('PRE_1 + 우호 macro → relaxed=true + noNewEntry=false', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-28T03:00:00Z'));
      const p = getFomcProximity({ mhs: 70, regime: 'BULL_NORMAL', vkospi: 18 });
      expect(p.phase).toBe('PRE_1');
      expect(p.relaxed).toBe(true);
      expect(p.noNewEntry).toBe(false);
      expect(p.kellyMultiplier).toBe(0.3);
      expect(p.relaxationReason).toContain('우호 환경');
      expect(p.description).toContain('우호 환경');
    });

    it('PRE_1 + 비우호 macro → 차단 유지', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-28T03:00:00Z'));
      const p = getFomcProximity({ mhs: 40, regime: 'NEUTRAL', vkospi: 28 });
      expect(p.relaxed).toBeFalsy();
      expect(p.noNewEntry).toBe(true);
      expect(p.kellyMultiplier).toBe(0);
    });

    it('macro 미전달 시 기존 정책 (차단 유지) — 회귀 안전', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-28T03:00:00Z'));
      const p = getFomcProximity();
      expect(p.relaxed).toBeFalsy();
      expect(p.noNewEntry).toBe(true);
    });

    it('PRE_3 (D-3) 에선 macro 우호여도 relaxed=false (정상 운용 그대로)', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-26T03:00:00Z'));
      const p = getFomcProximity({ mhs: 70, regime: 'BULL_NORMAL', vkospi: 18 });
      expect(p.phase).toBe('PRE_3');
      expect(p.relaxed).toBeFalsy();
      expect(p.noNewEntry).toBe(false);
      expect(p.kellyMultiplier).toBe(1.0);
    });
  });

  describe('FOMC_RELAXATION_THRESHOLDS SSOT', () => {
    it('상수가 명확히 정의되어 있다', () => {
      expect(FOMC_RELAXATION_THRESHOLDS.MHS_MIN).toBe(60);
      expect(FOMC_RELAXATION_THRESHOLDS.VKOSPI_MAX).toBe(22);
      expect(FOMC_RELAXATION_THRESHOLDS.KELLY_RELAXED).toBe(0.3);
    });
  });
});

describe('generateFomcIcs — v2 정책 반영', () => {
  it('ICS DESCRIPTION 이 "D-1 부터 신규 진입 자동 차단" 으로 갱신', () => {
    const ics = generateFomcIcs();
    expect(ics).toContain('D-1 부터 신규 진입 자동 차단');
    expect(ics).not.toContain('D-3부터 신규 진입 자동 차단');
  });

  it('ICS VALARM 이 D-3 경보 제거 + D-1 경보 단일화', () => {
    const ics = generateFomcIcs();
    expect(ics).not.toContain('TRIGGER:-P3DT0H0M0S');
    expect(ics).toContain('TRIGGER:-P1DT0H0M0S');
    expect(ics).not.toContain('FOMC D-3: 신규 진입 차단');
  });

  it('ICS D-1 경보 메시지 갱신', () => {
    const ics = generateFomcIcs();
    expect(ics).toContain('FOMC D-1: 신규 진입 자동 차단');
  });
});
