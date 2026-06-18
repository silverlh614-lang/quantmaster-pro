// @responsibility ADR-0624 D4 /promote_learning 권한 회귀 — 전역 chat 게이트 위임(admin IDs 미설정 시 허용)·설정 시 화이트리스트 강제.
import { describe, it, expect, afterEach } from 'vitest';
import { resolvePromotePermission } from './promoteLearning.cmd.js';

const KEY = 'TELEGRAM_ADMIN_USER_IDS';

afterEach(() => {
  delete process.env[KEY];
});

describe('ADR-0624 D4 /promote_learning permission', () => {
  it('status 는 항상 허용(read-only)', () => {
    expect(resolvePromotePermission({ userId: 'anyone' }, 'status')).toBe(true);
    expect(resolvePromotePermission({ userId: undefined }, 'status')).toBe(true);
  });

  it('admin IDs 미설정 → apply/revert 허용(전역 chat 게이트 위임 — 운영자 차단 금지)', () => {
    delete process.env[KEY];
    expect(resolvePromotePermission({ userId: '8123456789' }, 'apply')).toBe(true);
    expect(resolvePromotePermission({ userId: undefined }, 'revert')).toBe(true);
  });

  it('admin IDs 설정 시 화이트리스트 강제', () => {
    process.env[KEY] = '999,1000';
    expect(resolvePromotePermission({ userId: '999' }, 'apply')).toBe(true);
    expect(resolvePromotePermission({ userId: '8123456789' }, 'apply')).toBe(false);
    expect(resolvePromotePermission({ userId: undefined }, 'apply')).toBe(false);
  });
});
