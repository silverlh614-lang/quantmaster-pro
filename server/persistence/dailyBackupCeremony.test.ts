/**
 * dailyBackupCeremony.test.ts — 01:00 KST 스냅샷 계약 회귀.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('dailyBackupCeremony — 일일 전체 스냅샷', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ceremony-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('DATA_DIR 의 *.json 파일을 snapshots/YYYY-MM-DD/ 로 복사', async () => {
    fs.writeFileSync(path.join(tmpDir, 'shadow-trades.json'), JSON.stringify([{ id: 'x' }]));
    fs.writeFileSync(path.join(tmpDir, 'macro-state.json'), JSON.stringify({ regime: 'R2_BULL' }));
    fs.writeFileSync(path.join(tmpDir, 'not-json.txt'), 'skip me');

    const { runBackupCeremony } = await import('./dailyBackupCeremony.js');
    const r = runBackupCeremony(7);
    expect(r.copied.sort()).toEqual(['macro-state.json', 'shadow-trades.json']);
    expect(r.skipped).toContain('not-json.txt');
    expect(fs.existsSync(path.join(r.snapshotDir, 'shadow-trades.json'))).toBe(true);
  });

  it('빈 파일은 스냅샷하지 않는다 (의미 없음)', async () => {
    fs.writeFileSync(path.join(tmpDir, 'empty.json'), '');
    const { runBackupCeremony } = await import('./dailyBackupCeremony.js');
    const r = runBackupCeremony(7);
    expect(r.copied).not.toContain('empty.json');
    expect(r.skipped).toContain('empty.json');
  });

  it('7일 초과 스냅샷은 자동 pruning', async () => {
    const snapshotsRoot = path.join(tmpDir, 'snapshots');
    fs.mkdirSync(snapshotsRoot, { recursive: true });
    const oldDir = path.join(snapshotsRoot, '2025-01-01');  // 옛 날짜
    fs.mkdirSync(oldDir, { recursive: true });
    fs.writeFileSync(path.join(oldDir, 'x.json'), '{}');

    const { runBackupCeremony } = await import('./dailyBackupCeremony.js');
    const r = runBackupCeremony(7);
    expect(r.pruned).toContain('2025-01-01');
    expect(fs.existsSync(oldDir)).toBe(false);
  });

  it('snapshots/ 자체는 재귀 대상이 아니다', async () => {
    fs.writeFileSync(path.join(tmpDir, 'orch.json'), '{}');
    const snapshotsRoot = path.join(tmpDir, 'snapshots');
    fs.mkdirSync(snapshotsRoot, { recursive: true });

    const { runBackupCeremony } = await import('./dailyBackupCeremony.js');
    const r = runBackupCeremony(7);
    // snapshots 디렉토리 자체는 copied/skipped 어디에도 포함되지 않아야 함
    expect(r.copied.some(n => n.includes('snapshots'))).toBe(false);
    expect(r.skipped.some(n => n.includes('snapshots'))).toBe(false);
  });

  it('고가치 서브디렉토리(reflections·attribution/evidence-ledger)의 *.json 도 스냅샷', async () => {
    // reflections/2026-07-19.json
    fs.mkdirSync(path.join(tmpDir, 'reflections'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'reflections', '2026-07-19.json'), JSON.stringify({ wr: 0.6 }));
    // attribution/evidence-ledger/202607.json (2-depth)
    fs.mkdirSync(path.join(tmpDir, 'attribution', 'evidence-ledger'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'attribution', 'evidence-ledger', '202607.json'), JSON.stringify([{ id: 'a' }]));

    const { runBackupCeremony } = await import('./dailyBackupCeremony.js');
    const r = runBackupCeremony(7);

    const relRefl = path.join('reflections', '2026-07-19.json');
    const relEvid = path.join('attribution', 'evidence-ledger', '202607.json');
    expect(r.copied).toContain(relRefl);
    expect(r.copied).toContain(relEvid);
    // 원본 상대구조가 스냅샷 디렉토리에 그대로 복원돼야 함
    expect(fs.existsSync(path.join(r.snapshotDir, relRefl))).toBe(true);
    expect(fs.existsSync(path.join(r.snapshotDir, relEvid))).toBe(true);
  });

  it('서브디렉토리의 빈 파일/비-json 은 스냅샷 제외 (flat 계약과 동일 규칙)', async () => {
    fs.mkdirSync(path.join(tmpDir, 'reflections'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'reflections', 'empty.json'), '');
    fs.writeFileSync(path.join(tmpDir, 'reflections', 'note.txt'), 'skip');

    const { runBackupCeremony } = await import('./dailyBackupCeremony.js');
    const r = runBackupCeremony(7);
    expect(r.copied).not.toContain(path.join('reflections', 'empty.json'));
    expect(r.skipped).toContain(path.join('reflections', 'empty.json'));
    expect(r.skipped).toContain(path.join('reflections', 'note.txt'));
  });

  it('서브디렉토리 부재 시 no-op (flat *.json 스냅샷 기존 동작 무회귀)', async () => {
    fs.writeFileSync(path.join(tmpDir, 'macro-state.json'), JSON.stringify({ regime: 'R2_BULL' }));
    const { runBackupCeremony } = await import('./dailyBackupCeremony.js');
    const r = runBackupCeremony(7);
    expect(r.copied).toEqual(['macro-state.json']);
  });
});
