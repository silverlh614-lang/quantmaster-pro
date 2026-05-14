// @responsibility Patch-WATCHLIST-DETACHMENT-SYNC-001 syncDetachedFromWatchlist SSOT + 정적 가드 회귀
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

const ORIGINAL_ENV = { ...process.env };
let TEST_DIR = '';

beforeEach(() => {
  TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-detach-'));
  process.env.PERSIST_DATA_DIR = TEST_DIR;
  delete process.env.WATCHLIST_DETACHMENT_SYNC_DISABLED;
  vi.resetModules();
});

afterEach(() => {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV };
  if (TEST_DIR && fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
});

interface MinimalTrade {
  id: string;
  stockCode: string;
  stockName: string;
  status: string;
  detachedFromWatchlist?: boolean;
  detachedFromWatchlistAt?: string;
}

function writeShadowTrades(trades: MinimalTrade[]): void {
  fs.writeFileSync(
    path.join(TEST_DIR, 'shadow-trades.json'),
    JSON.stringify(trades, null, 2),
    'utf-8',
  );
}

function writeWatchlist(codes: string[]): void {
  fs.writeFileSync(
    path.join(TEST_DIR, 'watchlist.json'),
    JSON.stringify(
      codes.map((code) => ({ code, name: `종목${code}` })),
      null,
      2,
    ),
    'utf-8',
  );
}

function readShadowTrades(): MinimalTrade[] {
  return JSON.parse(fs.readFileSync(path.join(TEST_DIR, 'shadow-trades.json'), 'utf-8'));
}

const NOW = new Date('2026-05-14T06:30:00.000Z');

describe('Patch-WATCHLIST-DETACHMENT-SYNC-001 syncDetachedFromWatchlist', () => {
  // ── A. ENV 우회 ──────────────────────────────────────────────────────────────
  it('A. ENV WATCHLIST_DETACHMENT_SYNC_DISABLED=true → 전체 no-op', async () => {
    process.env.WATCHLIST_DETACHMENT_SYNC_DISABLED = 'true';
    writeWatchlist([]);
    writeShadowTrades([{ id: 't1', stockCode: '005930', stockName: '삼성전자', status: 'ACTIVE' }]);
    vi.resetModules();
    const m = await import('./watchlistDetachmentSync.js');
    const summary = m.syncDetachedFromWatchlist(NOW);
    expect(summary.disabled).toBe(true);
    expect(summary.persisted).toBe(false);
    // 마커 부착 안 됨
    expect(readShadowTrades()[0].detachedFromWatchlist).toBeUndefined();
  });

  it('A. ENV 미설정 → 정상 작동 (disabled=false)', async () => {
    writeWatchlist(['005930']);
    writeShadowTrades([{ id: 't1', stockCode: '005930', stockName: '삼성전자', status: 'ACTIVE' }]);
    const m = await import('./watchlistDetachmentSync.js');
    expect(m.syncDetachedFromWatchlist(NOW).disabled).toBe(false);
  });

  it('A. isWatchlistDetachmentSyncDisabled 정확 비교 (ADR-0157)', async () => {
    const m = await import('./watchlistDetachmentSync.js');
    for (const v of ['1', 'TRUE', 'yes', 'True', '']) {
      process.env.WATCHLIST_DETACHMENT_SYNC_DISABLED = v;
      expect(m.isWatchlistDetachmentSyncDisabled()).toBe(false);
    }
    process.env.WATCHLIST_DETACHMENT_SYNC_DISABLED = 'true';
    expect(m.isWatchlistDetachmentSyncDisabled()).toBe(true);
  });

  // ── B. detach 마커 부착 ──────────────────────────────────────────────────────
  it('B. OPEN 포지션이 워치리스트에 없으면 detachedFromWatchlist=true + At 부착', async () => {
    writeWatchlist(['000660']); // 005930 제거됨
    writeShadowTrades([{ id: 't1', stockCode: '005930', stockName: '삼성전자', status: 'ACTIVE' }]);
    const m = await import('./watchlistDetachmentSync.js');
    const summary = m.syncDetachedFromWatchlist(NOW);
    expect(summary.newlyDetached).toBe(1);
    expect(summary.persisted).toBe(true);
    const saved = readShadowTrades()[0];
    expect(saved.detachedFromWatchlist).toBe(true);
    expect(saved.detachedFromWatchlistAt).toBe(NOW.toISOString());
  });

  it('B. 5개 OPEN 상태(PENDING/ORDER_SUBMITTED/PARTIALLY_FILLED/ACTIVE/EUPHORIA_PARTIAL) 모두 detach', async () => {
    writeWatchlist([]);
    writeShadowTrades([
      { id: 't1', stockCode: '000001', stockName: 'A', status: 'PENDING' },
      { id: 't2', stockCode: '000002', stockName: 'B', status: 'ORDER_SUBMITTED' },
      { id: 't3', stockCode: '000003', stockName: 'C', status: 'PARTIALLY_FILLED' },
      { id: 't4', stockCode: '000004', stockName: 'D', status: 'ACTIVE' },
      { id: 't5', stockCode: '000005', stockName: 'E', status: 'EUPHORIA_PARTIAL' },
    ]);
    const m = await import('./watchlistDetachmentSync.js');
    const summary = m.syncDetachedFromWatchlist(NOW);
    expect(summary.scannedOpenPositions).toBe(5);
    expect(summary.newlyDetached).toBe(5);
    expect(readShadowTrades().every((t) => t.detachedFromWatchlist === true)).toBe(true);
  });

  // ── C. CLOSED 포지션 미터치 ──────────────────────────────────────────────────
  it('C. CLOSED 상태(HIT_TARGET/HIT_STOP/REJECTED)는 마커 부착 안 됨 + scanned 제외', async () => {
    writeWatchlist([]);
    writeShadowTrades([
      { id: 't1', stockCode: '000001', stockName: 'A', status: 'HIT_TARGET' },
      { id: 't2', stockCode: '000002', stockName: 'B', status: 'HIT_STOP' },
      { id: 't3', stockCode: '000003', stockName: 'C', status: 'REJECTED' },
    ]);
    const m = await import('./watchlistDetachmentSync.js');
    const summary = m.syncDetachedFromWatchlist(NOW);
    expect(summary.scannedOpenPositions).toBe(0);
    expect(summary.newlyDetached).toBe(0);
    expect(summary.persisted).toBe(false);
    expect(readShadowTrades().every((t) => t.detachedFromWatchlist === undefined)).toBe(true);
  });

  // ── D. 재진입 해제 ───────────────────────────────────────────────────────────
  it('D. 워치리스트 재진입 시 detach 마커 해제 (false + At undefined)', async () => {
    writeWatchlist(['005930']); // 재진입
    writeShadowTrades([
      {
        id: 't1',
        stockCode: '005930',
        stockName: '삼성전자',
        status: 'ACTIVE',
        detachedFromWatchlist: true,
        detachedFromWatchlistAt: '2026-05-13T00:00:00.000Z',
      },
    ]);
    const m = await import('./watchlistDetachmentSync.js');
    const summary = m.syncDetachedFromWatchlist(NOW);
    expect(summary.reattached).toBe(1);
    expect(summary.persisted).toBe(true);
    const saved = readShadowTrades()[0];
    expect(saved.detachedFromWatchlist).toBe(false);
    expect(saved.detachedFromWatchlistAt).toBeUndefined();
  });

  // ── E. idempotent ───────────────────────────────────────────────────────────
  it('E. 이미 detached 상태 → alreadyDetached, 변경/저장 0건', async () => {
    writeWatchlist([]);
    writeShadowTrades([
      {
        id: 't1',
        stockCode: '005930',
        stockName: '삼성전자',
        status: 'ACTIVE',
        detachedFromWatchlist: true,
        detachedFromWatchlistAt: '2026-05-13T00:00:00.000Z',
      },
    ]);
    const m = await import('./watchlistDetachmentSync.js');
    const summary = m.syncDetachedFromWatchlist(NOW);
    expect(summary.alreadyDetached).toBe(1);
    expect(summary.newlyDetached).toBe(0);
    expect(summary.persisted).toBe(false);
    // At 타임스탬프 보존 (재부착 안 함)
    expect(readShadowTrades()[0].detachedFromWatchlistAt).toBe('2026-05-13T00:00:00.000Z');
  });

  it('E. 두 번 연속 호출 — 두 번째는 변경 0건 (멱등)', async () => {
    writeWatchlist([]);
    writeShadowTrades([{ id: 't1', stockCode: '005930', stockName: '삼성전자', status: 'ACTIVE' }]);
    const m = await import('./watchlistDetachmentSync.js');
    const first = m.syncDetachedFromWatchlist(NOW);
    expect(first.newlyDetached).toBe(1);
    const second = m.syncDetachedFromWatchlist(NOW);
    expect(second.newlyDetached).toBe(0);
    expect(second.alreadyDetached).toBe(1);
    expect(second.persisted).toBe(false);
  });

  // ── F. 워치리스트 잔존 ───────────────────────────────────────────────────────
  it('F. OPEN 포지션이 워치리스트에 있으면 마커 부착 안 됨', async () => {
    writeWatchlist(['005930']);
    writeShadowTrades([{ id: 't1', stockCode: '005930', stockName: '삼성전자', status: 'ACTIVE' }]);
    const m = await import('./watchlistDetachmentSync.js');
    const summary = m.syncDetachedFromWatchlist(NOW);
    expect(summary.newlyDetached).toBe(0);
    expect(summary.persisted).toBe(false);
    expect(readShadowTrades()[0].detachedFromWatchlist).toBeUndefined();
  });

  // ── G. 핵심 불변식 — OPEN 포지션 절대 닫지/삭제 않음 ─────────────────────────
  it('G. 핵심 불변식 — detach 후에도 trade 수 동일 + status 무변경 (포지션 유지)', async () => {
    writeWatchlist([]);
    writeShadowTrades([
      { id: 't1', stockCode: '000001', stockName: 'A', status: 'ACTIVE' },
      { id: 't2', stockCode: '000002', stockName: 'B', status: 'PARTIALLY_FILLED' },
      { id: 't3', stockCode: '000003', stockName: 'C', status: 'HIT_STOP' },
    ]);
    const m = await import('./watchlistDetachmentSync.js');
    m.syncDetachedFromWatchlist(NOW);
    const saved = readShadowTrades();
    expect(saved).toHaveLength(3); // 삭제 0건
    expect(saved.find((t) => t.id === 't1')!.status).toBe('ACTIVE'); // status 무변경
    expect(saved.find((t) => t.id === 't2')!.status).toBe('PARTIALLY_FILLED');
    expect(saved.find((t) => t.id === 't3')!.status).toBe('HIT_STOP'); // CLOSED 도 보존
  });

  it('G. 혼합 시나리오 — detach + reattach + alreadyDetached + closed 동시', async () => {
    writeWatchlist(['000002']); // 000002 만 워치리스트 잔존
    writeShadowTrades([
      { id: 't1', stockCode: '000001', stockName: 'A', status: 'ACTIVE' }, // 신규 detach
      {
        id: 't2',
        stockCode: '000002',
        stockName: 'B',
        status: 'ACTIVE',
        detachedFromWatchlist: true,
        detachedFromWatchlistAt: '2026-05-13T00:00:00.000Z',
      }, // 재진입 해제
      {
        id: 't3',
        stockCode: '000003',
        stockName: 'C',
        status: 'ACTIVE',
        detachedFromWatchlist: true,
        detachedFromWatchlistAt: '2026-05-12T00:00:00.000Z',
      }, // 이미 detached 유지
      { id: 't4', stockCode: '000004', stockName: 'D', status: 'HIT_TARGET' }, // closed 무시
    ]);
    const m = await import('./watchlistDetachmentSync.js');
    const summary = m.syncDetachedFromWatchlist(NOW);
    expect(summary.scannedOpenPositions).toBe(3);
    expect(summary.newlyDetached).toBe(1);
    expect(summary.reattached).toBe(1);
    expect(summary.alreadyDetached).toBe(1);
    expect(summary.persisted).toBe(true);
  });

  // ── H. 빈 입력 ───────────────────────────────────────────────────────────────
  it('H. shadow-trades 빈 파일 → graceful (scanned 0, persisted false)', async () => {
    writeWatchlist(['005930']);
    writeShadowTrades([]);
    const m = await import('./watchlistDetachmentSync.js');
    const summary = m.syncDetachedFromWatchlist(NOW);
    expect(summary.scannedOpenPositions).toBe(0);
    expect(summary.persisted).toBe(false);
  });
});

// ── I. 정적 grep 가드 ─────────────────────────────────────────────────────────
const HERE = path.dirname(fileURLToPath(import.meta.url));

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('Patch-WATCHLIST-DETACHMENT-SYNC-001 정적 가드', () => {
  it('I. watchlistDetachmentSync.ts — OPEN 포지션 close/delete 0건 (마커 전용)', () => {
    const src = stripComments(fs.readFileSync(path.join(HERE, 'watchlistDetachmentSync.ts'), 'utf-8'));
    // 포지션을 닫거나 삭제하는 패턴 부재
    expect(src).not.toMatch(/\.status\s*=\s*['"]HIT_/);
    expect(src).not.toMatch(/\.status\s*=\s*['"]REJECTED/);
    expect(src).not.toMatch(/\.splice\(/);
    expect(src).not.toMatch(/\.filter\(/); // trades 배열에서 제거하는 filter 없음
    // KIS 주문 함수 import 0건
    expect(src).not.toMatch(/placeKis|cancelKisOrder|autoTradeEngine|orderExecutor|trancheExecutor/);
    // saveShadowTrades 는 사용 (마커 영속용)
    expect(src).toMatch(/saveShadowTrades/);
    // saveWatchlist 호출 0건 (watchlist 는 read-only)
    expect(src).not.toMatch(/saveWatchlist/);
  });

  it('I. watchlistManager.ts — cleanupWatchlist 가 syncDetachedFromWatchlist 호출', () => {
    const src = stripComments(fs.readFileSync(path.join(HERE, 'watchlistManager.ts'), 'utf-8'));
    expect(src).toMatch(/import\s*\{\s*syncDetachedFromWatchlist\s*\}\s*from\s*['"]\.\/watchlistDetachmentSync\.js['"]/);
    expect(src).toMatch(/syncDetachedFromWatchlist\(\)/);
  });

  it('I. ENV 헬퍼는 정확 비교 (=== \'true\') 사용', () => {
    const src = fs.readFileSync(path.join(HERE, 'watchlistDetachmentSync.ts'), 'utf-8');
    expect(src).toMatch(/WATCHLIST_DETACHMENT_SYNC_DISABLED\s*===\s*['"]true['"]/);
  });
});
