/**
 * @responsibility Watchlist 포화 알림 발송 게이트 회귀 (ADR-0094 옵션 B)
 *
 * 사용자 보고 (4/29): MOMENTUM 40개 (alert 30 / soft 40 / hard 50) — alert 임계
 * 초과지만 *능동 정리 미발동* 분기에서 30분마다 도배 알림 발송. 운영자 액션 불필요한
 * 정보성 메시지가 noise 만 발생.
 *
 * 본 PR — 진짜 행동 필요한 두 경우만 발송:
 *   (a) count > softCap → soft cap 능동 정리 진행 중
 *   (b) count >= hardCap → hard cap 강제 정리 발동
 *
 * "alert < count <= softCap" 분기 (능동 정리 미발동) → 알림 *미발송*.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

vi.mock('../alerts/telegramClient.js', () => ({
  sendTelegramAlert: vi.fn(() => Promise.resolve()),
}));

const { sendTelegramAlert } = await import('../alerts/telegramClient.js');

describe('watchlistRepo — Watchlist 포화 알림 발송 게이트 (ADR-0094)', () => {
  let tmpDir: string;
  let repo: typeof import('./watchlistRepo.js');

  beforeEach(async () => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-overflow-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    repo = await import('./watchlistRepo.js');
    repo.saveWatchlist([]);
    vi.clearAllMocks(); // beforeEach 의 reset 후 saveWatchlist([]) 가 호출했을 알림 무시
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function makeEntry(i: number, section: 'SWING' | 'CATALYST' | 'MOMENTUM', gateScore: number): any {
    return {
      code: String(i).padStart(6, '0'),
      name: `종목${i}`,
      entryPrice: 10_000,
      stopLoss:   9_500,
      targetPrice: 11_000,
      addedAt: new Date().toISOString(),
      addedBy: 'AUTO',
      section,
      gateScore,
    };
  }

  function getOverflowAlertCalls() {
    // sendTelegramAlert mock 의 호출 중 [Watchlist 포화] 메시지 카운트.
    const calls = (sendTelegramAlert as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    return calls.filter((c) => String(c[0]).includes('[Watchlist 포화]'));
  }

  it('사용자 보고 시나리오 — MOMENTUM 40개 (alert 30 / soft 40 / hard 50) → 알림 미발송', () => {
    // alert(30) < count(40) <= softCap(40) → 능동 정리 미발동 분기 → 알림 미발송
    const list = Array.from({ length: 40 }, (_, i) => makeEntry(i, 'MOMENTUM', 7.0));
    repo.saveWatchlist(list);
    expect(getOverflowAlertCalls()).toHaveLength(0);
  });

  it('count = softCap 정확 (40개) → 알림 미발송 (boundary)', () => {
    const list = Array.from({ length: 40 }, (_, i) => makeEntry(i, 'MOMENTUM', 7.0));
    repo.saveWatchlist(list);
    expect(getOverflowAlertCalls()).toHaveLength(0);
  });

  it('입력 41개 → enforceSectionCaps soft 정리 → trimmed 40 → 알림 미발송', () => {
    // 입력 41개 > softCap(40) AND ≤ hardCap(50) → soft cap 까지 trim → trimmed=40
    // → momentumCount=40 → 알림 미발송 (Auto-Trim 알림은 별도 발송됨)
    const list = Array.from({ length: 41 }, (_, i) => makeEntry(i, 'MOMENTUM', 7.0));
    repo.saveWatchlist(list);
    expect(getOverflowAlertCalls()).toHaveLength(0);
  });

  it('입력 50개 → enforceSectionCaps soft 정리 → trimmed 40 → 알림 미발송', () => {
    // 입력 50개 > softCap(40) AND = hardCap(50) → soft cap 까지 trim → trimmed=40
    const list = Array.from({ length: 50 }, (_, i) => makeEntry(i, 'MOMENTUM', 7.0 + i * 0.01));
    repo.saveWatchlist(list);
    expect(getOverflowAlertCalls()).toHaveLength(0);
  });

  it('입력 51개 (hardCap 초과) → trimmed 50 (hard 강제) → 알림 발송 (행동 필요 시점)', () => {
    // 입력 51개 > hardCap(50) → hard cap 강제 정리 → trimmed=50
    // → momentumCount=50 > softCap(40) → 진짜 행동 필요한 시점, 알림 발송
    const list = Array.from({ length: 51 }, (_, i) => makeEntry(i, 'MOMENTUM', 7.0 + i * 0.01));
    repo.saveWatchlist(list);
    const calls = getOverflowAlertCalls();
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });

  it('입력 60개 (hardCap 크게 초과) → trimmed 50 → 알림 발송', () => {
    const list = Array.from({ length: 60 }, (_, i) => makeEntry(i, 'MOMENTUM', 7.0 + i * 0.01));
    repo.saveWatchlist(list);
    expect(getOverflowAlertCalls().length).toBeGreaterThanOrEqual(1);
  });

  it('alert 미달 (29개) → 알림 미발송', () => {
    const list = Array.from({ length: 29 }, (_, i) => makeEntry(i, 'MOMENTUM', 7.0));
    repo.saveWatchlist(list);
    expect(getOverflowAlertCalls()).toHaveLength(0);
  });

  it('alert 정확 (30개) → 알림 미발송 (count > softCap 조건 미달)', () => {
    const list = Array.from({ length: 30 }, (_, i) => makeEntry(i, 'MOMENTUM', 7.0));
    repo.saveWatchlist(list);
    expect(getOverflowAlertCalls()).toHaveLength(0);
  });

  it('alert + 1 (31개) → 알림 미발송 (alert < count <= softCap 침묵 분기)', () => {
    // 31 > alert(30) BUT 31 <= softCap(40) → 능동 정리 미발동 → 알림 미발송
    const list = Array.from({ length: 31 }, (_, i) => makeEntry(i, 'MOMENTUM', 7.0));
    repo.saveWatchlist(list);
    expect(getOverflowAlertCalls()).toHaveLength(0);
  });
});
