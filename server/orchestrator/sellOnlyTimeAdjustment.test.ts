/**
 * @responsibility ALWAYS-ON 시간대 정책 회귀 테스트 (구 ADR-0122 SELL_ONLY 시간조정 대체)
 *
 * 사용자 5/27: always-on — 장중 전 시간 매수 허용. 시간대(시초가/점심/마감) 기반 SELL_ONLY 제거,
 * 볼륨클록은 가/감점 전용. decideScan 의 시간 구간은 스캔 *빈도* 만 조정하고 매매를 차단하지 않는다.
 * R6 정책은 폐기한다. 실측 VKOSPI 급등은 관측을 앞당기며 기존 시간대별 스캔 빈도는 유지한다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { decideScan, resetScanState } from './adaptiveScanScheduler.js';

const market = vi.hoisted(() => ({ vkospiDayChange: 0 }));
const retiredRegime = vi.hoisted(() => vi.fn(() => { throw new Error('REGIME_RETIRED'); }));
vi.mock('../persistence/macroStateRepo.js', () => ({
  loadMacroState: () => ({ regime: 'R6_DEFENSE', vkospiDayChange: market.vkospiDayChange }),
}));
vi.mock('../persistence/shadowTradeRepo.js', () => ({ loadShadowTrades: () => [] }));
vi.mock('../trading/regime/canonicalRegimeAccess.js', () => ({ resolveCanonicalRegimeLevel: retiredRegime }));

function kstTime(hour: number, minute: number): Date {
  return new Date(Date.UTC(2026, 4, 8, hour - 9, minute)); // Friday
}

describe('ALWAYS-ON 시간대 정책 — decideScan 시간대 기반 SELL_ONLY 제거', () => {
  const sourcePath = path.resolve(__dirname, 'adaptiveScanScheduler.base.ts');
  const source = fs.readFileSync(sourcePath, 'utf-8');

  beforeEach(() => {
    resetScanState();
    market.vkospiDayChange = 0;
    retiredRegime.mockClear();
    vi.useFakeTimers();
    vi.stubEnv('MAX_CONVICTION_POSITIONS', '10');
    vi.stubEnv('TRADE_WINDOW_LEGACY_HOURS', 'false');
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it('시간대 기반 forceSellOnly = true 가 존재하지 않는다', () => {
    expect(source).not.toMatch(/forceSellOnly = true/);
  });

  it('시간대 phase 라벨에 SELL_ONLY 가 없다 (시초가/점심/마감)', () => {
    expect(source).not.toMatch(/시초가\(SELL_ONLY/);
    expect(source).not.toMatch(/점심\(SELL_ONLY\)/);
    expect(source).not.toMatch(/마감\(SELL_ONLY\)/);
  });

  it('always-on phase 라벨 적용 (점심 저빈도 관찰 / 마감 관찰 / 시초가 변동성 회피)', () => {
    expect(source).toMatch(/점심\(저빈도 관찰\)/);
    expect(source).toMatch(/마감\(관찰\)/);
    expect(source).toMatch(/시초가\(변동성 회피\)/);
  });

  it('REMOVED_POLICY_INPUT_IGNORED 시간대 SELL_ONLY 중화 블록이 제거됨', () => {
    // 시간대 SELL_ONLY 자체가 없으므로 중화/롤백 표시 블록도 불필요 — 제거 정합.
    expect(source).not.toMatch(/REMOVED_POLICY_INPUT_IGNORED/);
    expect(source).not.toMatch(/ROLLBACK_DISABLED/);
  });

  it('점심 구간 스캔 빈도(baseInterval=10) + lastLunchBlockSeenAt 재개 로직 보존', () => {
    expect(source).toMatch(/baseInterval = 10/);
    expect(source).toMatch(/lastLunchBlockSeenAt = now/);
  });

  it.each([
    [9, 10, 4],
    [12, 10, 9],
    [15, 10, 1],
  ])('%i:%i KST 관측은 stale R6와 무관하게 기존 %i분 주기로 실행한다', (hour, minute, intervalMinutes) => {
    const now = kstTime(hour, minute);
    vi.setSystemTime(now);
    expect(decideScan()).toMatchObject({ shouldScan: true, intervalMinutes, priority: 'FULL' });
    vi.setSystemTime(new Date(now.getTime() + intervalMinutes * 60_000 - 1));
    expect(decideScan()).toMatchObject({ shouldScan: false, intervalMinutes, priority: 'SKIP' });
    vi.setSystemTime(new Date(now.getTime() + intervalMinutes * 60_000));
    expect(decideScan()).toMatchObject({ shouldScan: true, intervalMinutes, priority: 'FULL' });
    expect(retiredRegime).not.toHaveBeenCalled();
  });

  it('실측 VKOSPI 급등은 즉시 FULL 관측하고 다음 tick에는 기존 쿨다운을 적용한다', () => {
    const now = kstTime(10, 0);
    vi.setSystemTime(now);
    expect(decideScan()).toMatchObject({ shouldScan: true, intervalMinutes: 2, priority: 'FULL' });
    market.vkospiDayChange = 6;
    vi.setSystemTime(new Date(now.getTime() + 1_000));
    expect(decideScan()).toMatchObject({ shouldScan: true, intervalMinutes: 0, priority: 'FULL' });
    vi.setSystemTime(new Date(now.getTime() + 2_000));
    expect(decideScan()).toMatchObject({ shouldScan: false, intervalMinutes: 2, priority: 'SKIP' });
    expect(retiredRegime).not.toHaveBeenCalled();
  });
});
