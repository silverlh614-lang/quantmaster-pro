/**
 * @responsibility check_deploy_window 회귀 테스트 — 주말/장외/거래일장중/KRX휴장일 판정.
 *
 * Patch-CI-DEPLOY-WINDOW-HOLIDAY-001: 가드가 KRX 휴장일(석가탄신일 등)을 거래일로
 * 오인해 장중 배포를 막던 오탐을 차단. 휴장일 SSOT(krxHolidayDates.js) 참조 검증.
 */

import { describe, it, expect } from 'vitest';
import { isDeployBlocked, isKrxHoliday } from './check_deploy_window.js';

// weekday: 0=일 .. 6=토 / minuteOfDay: KST 분 / dateYmd: KST YYYY-MM-DD
const at = (weekday, hour, minute, dateYmd) => ({ weekday, minuteOfDay: hour * 60 + minute, dateYmd });

describe('check_deploy_window — 배포 금지 창 판정', () => {
  it('주말(토·일)은 시각 무관 허용', () => {
    expect(isDeployBlocked(at(6, 11, 0, '2026-05-23'))).toBe(false); // 토
    expect(isDeployBlocked(at(0, 11, 0, '2026-05-24'))).toBe(false); // 일
  });

  it('거래일 장중(08:30~16:30)은 차단', () => {
    expect(isDeployBlocked(at(5, 8, 30, '2026-05-22'))).toBe(true);  // 경계 08:30
    expect(isDeployBlocked(at(5, 11, 0, '2026-05-22'))).toBe(true);  // 정중앙
    expect(isDeployBlocked(at(5, 16, 30, '2026-05-22'))).toBe(true); // 경계 16:30
  });

  it('거래일 장외(~08:29, 16:31~)는 허용', () => {
    expect(isDeployBlocked(at(5, 8, 29, '2026-05-22'))).toBe(false);
    expect(isDeployBlocked(at(5, 16, 31, '2026-05-22'))).toBe(false);
  });

  it('KRX 휴장일은 장중 시각이어도 허용 (석가탄신일 2026-05-25 월)', () => {
    expect(isDeployBlocked(at(1, 11, 0, '2026-05-25'))).toBe(false);
  });

  it('isKrxHoliday — SSOT 등재 휴장일 true / 일반 거래일 false', () => {
    expect(isKrxHoliday('2026-05-25')).toBe(true);  // 석가탄신일
    expect(isKrxHoliday('2026-01-01')).toBe(true);  // 신정
    expect(isKrxHoliday('2026-05-22')).toBe(false); // 일반 거래일(금)
  });
});
