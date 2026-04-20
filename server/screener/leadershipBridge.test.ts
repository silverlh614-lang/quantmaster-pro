/**
 * leadershipBridge.test.ts — Phase 4-④ 주도주 → MOMENTUM 다이내믹 편입 회귀.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('leadershipBridge — qualifiesAsLeader', () => {
  beforeEach(() => { vi.resetModules(); });

  it('Gate ≥ 4.5, MTAS ≥ 6, 섹터 RS ≥ KOSPI → true', async () => {
    const { qualifiesAsLeader } = await import('./leadershipBridge.js');
    const ok = qualifiesAsLeader({
      code: '005930', name: 'A', gateScore: 5.0, mtas: 7,
      sectorRelativeStrength: 1.0, currentPrice: 50_000,
    }, { kospiDayReturn: 0.5 });
    expect(ok).toBe(true);
  });

  it('Gate 4.0 → false', async () => {
    const { qualifiesAsLeader } = await import('./leadershipBridge.js');
    expect(qualifiesAsLeader({
      code: '005930', name: 'A', gateScore: 4.0, mtas: 7,
      sectorRelativeStrength: 1.0, currentPrice: 50_000,
    }, { kospiDayReturn: 0.5 })).toBe(false);
  });

  it('섹터 RS < KOSPI → false', async () => {
    const { qualifiesAsLeader } = await import('./leadershipBridge.js');
    expect(qualifiesAsLeader({
      code: '005930', name: 'A', gateScore: 5.0, mtas: 7,
      sectorRelativeStrength: -1.0, currentPrice: 50_000,
    }, { kospiDayReturn: 0.5 })).toBe(false);
  });
});

describe('leadershipBridge — bridgeLeadersToMomentum', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('자격 있는 신규 후보 → MOMENTUM 섹션 + leadershipBridge=true + 4h TTL', async () => {
    const { bridgeLeadersToMomentum } = await import('./leadershipBridge.js');
    fs.writeFileSync(path.join(tmpDir, 'watchlist.json'), '[]');
    const before = Date.now();
    const res = bridgeLeadersToMomentum([
      { code: '005930', name: '삼성전자', gateScore: 5.5, mtas: 7, sectorRelativeStrength: 2.0, currentPrice: 60_000, sector: '반도체' },
    ], { kospiDayReturn: 0 });
    expect(res.added).toBe(1);

    const list = JSON.parse(fs.readFileSync(path.join(tmpDir, 'watchlist.json'), 'utf-8'));
    expect(list).toHaveLength(1);
    expect(list[0].section).toBe('MOMENTUM');
    expect(list[0].leadershipBridge).toBe(true);
    const expiry = new Date(list[0].expiresAt).getTime();
    expect(expiry - before).toBeGreaterThan(3.9 * 3600_000);
    expect(expiry - before).toBeLessThan(4.1 * 3600_000);
  });

  it('이미 SWING 에 있는 종목은 건드리지 않음 (우선순위 존중)', async () => {
    const { bridgeLeadersToMomentum } = await import('./leadershipBridge.js');
    fs.writeFileSync(path.join(tmpDir, 'watchlist.json'), JSON.stringify([
      { code: '005930', name: '삼성전자', section: 'SWING', entryPrice: 60_000, stopLoss: 57_000, targetPrice: 66_000, addedAt: '2026', addedBy: 'MANUAL' },
    ]));
    const res = bridgeLeadersToMomentum([
      { code: '005930', name: '삼성전자', gateScore: 5.5, mtas: 7, sectorRelativeStrength: 2.0, currentPrice: 60_000 },
    ], {});
    expect(res.added).toBe(0);
    expect(res.skippedByReason.already_higher_tier).toBe(1);
  });

  it('이미 leadershipBridge=true 인 MOMENTUM → TTL 갱신', async () => {
    const { bridgeLeadersToMomentum } = await import('./leadershipBridge.js');
    const oldExpiry = new Date(Date.now() - 60_000).toISOString();
    fs.writeFileSync(path.join(tmpDir, 'watchlist.json'), JSON.stringify([
      { code: '005930', name: '삼성전자', section: 'MOMENTUM', leadershipBridge: true, entryPrice: 60_000, stopLoss: 57_000, targetPrice: 66_000, addedAt: '2026', addedBy: 'AUTO', gateScore: 4.5, expiresAt: oldExpiry },
    ]));
    const res = bridgeLeadersToMomentum([
      { code: '005930', name: '삼성전자', gateScore: 6.2, mtas: 8, sectorRelativeStrength: 2.0, currentPrice: 60_000 },
    ], {});
    expect(res.refreshed).toBe(1);
    const list = JSON.parse(fs.readFileSync(path.join(tmpDir, 'watchlist.json'), 'utf-8'));
    expect(list[0].gateScore).toBe(6.2);
    expect(new Date(list[0].expiresAt).getTime()).toBeGreaterThan(Date.now() + 3 * 3600_000);
  });

  it('expireBridgeEntries — 만료된 bridge 엔트리만 제거', async () => {
    const { expireBridgeEntries } = await import('./leadershipBridge.js');
    const expired = new Date(Date.now() - 60_000).toISOString();
    const fresh = new Date(Date.now() + 3 * 3600_000).toISOString();
    fs.writeFileSync(path.join(tmpDir, 'watchlist.json'), JSON.stringify([
      { code: '005930', name: 'A', section: 'MOMENTUM', leadershipBridge: true, entryPrice: 100, stopLoss: 95, targetPrice: 110, addedAt: '2026', addedBy: 'AUTO', expiresAt: expired },
      { code: '000660', name: 'B', section: 'MOMENTUM', leadershipBridge: true, entryPrice: 100, stopLoss: 95, targetPrice: 110, addedAt: '2026', addedBy: 'AUTO', expiresAt: fresh },
      { code: '035720', name: 'C', section: 'MOMENTUM', entryPrice: 100, stopLoss: 95, targetPrice: 110, addedAt: '2026', addedBy: 'AUTO' }, // base, 유지
    ]));
    const res = expireBridgeEntries();
    expect(res.removed).toBe(1);
    const list = JSON.parse(fs.readFileSync(path.join(tmpDir, 'watchlist.json'), 'utf-8'));
    expect(list.map((e: { code: string }) => e.code)).toEqual(['000660', '035720']);
  });
});
