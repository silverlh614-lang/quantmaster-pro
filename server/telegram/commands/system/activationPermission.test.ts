// @responsibility ADR-0636 addendum — resolveActivationPermission 게이팅 회귀: allowlist 엄격·소유자 chat fallback·레거시 폴백·env 격리.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveActivationPermission } from './activationPermission.js';

const KEYS = ['TELEGRAM_OPERATOR_USER_IDS', 'TELEGRAM_ADMIN_USER_IDS', 'TELEGRAM_CHAT_ID'];

function clear(): void {
  for (const k of KEYS) delete process.env[k];
}

beforeEach(clear);
afterEach(clear);

describe('resolveActivationPermission — allowlist 모드 (엄격)', () => {
  it('operator allowlist 매칭 userId → 통과', () => {
    process.env.TELEGRAM_OPERATOR_USER_IDS = '111,222';
    expect(resolveActivationPermission({ userId: '222', chatId: '999' })).toBe(true);
  });

  it('allowlist 설정 + 미매칭 userId → 거부 (소유자 chat 여도)', () => {
    process.env.TELEGRAM_OPERATOR_USER_IDS = '111';
    process.env.TELEGRAM_CHAT_ID = '555';
    // allowlist 모드에서는 chat fallback 이 적용되지 않는다 (엄격 매칭 우선).
    expect(resolveActivationPermission({ userId: '999', chatId: '555' })).toBe(false);
  });

  it('admin allowlist 매칭 → 통과', () => {
    process.env.TELEGRAM_ADMIN_USER_IDS = '777';
    expect(resolveActivationPermission({ userId: '777', chatId: '1' })).toBe(true);
  });
});

describe('resolveActivationPermission — 소유자 chat fallback (allowlist 미설정)', () => {
  it('chatId === TELEGRAM_CHAT_ID → 숫자 userId 여도 통과', () => {
    process.env.TELEGRAM_CHAT_ID = '555';
    expect(resolveActivationPermission({ userId: '123456789', chatId: '555' })).toBe(true);
  });

  it('chatId !== TELEGRAM_CHAT_ID + 숫자 userId → 거부', () => {
    process.env.TELEGRAM_CHAT_ID = '555';
    expect(resolveActivationPermission({ userId: '123456789', chatId: '111' })).toBe(false);
  });

  it('TELEGRAM_CHAT_ID 미설정 + 숫자 userId → 거부 (레거시 폴백)', () => {
    expect(resolveActivationPermission({ userId: '123456789', chatId: '555' })).toBe(false);
  });

  it('공백 chatId 는 ownerChatId 와 매칭되지 않는다', () => {
    process.env.TELEGRAM_CHAT_ID = '   ';
    expect(resolveActivationPermission({ userId: '123', chatId: '   ' })).toBe(false);
  });
});

describe('resolveActivationPermission — 레거시 폴백', () => {
  it('userId 미상 → 통과 (unattributed 로컬/내부 호출)', () => {
    expect(resolveActivationPermission({ userId: undefined, chatId: undefined })).toBe(true);
  });

  it("리터럴 'operator'/'admin'/'system' → 통과", () => {
    expect(resolveActivationPermission({ userId: 'operator', chatId: '1' })).toBe(true);
    expect(resolveActivationPermission({ userId: 'admin', chatId: '1' })).toBe(true);
    expect(resolveActivationPermission({ userId: 'system', chatId: '1' })).toBe(true);
  });
});
