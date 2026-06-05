/**
 * @responsibility ADR-0419 회귀 — R3 SHADOW_ONLY pre-scan 발화 가능 여부 SSOT
 *
 * 사용자 명시 시나리오 A~F + 정책 우선순위 + preflight wiring 정적 가드.
 *
 * 절대 원칙 (사용자 명시 — 본 테스트가 영구 보호):
 *   - SELL_ONLY / VolumeClock closed / R6 / VIX / FOMC / 데이터 빈곤 시점에는
 *     SHADOW_ONLY pre-scan 자체 trigger 0.
 *   - 정상 거래일 + GATE1_PASS_ZERO 누적 시점에만 SHADOW_ONLY pre-scan 발화 허용.
 *   - HARD_BLOCK latch (영속, ADR-0120) 는 본 PR scope 외 — 변경 0.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  evaluateR3CountableScan,
  evaluateStreakIncrementAllowed,
  type StreakSkipContext,
} from './r3StreakSkipPolicy.js';

function makeCtx(overrides: Partial<StreakSkipContext> = {}): StreakSkipContext {
  return {
    todayKstDate: '2026-05-07',
    isKrxTradingDay: true,
    volumeClockAllowsEntry: true,
    emergencyStop: false,
    manualBlockNewBuy: false,
    manualManageOnly: false,
    sellOnlyMode: false,
    regime: 'R3_EARLY',
    bearDefenseMode: false,
    vixGatingActive: false,
    fomcBlockActive: false,
    dataStarvedScan: false,
    frozenQuoteDataQuality: 'OK',
    ...overrides,
  };
}

describe('ADR-0419 시나리오 A~F — SHADOW_ONLY pre-scan 발화 가능 여부', () => {
  it('A. SELL_ONLY 모드 → countable=false (SELL_ONLY_MODE)', () => {
    const result = evaluateR3CountableScan(makeCtx({ sellOnlyMode: true }));
    expect(result.countable).toBe(false);
    expect(result.skipReason).toBe('SELL_ONLY_MODE');
  });

  it('B. VolumeClock closed (점심·장외 시간대) → countable=false (VOLUME_CLOCK_CLOSED)', () => {
    const result = evaluateR3CountableScan(makeCtx({ volumeClockAllowsEntry: false }));
    expect(result.countable).toBe(false);
    expect(result.skipReason).toBe('VOLUME_CLOCK_CLOSED');
  });

  it('C. R6_DEFENSE / VIX / FOMC 거시 게이트 활성 → countable=false (개별 reason)', () => {
    const r1 = evaluateR3CountableScan(makeCtx({ regime: 'R6_DEFENSE' }));
    expect(r1.countable).toBe(false);
    expect(r1.skipReason).toBe('R6_DEFENSE_REGIME');

    const r2 = evaluateR3CountableScan(makeCtx({ vixGatingActive: true }));
    expect(r2.countable).toBe(false);
    expect(r2.skipReason).toBe('VIX_BLOCK');

    const r3 = evaluateR3CountableScan(makeCtx({ fomcBlockActive: true }));
    expect(r3.countable).toBe(false);
    expect(r3.skipReason).toBe('FOMC_BLOCK');
  });

  it('D. 운영자 수동 가드 (manualBlockNewBuy / manualManageOnly / emergencyStop) → countable=false', () => {
    const r1 = evaluateR3CountableScan(makeCtx({ emergencyStop: true }));
    expect(r1.countable).toBe(false);
    expect(r1.skipReason).toBe('EMERGENCY_STOP');

    const r2 = evaluateR3CountableScan(makeCtx({ manualBlockNewBuy: true }));
    expect(r2.countable).toBe(false);
    expect(r2.skipReason).toBe('MANUAL_BLOCK_NEW_BUY');

    const r3 = evaluateR3CountableScan(makeCtx({ manualManageOnly: true }));
    expect(r3.countable).toBe(false);
    expect(r3.skipReason).toBe('MANUAL_BLOCK_NEW_BUY');
  });

  it('E. 데이터 빈곤 스캔 → countable=false (DATA_STARVED_SCAN)', () => {
    const result = evaluateR3CountableScan(makeCtx({ dataStarvedScan: true }));
    expect(result.countable).toBe(false);
    expect(result.skipReason).toBe('DATA_STARVED_SCAN');
  });

  it('F. 정상 거래일 + 모든 게이트 OK → countable=true (SHADOW_ONLY pre-scan 발화 허용)', () => {
    const result = evaluateR3CountableScan(makeCtx());
    expect(result.countable).toBe(true);
    expect(result.skipReason).toBeUndefined();
  });
});

describe('ADR-0419 우선순위 결정 트리 (evaluateStreakIncrementAllowed)', () => {
  it('KRX 휴장일이 다른 모든 조건보다 우선', () => {
    const result = evaluateStreakIncrementAllowed(
      makeCtx({ isKrxTradingDay: false, sellOnlyMode: true, regime: 'R6_DEFENSE' }),
    );
    expect(result.skipReason).toBe('KRX_NON_TRADING_DAY');
  });

  it('VolumeClock closed 가 emergencyStop / sellOnly 보다 우선', () => {
    const result = evaluateStreakIncrementAllowed(
      makeCtx({ volumeClockAllowsEntry: false, emergencyStop: true, sellOnlyMode: true }),
    );
    expect(result.skipReason).toBe('VOLUME_CLOCK_CLOSED');
  });

  it('emergencyStop 이 manualBlock / sellOnly 보다 우선', () => {
    const result = evaluateStreakIncrementAllowed(
      makeCtx({ emergencyStop: true, manualBlockNewBuy: true, sellOnlyMode: true }),
    );
    expect(result.skipReason).toBe('EMERGENCY_STOP');
  });

  it('manualBlock 이 sellOnly 보다 우선', () => {
    const result = evaluateStreakIncrementAllowed(
      makeCtx({ manualBlockNewBuy: true, sellOnlyMode: true }),
    );
    expect(result.skipReason).toBe('MANUAL_BLOCK_NEW_BUY');
  });

  it('sellOnly 가 R6_DEFENSE / VIX / FOMC 보다 우선', () => {
    const result = evaluateStreakIncrementAllowed(
      makeCtx({ sellOnlyMode: true, regime: 'R6_DEFENSE', vixGatingActive: true, fomcBlockActive: true }),
    );
    expect(result.skipReason).toBe('SELL_ONLY_MODE');
  });

  it('R6_DEFENSE 가 VIX / FOMC 보다 우선', () => {
    const result = evaluateStreakIncrementAllowed(
      makeCtx({ regime: 'R6_DEFENSE', vixGatingActive: true, fomcBlockActive: true }),
    );
    expect(result.skipReason).toBe('R6_DEFENSE_REGIME');
  });

  it('VIX 가 FOMC 보다 우선', () => {
    const result = evaluateStreakIncrementAllowed(
      makeCtx({ vixGatingActive: true, fomcBlockActive: true }),
    );
    expect(result.skipReason).toBe('VIX_BLOCK');
  });

  it('FOMC 가 bearDefenseMode 보다 우선', () => {
    const result = evaluateStreakIncrementAllowed(
      makeCtx({ fomcBlockActive: true, bearDefenseMode: true }),
    );
    expect(result.skipReason).toBe('FOMC_BLOCK');
  });

  it('bearDefenseMode (BLOCKED_DAY_SCAN) 가 dataStarved 보다 우선', () => {
    const result = evaluateStreakIncrementAllowed(
      makeCtx({ bearDefenseMode: true, dataStarvedScan: true }),
    );
    expect(result.skipReason).toBe('BLOCKED_DAY_SCAN');
  });

  it('dataStarvedScan 이 frozenQuote STALE 보다 우선', () => {
    const result = evaluateStreakIncrementAllowed(
      makeCtx({ dataStarvedScan: true, frozenQuoteDataQuality: 'STALE' }),
    );
    expect(result.skipReason).toBe('DATA_STARVED_SCAN');
  });

  it('frozenQuote STALE 단독 → FROZEN_QUOTE_STALE', () => {
    const result = evaluateStreakIncrementAllowed(makeCtx({ frozenQuoteDataQuality: 'STALE' }));
    expect(result.skipReason).toBe('FROZEN_QUOTE_STALE');
  });

  it('frozenQuote SUSPECT (보수적) → 통과', () => {
    const result = evaluateStreakIncrementAllowed(makeCtx({ frozenQuoteDataQuality: 'SUSPECT' }));
    expect(result.allowed).toBe(true);
  });
});

describe('ADR-0419 evaluateR3CountableScan ↔ evaluateStreakIncrementAllowed 동등성', () => {
  it('두 함수가 항상 같은 결정을 반환 (countable === allowed)', () => {
    const cases: Partial<StreakSkipContext>[] = [
      { isKrxTradingDay: false },
      { volumeClockAllowsEntry: false },
      { emergencyStop: true },
      { manualBlockNewBuy: true },
      { sellOnlyMode: true },
      { regime: 'R6_DEFENSE' },
      { vixGatingActive: true },
      { fomcBlockActive: true },
      { bearDefenseMode: true },
      { dataStarvedScan: true },
      { frozenQuoteDataQuality: 'STALE' },
      {}, // 정상
    ];
    for (const overrides of cases) {
      const ctx = makeCtx(overrides);
      const a = evaluateStreakIncrementAllowed(ctx);
      const b = evaluateR3CountableScan(ctx);
      expect(b.countable).toBe(a.allowed);
      expect(b.skipReason).toBe(a.skipReason);
    }
  });
});

describe('ADR-0419 정적 grep 가드 — preflight.ts wiring', () => {
  const PREFLIGHT_PATH = resolve(process.cwd(), 'server/trading/signalScanner/preflight.ts');
  const source = readFileSync(PREFLIGHT_PATH, 'utf-8');

  it('preflight.ts 가 evaluateR3CountableScan 을 import', () => {
    expect(source).toMatch(/import\s+\{[^}]*evaluateR3CountableScan[^}]*\}\s+from\s+['"]\.\/r3StreakSkipPolicy/);
  });

  it('preflight.ts 가 isKrxTradingDay 를 import', () => {
    expect(source).toMatch(/import\s+\{[^}]*isKrxTradingDay[^}]*\}\s+from\s+['"]\.\.\/\.\.\/calendar\/krxTradingCalendar/);
  });

  it('SHADOW_ONLY pre-scan 분기가 ADR-0419 주석 안에 위치', () => {
    expect(source).toMatch(/ADR-0419[\s\S]{0,200}evaluateR3CountableScan/);
  });

  it('SHADOW_ONLY pre-scan 이 volumeClock check 보다 *뒤*에 위치 (sellOnly/R6/VIX/FOMC/data-starved/volumeClock 모두 통과 후만 도달)', () => {
    const volumeClockIdx = source.indexOf('!volumeClock.allowEntry');
    const shadowOnlyIdx = source.indexOf('R3 SHADOW_ONLY ephemeral block');
    expect(volumeClockIdx).toBeGreaterThan(0);
    expect(shadowOnlyIdx).toBeGreaterThan(0);
    expect(shadowOnlyIdx).toBeGreaterThan(volumeClockIdx);
  });

  it('회귀 가드 — old 위치 (sellOnly check 이전) 의 SHADOW_ONLY 분기 부재', () => {
    // 이전 SHADOW_ONLY 분기는 sellOnly check 이전에 있었음. 이제 그 자리는 ADR-0419 주석만 있어야 함.
    const sellOnlyIdx = source.indexOf('const sellOnlyExc = optSellOnly');
    const r3Block = source.slice(0, sellOnlyIdx);
    expect(r3Block).toMatch(/R3 SHADOW_ONLY ephemeral block/);
    expect(r3Block).toMatch(/ADR-0419/);
  });

  it('countability skipReason 5종 (EMERGENCY_STOP/MANUAL_BLOCK_NEW_BUY/SELL_ONLY/R6/VIX/FOMC) 모두 ctx 매핑됨', () => {
    expect(source).toMatch(/emergencyStop:\s*getEmergencyStop\(\)/);
    expect(source).toMatch(/manualBlockNewBuy/);
    expect(source).toMatch(/manualManageOnly/);
    expect(source).toMatch(/sellOnlyMode:\s*false/);
    expect(source).toMatch(/vixGatingActive:\s*vixGating\.noNewEntry/);
    expect(source).toMatch(/fomcBlockActive:\s*fomcProximity\.noNewEntry/);
  });
});

describe('ADR-0419 StreakSkipReason union 11종 정합', () => {
  it('11 reason value 모두 evaluateStreakIncrementAllowed 출력으로 도달 가능', () => {
    const reasons = new Set<string>();
    // 각 컨텍스트는 우선순위상 해당 reason 이 첫 매칭이 되도록 구성 (단독 활성).
    const cases: Array<[Partial<StreakSkipContext>, string]> = [
      [{ isKrxTradingDay: false }, 'KRX_NON_TRADING_DAY'],
      [{ volumeClockAllowsEntry: false }, 'VOLUME_CLOCK_CLOSED'],
      [{ emergencyStop: true }, 'EMERGENCY_STOP'],
      [{ manualBlockNewBuy: true }, 'MANUAL_BLOCK_NEW_BUY'],
      [{ sellOnlyMode: true }, 'SELL_ONLY_MODE'],
      [{ regime: 'R6_DEFENSE' }, 'R6_DEFENSE_REGIME'],
      [{ vixGatingActive: true }, 'VIX_BLOCK'],
      [{ fomcBlockActive: true }, 'FOMC_BLOCK'],
      [{ bearDefenseMode: true }, 'BLOCKED_DAY_SCAN'],
      [{ dataStarvedScan: true }, 'DATA_STARVED_SCAN'],
      [{ frozenQuoteDataQuality: 'STALE' }, 'FROZEN_QUOTE_STALE'],
    ];
    for (const [overrides, expected] of cases) {
      const result = evaluateStreakIncrementAllowed(makeCtx(overrides));
      expect(result.skipReason).toBe(expected);
      reasons.add(result.skipReason!);
    }
    expect(reasons.size).toBe(11);
  });
});
