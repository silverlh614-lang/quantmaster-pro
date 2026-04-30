// @responsibility credentialExpiryWatchdog — D-임계 분기 + 영속 dedupe + ENV 우회 회귀 (ADR-0131)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let tmpDir: string;
const origDataDir = process.env.PERSIST_DATA_DIR;
const origDisabled = process.env.CREDENTIAL_WATCHDOG_DISABLED;

type AlertOpts = { priority?: string; dedupeKey?: string; cooldownMs?: number; category?: string };
const sendTelegramAlertMock = vi.fn(async (_msg: string, _opts?: AlertOpts) => 1);
vi.mock('../alerts/telegramClient.js', () => ({
  sendTelegramAlert: sendTelegramAlertMock,
}));

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cred-watchdog-'));
  process.env.PERSIST_DATA_DIR = tmpDir;
  delete process.env.CREDENTIAL_WATCHDOG_DISABLED;
  sendTelegramAlertMock.mockClear();
  vi.resetModules();
});

afterEach(() => {
  if (origDataDir === undefined) delete process.env.PERSIST_DATA_DIR;
  else process.env.PERSIST_DATA_DIR = origDataDir;
  if (origDisabled === undefined) delete process.env.CREDENTIAL_WATCHDOG_DISABLED;
  else process.env.CREDENTIAL_WATCHDOG_DISABLED = origDisabled;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const KRX_CRED = { id: 'KRX_API_KEY', label: 'KRX OpenAPI 인증키', expiresAt: '2027-04-19' };

async function imp() {
  return await import('./credentialExpiryWatchdog.js');
}

describe('ADR-0131 — evaluateCredential 4 임계 분기', () => {
  it('100일 남음 → threshold=null (90 임계 미도달)', async () => {
    const { evaluateCredential } = await imp();
    // 2027-04-19 - 100일 = 2027-01-09 (KST midnight)
    const now = new Date('2027-01-09T00:00:00Z');
    const e = evaluateCredential(KRX_CRED, now);
    expect(e.daysUntilExpiry).toBeGreaterThanOrEqual(99);
    expect(e.threshold).toBe(null);
  });

  it('89일 남음 → threshold=90', async () => {
    const { evaluateCredential } = await imp();
    const now = new Date('2027-01-20T00:00:00Z');
    const e = evaluateCredential(KRX_CRED, now);
    expect(e.threshold).toBe(90);
  });

  it('30일 정확 → threshold=30', async () => {
    const { evaluateCredential } = await imp();
    // 2027-04-19 - 30 = 2027-03-20 KST
    const now = new Date('2027-03-19T15:00:00Z'); // KST 03-20 00:00
    const e = evaluateCredential(KRX_CRED, now);
    expect(e.daysUntilExpiry).toBe(30);
    expect(e.threshold).toBe(30);
  });

  it('7일 정확 → threshold=7', async () => {
    const { evaluateCredential } = await imp();
    const now = new Date('2027-04-11T15:00:00Z'); // KST 04-12
    const e = evaluateCredential(KRX_CRED, now);
    expect(e.daysUntilExpiry).toBe(7);
    expect(e.threshold).toBe(7);
  });

  it('1일 정확 → threshold=1', async () => {
    const { evaluateCredential } = await imp();
    const now = new Date('2027-04-17T15:00:00Z'); // KST 04-18
    const e = evaluateCredential(KRX_CRED, now);
    expect(e.daysUntilExpiry).toBe(1);
    expect(e.threshold).toBe(1);
  });

  it('만료 당일 (D-0) → threshold=0', async () => {
    const { evaluateCredential } = await imp();
    const now = new Date('2027-04-18T15:00:00Z'); // KST 04-19
    const e = evaluateCredential(KRX_CRED, now);
    expect(e.daysUntilExpiry).toBe(0);
    expect(e.threshold).toBe(0);
  });

  it('만료 후 (-3일 경과) → threshold=0 + days 음수', async () => {
    const { evaluateCredential } = await imp();
    const now = new Date('2027-04-22T00:00:00Z');
    const e = evaluateCredential(KRX_CRED, now);
    expect(e.daysUntilExpiry).toBeLessThan(0);
    expect(e.threshold).toBe(0);
  });
});

describe('ADR-0131 — runCredentialWatchdog 알림 정책', () => {
  it('임계 미도달 (D-100) 시 알림 없음', async () => {
    const { runCredentialWatchdog } = await imp();
    await runCredentialWatchdog(new Date('2027-01-01T00:00:00Z'));
    expect(sendTelegramAlertMock).not.toHaveBeenCalled();
  });

  it('첫 임계 도달 (D-30) 시 알림 발송 + lastAlertedThreshold 영속', async () => {
    const { runCredentialWatchdog, loadCredentialExpiryState } = await imp();
    await runCredentialWatchdog(new Date('2027-03-19T15:00:00Z')); // KST D-30
    expect(sendTelegramAlertMock).toHaveBeenCalledTimes(1);
    const state = loadCredentialExpiryState();
    expect(state.lastAlertedThreshold?.KRX_API_KEY).toBe(30);
  });

  it('같은 임계 (D-30) 재호출 시 중복 차단', async () => {
    const { runCredentialWatchdog } = await imp();
    await runCredentialWatchdog(new Date('2027-03-19T15:00:00Z'));
    sendTelegramAlertMock.mockClear();
    await runCredentialWatchdog(new Date('2027-03-19T15:00:00Z'));
    expect(sendTelegramAlertMock).not.toHaveBeenCalled();
  });

  it('임계 변화 (D-30 → D-7) 시 새 임계 알림', async () => {
    const { runCredentialWatchdog } = await imp();
    await runCredentialWatchdog(new Date('2027-03-19T15:00:00Z')); // D-30
    sendTelegramAlertMock.mockClear();
    await runCredentialWatchdog(new Date('2027-04-11T15:00:00Z')); // D-7
    expect(sendTelegramAlertMock).toHaveBeenCalledTimes(1);
  });

  it('만료 (D-0) 후 매일 1회 알림 (date dedupeKey)', async () => {
    const { runCredentialWatchdog } = await imp();
    await runCredentialWatchdog(new Date('2027-04-18T15:00:00Z')); // KST D-0
    expect(sendTelegramAlertMock).toHaveBeenCalledTimes(1);
    sendTelegramAlertMock.mockClear();
    // 같은 날 재호출 — 차단
    await runCredentialWatchdog(new Date('2027-04-18T20:00:00Z'));
    expect(sendTelegramAlertMock).not.toHaveBeenCalled();
    // 다음 날 — 다시 발송
    await runCredentialWatchdog(new Date('2027-04-19T15:00:00Z'));
    expect(sendTelegramAlertMock).toHaveBeenCalledTimes(1);
  });

  it('CREDENTIAL_WATCHDOG_DISABLED=true 시 우회', async () => {
    process.env.CREDENTIAL_WATCHDOG_DISABLED = 'true';
    const { runCredentialWatchdog } = await imp();
    await runCredentialWatchdog(new Date('2027-04-18T15:00:00Z'));
    expect(sendTelegramAlertMock).not.toHaveBeenCalled();
  });

  it('telegram throw 시 graceful (lastAlertedThreshold 미갱신)', async () => {
    sendTelegramAlertMock.mockRejectedValueOnce(new Error('network'));
    const { runCredentialWatchdog, loadCredentialExpiryState } = await imp();
    await runCredentialWatchdog(new Date('2027-03-19T15:00:00Z')); // D-30
    const state = loadCredentialExpiryState();
    expect(state.lastAlertedThreshold?.KRX_API_KEY).toBeUndefined();
  });

  it('영속 round-trip — lastAlertedThreshold 보존', async () => {
    const { saveCredentialExpiryState, loadCredentialExpiryState } = await imp();
    saveCredentialExpiryState({
      lastAlertedThreshold: { KRX_API_KEY: 7 },
      expiredLastAlertedDate: { KRX_API_KEY: '2027-04-19' },
    });
    const loaded = loadCredentialExpiryState();
    expect(loaded.lastAlertedThreshold?.KRX_API_KEY).toBe(7);
    expect(loaded.expiredLastAlertedDate?.KRX_API_KEY).toBe('2027-04-19');
  });

  it('손상된 JSON → 빈 state fallback', async () => {
    const { CREDENTIAL_EXPIRY_STATE_FILE } = await import('../persistence/paths.js');
    fs.writeFileSync(CREDENTIAL_EXPIRY_STATE_FILE, 'not json');
    const { loadCredentialExpiryState } = await imp();
    expect(loadCredentialExpiryState()).toEqual({});
  });
});

describe('ADR-0131 — KNOWN_CREDENTIALS + 메시지 빌더', () => {
  it('KNOWN_CREDENTIALS 에 KRX_API_KEY 등록', async () => {
    const { KNOWN_CREDENTIALS } = await imp();
    expect(KNOWN_CREDENTIALS.length).toBeGreaterThanOrEqual(1);
    const krx = KNOWN_CREDENTIALS.find((c) => c.id === 'KRX_API_KEY');
    expect(krx).toBeDefined();
    expect(krx?.expiresAt).toBe('2027-04-19');
  });

  it('formatCredentialExpiryMessage D-7 → ⚠️ 마커', async () => {
    const { formatCredentialExpiryMessage } = await imp();
    const msg = formatCredentialExpiryMessage({
      id: 'KRX_API_KEY',
      label: 'KRX OpenAPI 인증키',
      expiresAt: '2027-04-19',
      daysUntilExpiry: 7,
      threshold: 7,
    });
    expect(msg).toContain('⚠️');
    expect(msg).toContain('D-7');
  });
});
