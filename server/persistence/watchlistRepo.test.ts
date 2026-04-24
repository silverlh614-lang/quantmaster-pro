/**
 * watchlistRepo.test.ts — PR-3 #8 섹션별 하드 상한 강제 검증.
 *
 * saveWatchlist 가 호출될 때마다 SWING(8) / CATALYST(5) / MOMENTUM(50) 상한을
 * 즉시 강제해야 한다. 기존에는 cleanupWatchlist(스케줄) 에서만 강제되어
 * MOMENTUM 91 개 누적 사례가 있었다.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// telegramClient 는 실제 호출 대신 vi.fn 으로 고정.
vi.mock('../alerts/telegramClient.js', () => ({
  sendTelegramAlert: vi.fn(() => Promise.resolve()),
}));

describe('watchlistRepo — saveWatchlist 섹션 상한 강제', () => {
  let tmpDir: string;
  let repo: typeof import('./watchlistRepo.js');

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    repo = await import('./watchlistRepo.js');
    // frozen DATA_DIR 로 인해 모든 테스트가 같은 파일을 공유 — 매번 초기화.
    repo.saveWatchlist([]);
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

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

  it('MOMENTUM 91 개 저장 시도 → 50 개로 자동 트림 (gateScore 상위)', () => {
    const big = Array.from({ length: 91 }, (_, i) => makeEntry(i, 'MOMENTUM', i));
    repo.saveWatchlist(big);
    const loaded = repo.loadWatchlist();
    expect(loaded).toHaveLength(50);
    // gateScore 상위 50개 = i 값 41..90 유지 (내림차순으로 유지)
    const codes = loaded.map(e => parseInt(e.code, 10)).sort((a, b) => a - b);
    expect(codes[0]).toBe(41);
    expect(codes[49]).toBe(90);
  });

  it('SWING 상한 8, CATALYST 상한 5 각각 강제', () => {
    const mixed = [
      ...Array.from({ length: 12 }, (_, i) => makeEntry(i, 'SWING', i)),
      ...Array.from({ length: 9 },  (_, i) => makeEntry(100 + i, 'CATALYST', i)),
      ...Array.from({ length: 3 },  (_, i) => makeEntry(200 + i, 'MOMENTUM', i)),
    ];
    repo.saveWatchlist(mixed);
    const loaded = repo.loadWatchlist();
    const swing = loaded.filter(e => e.section === 'SWING');
    const catalyst = loaded.filter(e => e.section === 'CATALYST');
    const momentum = loaded.filter(e => e.section === 'MOMENTUM');
    expect(swing).toHaveLength(8);
    expect(catalyst).toHaveLength(5);
    expect(momentum).toHaveLength(3); // 원본이 상한 이하
  });

  it('상한 이하면 입력 그대로 유지 (순서 보존은 보장하지 않음)', () => {
    const list = [
      makeEntry(1, 'SWING', 5),
      makeEntry(2, 'CATALYST', 3),
      makeEntry(3, 'MOMENTUM', 1),
    ];
    repo.saveWatchlist(list);
    const loaded = repo.loadWatchlist();
    expect(loaded).toHaveLength(3);
    expect(new Set(loaded.map(e => e.code))).toEqual(new Set(['000001', '000002', '000003']));
  });

  it('section 없는 레거시 track="A" 는 MOMENTUM 으로 처리되어 상한 영향', () => {
    const legacy = Array.from({ length: 60 }, (_, i) => ({
      code: String(i).padStart(6, '0'),
      name: `레거시${i}`,
      entryPrice: 1000, stopLoss: 950, targetPrice: 1100,
      addedAt: new Date().toISOString(),
      addedBy: 'AUTO' as const,
      track: 'A' as const,  // 레거시 필드
      gateScore: i,
    }));
    repo.saveWatchlist(legacy);
    const loaded = repo.loadWatchlist();
    expect(loaded).toHaveLength(50);
  });

  it('leadershipBridge 표식은 같은 점수일 때 먼저 드롭', () => {
    // 51개 MOMENTUM: 50개 score=10 (normal), 1개 score=10.5 (leadershipBridge).
    // rankKey(e) = score - 0.5*bridge. leadership score=10, normal score=10.
    // normal 이 살아남고 leadership 이 드롭.
    const base = Array.from({ length: 50 }, (_, i) => ({ ...makeEntry(i, 'MOMENTUM', 10) }));
    const bridge = { ...makeEntry(999, 'MOMENTUM', 10), leadershipBridge: true };
    repo.saveWatchlist([...base, bridge]);
    const loaded = repo.loadWatchlist();
    expect(loaded).toHaveLength(50);
    expect(loaded.find(e => e.code === '000999')).toBeUndefined();
  });
});
