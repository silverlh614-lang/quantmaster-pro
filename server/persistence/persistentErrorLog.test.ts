import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('persistentErrorLog — 영속 에러 로그 (기억 보완 회로)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'errlog-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('recordPersistentError — JSONL append 후 listRecentErrors 로 회수', async () => {
    const { recordPersistentError, listRecentErrors } =
      await import('./persistentErrorLog.js');

    recordPersistentError('scheduler', new Error('boom-1'), 'ERROR');
    recordPersistentError('orchestrator', new Error('boom-2'), 'FATAL',
      { bootId: 'b-1', context: { stockCode: '005930' } });

    const recent = listRecentErrors();
    expect(recent.length).toBe(2);
    // 최신이 먼저
    expect(recent[0].source).toBe('orchestrator');
    expect(recent[0].severity).toBe('FATAL');
    expect(recent[0].bootId).toBe('b-1');
    expect(recent[0].context?.stockCode).toBe('005930');
    expect(recent[1].source).toBe('scheduler');
  });

  it('잘린/깨진 라인이 섞여 있어도 파싱 실패 라인만 건너뛰고 나머지는 회수', async () => {
    const { recordPersistentError, listRecentErrors } =
      await import('./persistentErrorLog.js');
    const { errorLogFile } = await import('./paths.js');
    const d = new Date();
    const yyyymm = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

    recordPersistentError('a', new Error('good-1'));
    // 수동으로 잘린 라인 삽입
    fs.appendFileSync(errorLogFile(yyyymm), '{not json\n');
    recordPersistentError('b', new Error('good-2'));

    const recent = await import('./persistentErrorLog.js').then(m => m.listRecentErrors());
    const sources = recent.map(e => e.source).sort();
    expect(sources).toEqual(['a', 'b']);
  });

  it('summarizeErrors — 24시간 집계 + fatal 카운트', async () => {
    const { recordPersistentError, summarizeErrors } =
      await import('./persistentErrorLog.js');

    recordPersistentError('src-a', new Error('x'), 'ERROR');
    recordPersistentError('src-a', new Error('y'), 'FATAL');
    recordPersistentError('src-b', new Error('z'), 'WARN');

    const s = summarizeErrors();
    expect(s.recent24h).toBe(3);
    expect(s.fatal24h).toBe(1);
    expect(s.bySource['src-a']).toBe(2);
    expect(s.bySource['src-b']).toBe(1);
    expect(s.lastAt).not.toBeNull();
  });

  it('비-Error 값 (string/object) 도 Error 로 래핑해서 저장', async () => {
    const { recordPersistentError, listRecentErrors } =
      await import('./persistentErrorLog.js');

    recordPersistentError('weird', 'raw string reason');
    recordPersistentError('weirder', { unexpected: true });

    const recent = listRecentErrors();
    expect(recent.length).toBe(2);
    expect(recent.find(e => e.source === 'weird')?.message).toBe('raw string reason');
    // Object 는 String() 에 의해 "[object Object]" 로 변환된다 — 소실 없이 저장됨만 확인
    expect(recent.find(e => e.source === 'weirder')?.message).toBeTruthy();
  });
});
