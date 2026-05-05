/**
 * @responsibility ADR-0184 (PR-B12-A) ENV 우회 헬퍼 정합성 회귀.
 * `isEmergencyMasterGuardScanEnabled` (default OFF) +
 * `isEmergencyWatchlistCodeGuardEnabled` (default ON) ENV gate 분기 검증.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  isEmergencyMasterGuardScanEnabled,
  isEmergencyWatchlistCodeGuardEnabled,
} from './emergencyDataQualityGuards';

const ORIGINAL_MASTER_ENV = process.env.EMERGENCY_MASTER_GUARD_SCAN_ENABLED;
const ORIGINAL_WATCHLIST_ENV = process.env.EMERGENCY_WATCHLIST_CODE_GUARD_DISABLED;

function clearAdrEnv(): void {
  delete process.env.EMERGENCY_MASTER_GUARD_SCAN_ENABLED;
  delete process.env.EMERGENCY_WATCHLIST_CODE_GUARD_DISABLED;
}

function restoreAdrEnv(): void {
  if (ORIGINAL_MASTER_ENV === undefined) delete process.env.EMERGENCY_MASTER_GUARD_SCAN_ENABLED;
  else process.env.EMERGENCY_MASTER_GUARD_SCAN_ENABLED = ORIGINAL_MASTER_ENV;
  if (ORIGINAL_WATCHLIST_ENV === undefined) delete process.env.EMERGENCY_WATCHLIST_CODE_GUARD_DISABLED;
  else process.env.EMERGENCY_WATCHLIST_CODE_GUARD_DISABLED = ORIGINAL_WATCHLIST_ENV;
}

describe('ADR-0184 (PR-B12-A) ENV 헬퍼', () => {
  beforeEach(clearAdrEnv);
  afterEach(restoreAdrEnv);

  describe('isEmergencyMasterGuardScanEnabled (default OFF)', () => {
    it('미설정 시 false 반환 (default OFF — 회귀 위험 격리)', () => {
      expect(isEmergencyMasterGuardScanEnabled()).toBe(false);
    });

    it('"true" 정확 비교 시 true', () => {
      process.env.EMERGENCY_MASTER_GUARD_SCAN_ENABLED = 'true';
      expect(isEmergencyMasterGuardScanEnabled()).toBe(true);
    });

    it('"1" / "TRUE" / "yes" 거부 (정확 비교 의무)', () => {
      process.env.EMERGENCY_MASTER_GUARD_SCAN_ENABLED = '1';
      expect(isEmergencyMasterGuardScanEnabled()).toBe(false);
      process.env.EMERGENCY_MASTER_GUARD_SCAN_ENABLED = 'TRUE';
      expect(isEmergencyMasterGuardScanEnabled()).toBe(false);
      process.env.EMERGENCY_MASTER_GUARD_SCAN_ENABLED = 'yes';
      expect(isEmergencyMasterGuardScanEnabled()).toBe(false);
    });

    it('"false" 명시 시 false', () => {
      process.env.EMERGENCY_MASTER_GUARD_SCAN_ENABLED = 'false';
      expect(isEmergencyMasterGuardScanEnabled()).toBe(false);
    });
  });

  describe('isEmergencyWatchlistCodeGuardEnabled (default ON)', () => {
    it('미설정 시 true 반환 (default ON — 잘못된 code 영구 차단)', () => {
      expect(isEmergencyWatchlistCodeGuardEnabled()).toBe(true);
    });

    it('"true" 명시 시 true (default 와 동일)', () => {
      process.env.EMERGENCY_WATCHLIST_CODE_GUARD_DISABLED = 'true';
      expect(isEmergencyWatchlistCodeGuardEnabled()).toBe(false);
    });

    it('"false" 명시 시 true', () => {
      process.env.EMERGENCY_WATCHLIST_CODE_GUARD_DISABLED = 'false';
      expect(isEmergencyWatchlistCodeGuardEnabled()).toBe(true);
    });

    it('"1" / "TRUE" 거부 (정확 비교 의무) — guard 활성 유지', () => {
      process.env.EMERGENCY_WATCHLIST_CODE_GUARD_DISABLED = '1';
      expect(isEmergencyWatchlistCodeGuardEnabled()).toBe(true);
      process.env.EMERGENCY_WATCHLIST_CODE_GUARD_DISABLED = 'TRUE';
      expect(isEmergencyWatchlistCodeGuardEnabled()).toBe(true);
    });

    it('빈 문자열 시 true (default 보수)', () => {
      process.env.EMERGENCY_WATCHLIST_CODE_GUARD_DISABLED = '';
      expect(isEmergencyWatchlistCodeGuardEnabled()).toBe(true);
    });
  });
});
