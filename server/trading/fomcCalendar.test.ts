/**
 * @responsibility fomcCalendar 회귀 테스트 — FOMC 게이팅 제거(FOMC_GATING_REMOVED) 후 계약
 *
 * 구 v4 정책(PRE_3~PRE_1 Kelly 0.75 + DAY 차단)은 `Patch-FOMC-DEAD-CODE-REMOVAL-001`
 * (docs/ai/10-patch-history-index.md)로 제거됨. getFomcProximity 는 날짜/phase 무관하게
 * 항상 NORMAL(Kelly 1.0, noNewEntry=false, description 'FOMC_GATING_REMOVED')을 반환한다.
 *
 * 단, 아래 함수들은 production 에 live 로 잔존하므로 behavioral 검증을 보존한다:
 *   - applyFomcRelaxation : 순수 완화 계산기 (getFomcProximity 와 독립)
 *   - getDefaultFomcDayLiquidationConfig : env 기반 config factory
 *   - generateFomcIcs : ICS 캘린더 생성 (v4 텍스트 보존)
 *   - FOMC_DATES / FOMC_RELAXATION_THRESHOLDS SSOT
 * shouldExecuteLiquidationAt 는 잔존하나 가드 1(NOT_DAY_PHASE)이 항상 선점 → enforcement dead.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  getFomcProximity,
  generateFomcIcs,
  applyFomcRelaxation,
  FOMC_DATES,
  FOMC_RELAXATION_THRESHOLDS,
  getDefaultFomcDayLiquidationConfig,
  shouldExecuteLiquidationAt,
} from './fomcCalendar.js';

function setNow(iso: string): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
}

describe('fomcCalendar v4 — D-3~D-1 보수적 진입 + D-day 차단', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // ── 출력/정책 drift 근거 (intent proof — 맹목 갱신 아님) ───────────────────────
  //   1. 패치 이력: docs/ai/10-patch-history-index.md `Patch-FOMC-DEAD-CODE-REMOVAL-001`.
  //   2. production: fomcCalendar.ts getFomcProximity(L190~204) 는 phase/날짜 무관하게
  //      항상 NORMAL + Kelly 1.0 + noNewEntry=false + description 'FOMC_GATING_REMOVED'
  //      반환 ("FOMC 게이팅이 제거되었습니다").
  //   3. caller dryRunScanner.ts:117 도 항상 'NORMAL' phase 전달 (게이팅 제거 주석).
  // 따라서 구 v4 phase(PRE_3/PRE_2/PRE_1/DAY/POST_1) 단언은 제거된 동작이므로,
  // 현행 always-NORMAL 계약을 날짜별로 검증하도록 정정한다.

  describe('getFomcProximity — FOMC 게이팅 제거됨 (항상 NORMAL)', () => {
    const fomcWindowDays = [
      '2026-04-26T03:00:00Z', // 구 PRE_3 (D-3)
      '2026-04-27T03:00:00Z', // 구 PRE_2 (D-2)
      '2026-04-28T03:00:00Z', // 구 PRE_1 (D-1)
      '2026-04-29T03:00:00Z', // 구 DAY (D+0)
      '2026-04-30T03:00:00Z', // 구 POST_1 (D+1)
      '2026-05-01T03:00:00Z', // 구 POST_2 (D+2)
    ];

    it('FOMC 발표 전후 어느 날짜에서도 NORMAL + Kelly 1.0 + noNewEntry=false (게이팅 제거)', () => {
      for (const iso of fomcWindowDays) {
        setNow(iso);
        const p = getFomcProximity();
        expect(p.phase).toBe('NORMAL');
        expect(p.kellyMultiplier).toBe(1.0);
        expect(p.noNewEntry).toBe(false);
      }
    });

    it('FOMC 발표 당일(구 DAY)도 차단 안 함 — Kelly 0/noNewEntry=true 회귀 부재', () => {
      setNow('2026-04-29T03:00:00Z'); // 구 DAY
      const p = getFomcProximity();
      expect(p.phase).not.toBe('DAY');
      expect(p.kellyMultiplier).not.toBe(0);
      expect(p.noNewEntry).toBe(false);
    });

    it('description 은 제거 마커 노출, 구 phase 안내(보수적 진입/신규 진입 금지) 부재', () => {
      setNow('2026-04-29T03:00:00Z');
      const p = getFomcProximity();
      expect(p.description).toBe('FOMC_GATING_REMOVED');
      expect(p.description).not.toContain('보수적 진입');
      expect(p.description).not.toContain('신규 진입 금지');
    });
  });

  describe('hedgeSignal — v2/v3 모두 항상 false', () => {
    it('모든 phase 에서 hedgeSignal 항상 false', () => {
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

  describe('전체 차단 기간 — 0일 (FOMC 게이팅 제거됨)', () => {
    it('4/26 ~ 5/1 6일 시뮬레이션 — 차단 0일 (구 DAY 차단도 제거)', () => {
      const days = [
        '2026-04-26T03:00:00Z', // 구 D-3
        '2026-04-27T03:00:00Z', // 구 D-2
        '2026-04-28T03:00:00Z', // 구 D-1
        '2026-04-29T03:00:00Z', // 구 D-day (이전엔 차단)
        '2026-04-30T03:00:00Z', // 구 D+1
        '2026-05-01T03:00:00Z', // 구 D+2
      ];

      const blockedCount = days.filter((iso) => {
        setNow(iso);
        return getFomcProximity().noNewEntry;
      }).length;

      // 구 계약: 1 (DAY). 현행(제거 후): 0.
      expect(blockedCount).toBe(0);
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

describe('applyFomcRelaxation v4 — DAY 만 우호 환경 완화 적용', () => {
  describe('DAY 외 phase — 완화 무관 (보수적 진입 또는 부스트 그대로)', () => {
    it('PRE_3 는 v4 에서 보수적 진입(0.75) — 완화 무관 (차단 phase 아님)', () => {
      const r = applyFomcRelaxation('PRE_3', 0.75, { mhs: 70, regime: 'BULL_NORMAL', vkospi: 18 });
      expect(r.relaxed).toBe(false);
      expect(r.effectiveKelly).toBe(0.75); // v4: default 0.75 그대로
      expect(r.noNewEntry).toBe(false);
      expect(r.reason).toContain('아님');
    });

    it('PRE_2 는 v4 에서 보수적 진입(0.75) — 완화 무관', () => {
      const r = applyFomcRelaxation('PRE_2', 0.75, { mhs: 30, regime: 'NEUTRAL', vkospi: 35 });
      expect(r.relaxed).toBe(false);
      expect(r.effectiveKelly).toBe(0.75); // v4: default 0.75 그대로
      expect(r.noNewEntry).toBe(false);
    });

    it('PRE_1 은 보수적 진입(0.75) — 완화 무관 (차단 phase 아님)', () => {
      const r = applyFomcRelaxation('PRE_1', 0.75, { mhs: 30, regime: 'NEUTRAL', vkospi: 35 });
      expect(r.relaxed).toBe(false);
      expect(r.effectiveKelly).toBe(0.75); // 차단 안 됨, default 0.75 그대로
      expect(r.noNewEntry).toBe(false);
    });

    it('NORMAL phase 도 완화 무관', () => {
      const r = applyFomcRelaxation('NORMAL', 1.0, { mhs: 70, regime: 'BULL_NORMAL', vkospi: 18 });
      expect(r.relaxed).toBe(false);
      expect(r.effectiveKelly).toBe(1.0);
    });

    it('POST_1 부스트 그대로 — 완화 무관', () => {
      const r = applyFomcRelaxation('POST_1', 1.30, undefined);
      expect(r.relaxed).toBe(false);
      expect(r.effectiveKelly).toBe(1.30);
      expect(r.noNewEntry).toBe(false);
    });
  });

  describe('DAY — macro 부재 또는 일부 누락 시 보수적 차단 유지', () => {
    it('macro 미전달 시 차단 유지', () => {
      const r = applyFomcRelaxation('DAY', 0, undefined);
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
      const r = applyFomcRelaxation('DAY', 0, { mhs: 70, vkospi: 18 });
      expect(r.relaxed).toBe(false);
      expect(r.noNewEntry).toBe(true);
    });
  });

  describe('DAY — 우호 환경 3조건 모두 충족 시 보수적 진입', () => {
    it('MHS 70 + BULL_NORMAL + VKOSPI 18 → 완화 적용 (Kelly ×0.3)', () => {
      const r = applyFomcRelaxation('DAY', 0, { mhs: 70, regime: 'BULL_NORMAL', vkospi: 18 });
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
      const r = applyFomcRelaxation('DAY', 0, { mhs: 65, regime: 'R1_BULL_AGGRESSIVE', vkospi: 20 });
      expect(r.relaxed).toBe(true);
    });
  });

  describe('DAY — 우호 환경 일부 미충족 시 차단 유지', () => {
    it('MHS 59 (임계 미달) → 차단', () => {
      const r = applyFomcRelaxation('DAY', 0, { mhs: 59, regime: 'BULL_NORMAL', vkospi: 18 });
      expect(r.relaxed).toBe(false);
      expect(r.noNewEntry).toBe(true);
      expect(r.reason).toContain('MHS ❌');
    });

    it('NEUTRAL 레짐은 우호 아님 → 차단', () => {
      const r = applyFomcRelaxation('DAY', 0, { mhs: 70, regime: 'NEUTRAL', vkospi: 18 });
      expect(r.relaxed).toBe(false);
      expect(r.reason).toContain('Regime ❌');
    });

    it('R6_DEFENSE 는 우호 아님 → 차단', () => {
      const r = applyFomcRelaxation('DAY', 0, { mhs: 70, regime: 'R6_DEFENSE', vkospi: 18 });
      expect(r.relaxed).toBe(false);
      expect(r.noNewEntry).toBe(true);
    });

    it('VKOSPI 23 (임계 초과) → 차단', () => {
      const r = applyFomcRelaxation('DAY', 0, { mhs: 70, regime: 'BULL_NORMAL', vkospi: 23 });
      expect(r.relaxed).toBe(false);
      expect(r.reason).toContain('VKOSPI ❌');
    });

    it('VKOSPI 누락 시 차단 (보수적)', () => {
      const r = applyFomcRelaxation('DAY', 0, { mhs: 70, regime: 'BULL_NORMAL' });
      expect(r.relaxed).toBe(false);
    });

    it('VKOSPI NaN 시 차단 (안전 fallback)', () => {
      const r = applyFomcRelaxation('DAY', 0, { mhs: 70, regime: 'BULL_NORMAL', vkospi: NaN });
      expect(r.relaxed).toBe(false);
    });
  });

  describe('getFomcProximity(macro) 통합 동작 — macro 인자 무시 (게이팅 제거됨)', () => {
    afterEach(() => vi.useRealTimers());

    // getFomcProximity 는 FomcRelaxationContext 인자를 받지만 본체에서 사용하지 않고
    // 항상 NORMAL 을 반환한다 (relaxed/relaxationReason 도 undefined). applyFomcRelaxation
    // 자체의 완화 로직은 별도 describe 에서 보존된 채로 검증됨 (live 함수).
    it('구 DAY 날짜 + 우호 macro 여도 relaxed undefined + noNewEntry=false (Kelly 1.0)', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-29T03:00:00Z'));
      const p = getFomcProximity({ mhs: 70, regime: 'BULL_NORMAL', vkospi: 18 });
      expect(p.phase).toBe('NORMAL');
      expect(p.relaxed).toBeUndefined();
      expect(p.relaxationReason).toBeUndefined();
      expect(p.noNewEntry).toBe(false);
      expect(p.kellyMultiplier).toBe(1.0);
    });

    it('구 DAY 날짜 + 비우호 macro 여도 차단 안 함 (NORMAL passthrough)', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-29T03:00:00Z'));
      const p = getFomcProximity({ mhs: 40, regime: 'NEUTRAL', vkospi: 28 });
      expect(p.noNewEntry).toBe(false);
      expect(p.kellyMultiplier).toBe(1.0);
    });

    it('macro 미전달 시도 NORMAL — 구 DAY 차단 회귀 부재', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-29T03:00:00Z'));
      const p = getFomcProximity();
      expect(p.relaxed).toBeUndefined();
      expect(p.noNewEntry).toBe(false);
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

describe('generateFomcIcs — v4 정책 반영', () => {
  it('ICS DESCRIPTION 이 "D-3~D-1 보수적 진입 + D-day 차단" 으로 갱신', () => {
    const ics = generateFomcIcs();
    expect(ics).toContain('D-3~D-1 보수적 진입');
    expect(ics).toContain('Kelly ×0.75');
    expect(ics).toContain('D-day 신규 진입 자동 차단');
    expect(ics).toContain('우호 환경 시 D-day 도 보수적 진입');
    expect(ics).not.toContain('D-3부터 신규 진입 자동 차단');
  });

  it('ICS VALARM D-1 경보 메시지가 "D-3 부터 보수적 진입" 안내로 갱신 (v4)', () => {
    const ics = generateFomcIcs();
    expect(ics).toContain('TRIGGER:-P1DT0H0M0S');
    expect(ics).toContain('D-3 부터 보수적 진입');
    expect(ics).toContain('D-day 신규 진입 자동 차단');
    expect(ics).not.toContain('FOMC D-1: 신규 진입 자동 차단');
  });
});

// ─── PR-1 (ADR-0061) FOMC DAY 보유 포지션 강제 청산 정책 ──────────────────────

describe('FomcDayLiquidationConfig — env 기반 default factory (PR-1, ADR-0061)', () => {
  const ENV_KEYS = [
    'FOMC_DAY_LIQUIDATION_ENABLED',
    'FOMC_DAY_LIQUIDATION_DRY_RUN',
    'FOMC_DAY_LIQUIDATION_START_KST',
    'FOMC_DAY_LIQUIDATION_COMPLETE_KST',
  ] as const;
  const savedEnv: Record<string, string | undefined> = {};

  function clearEnv(): void {
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
  }
  function restoreEnv(): void {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  }

  afterEach(() => {
    restoreEnv();
  });

  it('env 미설정 시 기본값 (enabled=true, 14:30~15:20, dryRun=false, preAlert 3건)', () => {
    clearEnv();
    const c = getDefaultFomcDayLiquidationConfig();
    expect(c.enabled).toBe(true);
    expect(c.liquidationStartKstTime).toBe('14:30');
    expect(c.liquidationCompleteKstTime).toBe('15:20');
    expect(c.dryRun).toBe(false);
    expect(c.preAlertKstTimes).toEqual(['09:00', '14:00', '14:30']);
  });

  it('FOMC_DAY_LIQUIDATION_ENABLED=false 시 enabled=false', () => {
    clearEnv();
    process.env.FOMC_DAY_LIQUIDATION_ENABLED = 'false';
    expect(getDefaultFomcDayLiquidationConfig().enabled).toBe(false);
  });

  it('FOMC_DAY_LIQUIDATION_START_KST 오버라이드 적용', () => {
    clearEnv();
    process.env.FOMC_DAY_LIQUIDATION_START_KST = '14:00';
    process.env.FOMC_DAY_LIQUIDATION_COMPLETE_KST = '15:00';
    const c = getDefaultFomcDayLiquidationConfig();
    expect(c.liquidationStartKstTime).toBe('14:00');
    expect(c.liquidationCompleteKstTime).toBe('15:00');
  });

  it('FOMC_DAY_LIQUIDATION_DRY_RUN=true 시 dryRun=true', () => {
    clearEnv();
    process.env.FOMC_DAY_LIQUIDATION_DRY_RUN = 'true';
    expect(getDefaultFomcDayLiquidationConfig().dryRun).toBe(true);
  });
});

describe('shouldExecuteLiquidationAt — 5중 가드 SSOT (PR-1, ADR-0061)', () => {
  const savedAutoTrade = process.env.AUTO_TRADE_ENABLED;
  function setAutoTrade(v: 'true' | 'false' | undefined): void {
    if (v === undefined) delete process.env.AUTO_TRADE_ENABLED;
    else process.env.AUTO_TRADE_ENABLED = v;
  }
  afterEach(() => {
    vi.useRealTimers();
    if (savedAutoTrade === undefined) delete process.env.AUTO_TRADE_ENABLED;
    else process.env.AUTO_TRADE_ENABLED = savedAutoTrade;
  });

  // 출력/정책 drift 근거 (intent proof — 맹목 갱신 아님):
  //   shouldExecuteLiquidationAt 가드 1(L334)은 getFomcProximity().phase!=='DAY' 면
  //   즉시 NOT_DAY_PHASE 반환한다. getFomcProximity 가 FOMC 게이팅 제거로 항상 NORMAL 을
  //   반환하므로(L190~204) 가드 1 이 *항상* 먼저 발동 → 가드 2~5(DISABLED/AUTO_TRADE/
  //   EMERGENCY/시각 boundary)는 구조적으로 도달 불가. 구 ADR-0061 5중 가드 통과(OK)
  //   단언은 제거된 동작이므로, 현행 always-NOT_DAY_PHASE 단락 계약을 검증한다.
  //   ※ 가드 2~5 본체는 production 에 잔존(시그니처 호환)하나 enforcement 는 dead.
  const dayPhase14_30Kst = new Date('2026-04-29T05:30:00Z'); // 구 FOMC DAY 14:30 KST
  const dayPhase15_19Kst = new Date('2026-04-29T06:19:00Z');

  it('FOMC 게이팅 제거 — 구 DAY 날짜·OK 시각이어도 항상 NOT_DAY_PHASE (가드 1 단락)', () => {
    setAutoTrade('true');
    setNow(dayPhase14_30Kst.toISOString());
    const result = shouldExecuteLiquidationAt(dayPhase14_30Kst, {
      getEmergencyStop: () => false,
    });
    expect(result.execute).toBe(false);
    expect(result.reason).toBe('NOT_DAY_PHASE');
  });

  it('가드 2~5 도달 불가 — config/env/emergencyStop/시각 무관하게 NOT_DAY_PHASE', () => {
    // 구 계약에선 각각 DISABLED/AUTO_TRADE_DISABLED/EMERGENCY_STOP/BEFORE/AFTER 를 기대했으나
    // 게이팅 제거 후 가드 1 이 모두 선점 → 어떤 입력 조합이어도 NOT_DAY_PHASE.
    setAutoTrade('true');
    setNow(dayPhase14_30Kst.toISOString());

    // 가드 2 후보: enabled=false 여도 NOT_DAY_PHASE.
    expect(shouldExecuteLiquidationAt(dayPhase14_30Kst, {
      config: { ...getDefaultFomcDayLiquidationConfig(), enabled: false },
      getEmergencyStop: () => false,
    }).reason).toBe('NOT_DAY_PHASE');

    // 가드 3 후보: AUTO_TRADE_ENABLED 미설정이어도 NOT_DAY_PHASE.
    setAutoTrade(undefined);
    expect(shouldExecuteLiquidationAt(dayPhase14_30Kst, {
      getEmergencyStop: () => false,
    }).reason).toBe('NOT_DAY_PHASE');

    // 가드 4 후보: emergencyStop=true 여도 NOT_DAY_PHASE.
    setAutoTrade('true');
    expect(shouldExecuteLiquidationAt(dayPhase14_30Kst, {
      getEmergencyStop: () => true,
    }).reason).toBe('NOT_DAY_PHASE');

    // 가드 5 후보: OK 시각(14:30/15:19)이어도 execute=true 부재 → NOT_DAY_PHASE.
    setNow(dayPhase15_19Kst.toISOString());
    const r = shouldExecuteLiquidationAt(dayPhase15_19Kst, { getEmergencyStop: () => false });
    expect(r.execute).toBe(false);
    expect(r.reason).toBe('NOT_DAY_PHASE');
  });
});
