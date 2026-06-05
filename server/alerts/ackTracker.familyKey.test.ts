// @responsibility ackTracker familyKey 흡수 회귀 — 종목별 손절 접근 단계군 ack 종목당 1건 축소 (ADR-0573)
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ack-familykey-'));
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

describe('ackTracker.registerPendingAck — familyKey 흡수 (ADR-0573)', () => {
  it('같은 familyKey·다른 ackId/dedupeKey 2건 → 최신 건이 이전 건 흡수 (종목당 1건)', async () => {
    const ack = await importAckTracker();
    ack.registerPendingAck({
      ackId: 's2', messageId: 100, summary: '🟠 손절 임박', sentAt: Date.now(),
      category: 'stop_approach', dedupeKey: 'stop_approach_2:005930',
      familyKey: 'stop_approach:005930',
    });
    ack.registerPendingAck({
      ackId: 's3', messageId: 200, summary: '🔴 손절 집행 임박', sentAt: Date.now(),
      category: 'stop_approach', dedupeKey: 'stop_approach_3:005930',
      familyKey: 'stop_approach:005930',
    });
    // 단계별 dedupeKey 가 달라도 familyKey 흡수로 종목당 활성 1건만 유지.
    expect(ack.countPendingAcks()).toBe(1);
    const remaining = ack.listPendingAcks();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].ackId).toBe('s3');
    expect(remaining[0].familyKey).toBe('stop_approach:005930');
  });

  it('다른 familyKey 2건 → 둘 다 유지 (종목 간 흡수 없음)', async () => {
    const ack = await importAckTracker();
    ack.registerPendingAck({
      ackId: 'a1', messageId: 1, summary: '손절 임박 A', sentAt: Date.now(),
      dedupeKey: 'stop_approach_2:005930', familyKey: 'stop_approach:005930',
    });
    ack.registerPendingAck({
      ackId: 'b1', messageId: 2, summary: '손절 임박 B', sentAt: Date.now(),
      dedupeKey: 'stop_approach_2:000660', familyKey: 'stop_approach:000660',
    });
    expect(ack.countPendingAcks()).toBe(2);
  });

  it('familyKey 미지정 2건(다른 dedupeKey) → 기존 동작 유지(둘 다 보존) — byte-equivalent 회귀', async () => {
    const ack = await importAckTracker();
    ack.registerPendingAck({
      ackId: 'n1', messageId: 1, summary: 'health A', sentAt: Date.now(),
      dedupeKey: 'health_loop:foo:2026-06-05',
    });
    ack.registerPendingAck({
      ackId: 'n2', messageId: 2, summary: 'regime B', sentAt: Date.now(),
      dedupeKey: 'regime_downgrade:2026-06-05',
    });
    expect(ack.countPendingAcks()).toBe(2);
  });

  it('같은 dedupeKey 2건(familyKey 무관) → 기존 dedupeKey 흡수 유지 — 회귀 보장', async () => {
    const ack = await importAckTracker();
    ack.registerPendingAck({
      ackId: 'd1', messageId: 1, summary: 'dup A', sentAt: Date.now(),
      dedupeKey: 'health_loop:kis_token_expired:2026-06-05',
    });
    ack.registerPendingAck({
      ackId: 'd2', messageId: 2, summary: 'dup B', sentAt: Date.now(),
      dedupeKey: 'health_loop:kis_token_expired:2026-06-05',
    });
    expect(ack.countPendingAcks()).toBe(1);
    expect(ack.listPendingAcks()[0].ackId).toBe('d2');
  });

  it('familyKey 흡수 후 sweepPendingAcks 는 남은 1건만 재발송', async () => {
    const ack = await importAckTracker();
    const sentAt = Date.now();
    ack.registerPendingAck({
      ackId: 's2', messageId: 100, summary: '🟠 손절 임박', sentAt,
      dedupeKey: 'stop_approach_2:005930', familyKey: 'stop_approach:005930',
    });
    ack.registerPendingAck({
      ackId: 's3', messageId: 200, summary: '🔴 손절 집행 임박', sentAt,
      dedupeKey: 'stop_approach_3:005930', familyKey: 'stop_approach:005930',
    });
    expect(ack.countPendingAcks()).toBe(1);
    // 흡수 후 단 1건만 남았으므로 30분 경과 시 재발송도 1회만 — 폭증 차단.
    await ack.sweepPendingAcks(sentAt + 31 * 60 * 1000);
    expect(sendTelegramAlertMock).toHaveBeenCalledTimes(1);
  });
});
