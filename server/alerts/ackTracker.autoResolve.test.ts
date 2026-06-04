// @responsibility ackTracker autoResolve 회귀 — 조건 self-heal 자동 해소 (KIS 토큰 회복)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let tmpDir: string;
const origDataDir = process.env.PERSIST_DATA_DIR;

const editMessageTextMock = vi.fn(async (_id: number, _text: string) => undefined);
const sendTelegramAlertMock = vi.fn(async () => 1);
const answerCallbackQueryMock = vi.fn(async () => undefined);

vi.mock('./telegramClient.js', () => ({
  editMessageText: editMessageTextMock,
  sendTelegramAlert: sendTelegramAlertMock,
  answerCallbackQuery: answerCallbackQueryMock,
}));

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ack-autoresolve-'));
  process.env.PERSIST_DATA_DIR = tmpDir;
  editMessageTextMock.mockClear();
  sendTelegramAlertMock.mockClear();
  vi.resetModules();
});

afterEach(() => {
  if (origDataDir === undefined) delete process.env.PERSIST_DATA_DIR;
  else process.env.PERSIST_DATA_DIR = origDataDir;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function importAckTracker() {
  return await import('./ackTracker.js');
}

describe('ackTracker.autoResolvePendingAcks — 조건 self-heal', () => {
  it('match 엔트리만 해소 + 원본 메시지 편집 + 건수 반환', async () => {
    const ack = await importAckTracker();
    ack.registerPendingAck({
      ackId: 'a1', messageId: 100, summary: '🚨 KIS 토큰 만료', sentAt: Date.now(),
      category: 'health_loop', dedupeKey: 'health_loop:kis_token_expired:2026-06-04',
    });
    ack.registerPendingAck({
      ackId: 'a2', messageId: 200, summary: 'regime downgrade', sentAt: Date.now(),
      category: 'regime', dedupeKey: 'regime_downgrade:2026-06-04',
    });
    expect(ack.countPendingAcks()).toBe(2);

    const resolved = await ack.autoResolvePendingAcks(
      (e) => (e.dedupeKey ?? '').includes('kis_token_expired'),
      'KIS 토큰 재발급 — 조건 회복',
    );

    expect(resolved).toBe(1);
    // 다른 카테고리(regime)는 보존 — KIS 회복만 해소.
    expect(ack.countPendingAcks()).toBe(1);
    expect(ack.listPendingAcks()[0].ackId).toBe('a2');
    // 원본 메시지 편집 1회 (자동 해소 본문).
    expect(editMessageTextMock).toHaveBeenCalledTimes(1);
    expect(editMessageTextMock.mock.calls[0][0]).toBe(100);
    expect(String(editMessageTextMock.mock.calls[0][1])).toMatch(/자동 해소 — KIS 토큰 재발급/);
  });

  it('maintenance dedupeKey 도 동일 부분문자열로 커버', async () => {
    const ack = await importAckTracker();
    ack.registerPendingAck({
      ackId: 'm1', messageId: 1, summary: '🛠 KIS 토큰 만료 — 휴장일 점검', sentAt: Date.now(),
      category: 'health_loop', dedupeKey: 'health_loop:kis_token_expired_maintenance:2026-06-04',
    });
    const resolved = await ack.autoResolvePendingAcks(
      (e) => (e.dedupeKey ?? '').includes('kis_token_expired'),
      'KIS 토큰 재발급 — 조건 회복',
    );
    expect(resolved).toBe(1);
    expect(ack.countPendingAcks()).toBe(0);
  });

  it('해소 대상 없으면 no-op (idempotent) — 편집·저장 부작용 없음', async () => {
    const ack = await importAckTracker();
    ack.registerPendingAck({
      ackId: 'x1', messageId: 9, summary: 'unrelated', sentAt: Date.now(),
      category: 'other', dedupeKey: 'other:1',
    });
    const resolved = await ack.autoResolvePendingAcks(
      (e) => (e.dedupeKey ?? '').includes('kis_token_expired'),
      'KIS 토큰 재발급 — 조건 회복',
    );
    expect(resolved).toBe(0);
    expect(ack.countPendingAcks()).toBe(1);
    expect(editMessageTextMock).not.toHaveBeenCalled();
  });

  it('편집 실패해도 pending 은 제거된 채 유지 (폐루프 닫힘)', async () => {
    editMessageTextMock.mockRejectedValueOnce(new Error('edit failed'));
    const ack = await importAckTracker();
    ack.registerPendingAck({
      ackId: 'e1', messageId: 5, summary: '🚨 KIS 토큰 만료', sentAt: Date.now(),
      category: 'health_loop', dedupeKey: 'health_loop:kis_token_expired:2026-06-04',
    });
    const resolved = await ack.autoResolvePendingAcks(
      (e) => (e.dedupeKey ?? '').includes('kis_token_expired'),
      'KIS 토큰 재발급 — 조건 회복',
    );
    expect(resolved).toBe(1);
    expect(ack.countPendingAcks()).toBe(0);
  });

  it('dedupeKey 부재 fallback — category+summary 매칭', async () => {
    const ack = await importAckTracker();
    ack.registerPendingAck({
      ackId: 'f1', messageId: 7, summary: '🚨 KIS 토큰 만료', sentAt: Date.now(),
      category: 'health_loop',
    });
    const resolved = await ack.autoResolvePendingAcks(
      (e) => {
        const key = e.dedupeKey ?? '';
        if (key.includes('kis_token_expired')) return true;
        return e.category === 'health_loop' && /KIS\s*토큰\s*만료/.test(e.summary ?? '');
      },
      'KIS 토큰 재발급 — 조건 회복',
    );
    expect(resolved).toBe(1);
    expect(ack.countPendingAcks()).toBe(0);
  });
});
