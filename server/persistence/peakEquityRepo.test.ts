/**
 * peakEquityRepo.test.ts (ADR-0164)
 *
 * peakEquity 영속 SSOT 회귀 — 영속 round-trip + 자동 갱신 정책 + SHADOW/LIVE 분리 + 안전 fallback.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// PERSIST_DATA_DIR 격리 (다른 테스트와 영속 충돌 방지)
const TEST_DIR = mkdtempSync(join(tmpdir(), 'peakEquityRepo-'));
process.env.PERSIST_DATA_DIR = TEST_DIR;

// dynamic import 로 ENV 적용 후 모듈 로드
let repo: typeof import('./peakEquityRepo.js');
let paths: typeof import('./paths.js');

beforeEach(async () => {
  // 모든 모듈 캐시 청소 (ENV 재적용)
  await import('./peakEquityRepo.js').then((m) => { repo = m; });
  await import('./paths.js').then((m) => { paths = m; });
  // 영속 파일 청소
  if (existsSync(paths.PEAK_EQUITY_FILE)) {
    try { unlinkSync(paths.PEAK_EQUITY_FILE); } catch { /* ignore */ }
  }
});

afterEach(() => {
  if (existsSync(paths.PEAK_EQUITY_FILE)) {
    try { unlinkSync(paths.PEAK_EQUITY_FILE); } catch { /* ignore */ }
  }
});

// 전체 테스트 종료 후 임시 디렉토리 청소
process.on('exit', () => {
  try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ─── loadPeakEquitySnapshot — 영속 read 분기 ───────────────────────────────

describe('loadPeakEquitySnapshot — 영속 read', () => {
  it('파일 부재 → 빈 snapshot fallback', () => {
    const snap = repo.loadPeakEquitySnapshot();
    expect(snap.shadowPeakEquity).toBe(0);
    expect(snap.shadowPeakAt).toBeNull();
    expect(snap.livePeakEquity).toBe(0);
    expect(snap.livePeakAt).toBeNull();
    expect(snap.schemaVersion).toBe(repo.PEAK_EQUITY_SCHEMA_VERSION);
  });

  it('손상 JSON → 빈 snapshot fallback', () => {
    writeFileSync(paths.PEAK_EQUITY_FILE, '{ invalid json', 'utf-8');
    const snap = repo.loadPeakEquitySnapshot();
    expect(snap.shadowPeakEquity).toBe(0);
    expect(snap.livePeakEquity).toBe(0);
  });

  it('null 직접 저장 → 빈 snapshot fallback', () => {
    writeFileSync(paths.PEAK_EQUITY_FILE, 'null', 'utf-8');
    const snap = repo.loadPeakEquitySnapshot();
    expect(snap.shadowPeakEquity).toBe(0);
  });

  it('array 직접 저장 → 빈 snapshot fallback', () => {
    writeFileSync(paths.PEAK_EQUITY_FILE, '[]', 'utf-8');
    const snap = repo.loadPeakEquitySnapshot();
    expect(snap.shadowPeakEquity).toBe(0);
  });

  it('NaN/음수 shadowPeakEquity → 0 fallback', () => {
    writeFileSync(paths.PEAK_EQUITY_FILE, JSON.stringify({
      shadowPeakEquity: -100, shadowPeakAt: '2026-05-02T00:00:00Z',
      livePeakEquity: NaN, livePeakAt: null, schemaVersion: 1,
    }), 'utf-8');
    const snap = repo.loadPeakEquitySnapshot();
    expect(snap.shadowPeakEquity).toBe(0);
    expect(snap.livePeakEquity).toBe(0);
  });

  it('정상 snapshot round-trip', () => {
    const original = {
      shadowPeakEquity: 15_000_000,
      shadowPeakAt: '2026-05-02T00:00:00.000Z',
      livePeakEquity: 0,
      livePeakAt: null,
      schemaVersion: 1,
    };
    writeFileSync(paths.PEAK_EQUITY_FILE, JSON.stringify(original), 'utf-8');
    const snap = repo.loadPeakEquitySnapshot();
    expect(snap.shadowPeakEquity).toBe(15_000_000);
    expect(snap.shadowPeakAt).toBe('2026-05-02T00:00:00.000Z');
  });
});

// ─── savePeakEquitySnapshot — atomic write ──────────────────────────────────

describe('savePeakEquitySnapshot — atomic write', () => {
  it('round-trip — write 후 load 동일 값', () => {
    repo.savePeakEquitySnapshot({
      shadowPeakEquity: 20_000_000,
      shadowPeakAt: '2026-05-02T01:00:00.000Z',
      livePeakEquity: 50_000_000,
      livePeakAt: '2026-05-02T02:00:00.000Z',
      schemaVersion: 1,
    });
    const snap = repo.loadPeakEquitySnapshot();
    expect(snap.shadowPeakEquity).toBe(20_000_000);
    expect(snap.shadowPeakAt).toBe('2026-05-02T01:00:00.000Z');
    expect(snap.livePeakEquity).toBe(50_000_000);
    expect(snap.livePeakAt).toBe('2026-05-02T02:00:00.000Z');
  });

  it('NaN/음수 입력 → 0 정규화', () => {
    repo.savePeakEquitySnapshot({
      shadowPeakEquity: NaN,
      shadowPeakAt: null,
      livePeakEquity: -1000,
      livePeakAt: null,
      schemaVersion: 1,
    });
    const snap = repo.loadPeakEquitySnapshot();
    expect(snap.shadowPeakEquity).toBe(0);
    expect(snap.livePeakEquity).toBe(0);
  });

  it('atomic write — tmp 파일 잔존 안 함', () => {
    repo.savePeakEquitySnapshot({
      shadowPeakEquity: 10_000_000, shadowPeakAt: null,
      livePeakEquity: 0, livePeakAt: null, schemaVersion: 1,
    });
    expect(existsSync(`${paths.PEAK_EQUITY_FILE}.tmp`)).toBe(false);
    expect(existsSync(paths.PEAK_EQUITY_FILE)).toBe(true);
  });
});

// ─── getPeakEquity / getEffectivePeakEquity ────────────────────────────────

describe('getPeakEquity / getEffectivePeakEquity', () => {
  it('영속 부재 — getPeakEquity 0 반환', () => {
    expect(repo.getPeakEquity('SHADOW')).toBe(0);
    expect(repo.getPeakEquity('LIVE')).toBe(0);
  });

  it('영속 부재 — getEffectivePeakEquity currentEquity fallback', () => {
    expect(repo.getEffectivePeakEquity('SHADOW', 15_000_000)).toBe(15_000_000);
    expect(repo.getEffectivePeakEquity('LIVE', 50_000_000)).toBe(50_000_000);
  });

  it('영속 존재 — getEffectivePeakEquity 영속값 반환 (currentEquity 무시)', () => {
    repo.savePeakEquitySnapshot({
      shadowPeakEquity: 20_000_000, shadowPeakAt: null,
      livePeakEquity: 0, livePeakAt: null, schemaVersion: 1,
    });
    expect(repo.getEffectivePeakEquity('SHADOW', 15_000_000)).toBe(20_000_000);
    // LIVE 는 영속 부재 → currentEquity fallback
    expect(repo.getEffectivePeakEquity('LIVE', 50_000_000)).toBe(50_000_000);
  });

  it('SHADOW vs LIVE 분리 — 동시 영속', () => {
    repo.savePeakEquitySnapshot({
      shadowPeakEquity: 20_000_000, shadowPeakAt: '2026-05-02T00:00Z',
      livePeakEquity: 100_000_000, livePeakAt: '2026-05-02T01:00Z',
      schemaVersion: 1,
    });
    expect(repo.getPeakEquity('SHADOW')).toBe(20_000_000);
    expect(repo.getPeakEquity('LIVE')).toBe(100_000_000);
  });

  it('getPeakEquityWithMeta — peakAt 동시 반환', () => {
    repo.savePeakEquitySnapshot({
      shadowPeakEquity: 20_000_000, shadowPeakAt: '2026-05-02T00:00:00.000Z',
      livePeakEquity: 0, livePeakAt: null, schemaVersion: 1,
    });
    const meta = repo.getPeakEquityWithMeta('SHADOW');
    expect(meta.peakEquity).toBe(20_000_000);
    expect(meta.peakAt).toBe('2026-05-02T00:00:00.000Z');
  });
});

// ─── updatePeakEquityIfHigher — 자동 갱신 정책 ──────────────────────────────

describe('updatePeakEquityIfHigher — 자동 갱신 정책', () => {
  it('첫 갱신 — peak=0 → currentEquity 영속', () => {
    const updated = repo.updatePeakEquityIfHigher('SHADOW', 15_000_000);
    expect(updated).toBe(true);
    expect(repo.getPeakEquity('SHADOW')).toBe(15_000_000);
  });

  it('current > peak → 갱신 + true 반환', () => {
    repo.savePeakEquitySnapshot({
      shadowPeakEquity: 15_000_000, shadowPeakAt: null,
      livePeakEquity: 0, livePeakAt: null, schemaVersion: 1,
    });
    const updated = repo.updatePeakEquityIfHigher('SHADOW', 18_000_000);
    expect(updated).toBe(true);
    expect(repo.getPeakEquity('SHADOW')).toBe(18_000_000);
  });

  it('current = peak → no-op + false 반환', () => {
    repo.savePeakEquitySnapshot({
      shadowPeakEquity: 15_000_000, shadowPeakAt: null,
      livePeakEquity: 0, livePeakAt: null, schemaVersion: 1,
    });
    const updated = repo.updatePeakEquityIfHigher('SHADOW', 15_000_000);
    expect(updated).toBe(false);
    expect(repo.getPeakEquity('SHADOW')).toBe(15_000_000);
  });

  it('current < peak → no-op + false 반환 (drawdown 의도된 보존)', () => {
    repo.savePeakEquitySnapshot({
      shadowPeakEquity: 15_000_000, shadowPeakAt: null,
      livePeakEquity: 0, livePeakAt: null, schemaVersion: 1,
    });
    const updated = repo.updatePeakEquityIfHigher('SHADOW', 12_000_000);
    expect(updated).toBe(false);
    expect(repo.getPeakEquity('SHADOW')).toBe(15_000_000); // peak 보존
  });

  it('NaN/음수/0 currentEquity → false (부적합 입력 차단)', () => {
    expect(repo.updatePeakEquityIfHigher('SHADOW', NaN)).toBe(false);
    expect(repo.updatePeakEquityIfHigher('SHADOW', -1000)).toBe(false);
    expect(repo.updatePeakEquityIfHigher('SHADOW', 0)).toBe(false);
  });

  it('SHADOW 갱신 → LIVE 무영향', () => {
    repo.updatePeakEquityIfHigher('SHADOW', 20_000_000);
    expect(repo.getPeakEquity('SHADOW')).toBe(20_000_000);
    expect(repo.getPeakEquity('LIVE')).toBe(0);
  });

  it('LIVE 갱신 → SHADOW 무영향', () => {
    repo.updatePeakEquityIfHigher('LIVE', 100_000_000);
    expect(repo.getPeakEquity('LIVE')).toBe(100_000_000);
    expect(repo.getPeakEquity('SHADOW')).toBe(0);
  });

  it('peakAt ISO 시각 영속 — now 인자 사용', () => {
    const fixedNow = new Date('2026-05-02T05:30:00.000Z');
    repo.updatePeakEquityIfHigher('SHADOW', 25_000_000, fixedNow);
    const meta = repo.getPeakEquityWithMeta('SHADOW');
    expect(meta.peakAt).toBe('2026-05-02T05:30:00.000Z');
  });
});
