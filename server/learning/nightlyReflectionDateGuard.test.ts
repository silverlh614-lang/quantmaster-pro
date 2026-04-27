/**
 * @responsibility runNightlyReflection 주말·KRX 공휴일 가드 회귀 테스트 — PR-A 신규.
 *
 * 가드 위치: nightlyReflectionEngine.ts 진입부, ALREADY_EXISTS 체크 직후.
 * 검증 시나리오:
 *   - 토/일 KST → skipped='NON_TRADING_DAY', executed=false
 *   - 평일 KRX 공휴일 (어린이날 5/5) → skipped='NON_TRADING_DAY'
 *   - 평일 영업일 (화요일 4/21) → 가드 통과 후 정상 실행
 *   - opts.force=true + 주말 → 가드 우회 (수동 운영 호환)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('PR-A — runNightlyReflection 주말·공휴일 가드', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'refl-pr-a-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
    vi.doMock('../clients/geminiClient.js', () => ({
      getBudgetState: () => ({ pctUsed: 10, spentUsd: 0, budgetUsd: 20 }),
      getGeminiRuntimeState: () => ({
        status: 'IDLE', label: null, caller: null, reason: null, updatedAt: null,
      }),
    }));
    vi.doMock('../alerts/telegramClient.js', () => ({
      sendTelegramAlert: vi.fn().mockResolvedValue(undefined),
    }));
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
    vi.doUnmock('../clients/geminiClient.js');
    vi.doUnmock('../alerts/telegramClient.js');
  });

  it('토요일 KST → NON_TRADING_DAY 스킵', async () => {
    const { runNightlyReflection } = await import('./nightlyReflectionEngine.js');
    // 2026-04-25 KST 토요일 19:00 = 2026-04-25 10:00 UTC
    const now = new Date(Date.UTC(2026, 3, 25, 10, 0, 0));
    const res = await runNightlyReflection({ now });
    expect(res.executed).toBe(false);
    expect(res.skipped).toBe('NON_TRADING_DAY');
    expect(res.date).toBe('2026-04-25');
    expect(res.mode).toBe('TEMPLATE_ONLY');
    // 리포트가 생성되지 않아야 한다
    expect(fs.existsSync(path.join(tmpDir, 'reflections', '2026-04-25.json'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'tomorrow-priming.json'))).toBe(false);
  });

  it('일요일 KST → NON_TRADING_DAY 스킵', async () => {
    const { runNightlyReflection } = await import('./nightlyReflectionEngine.js');
    // 2026-04-26 KST 일요일 19:00 = 2026-04-26 10:00 UTC
    const now = new Date(Date.UTC(2026, 3, 26, 10, 0, 0));
    const res = await runNightlyReflection({ now });
    expect(res.executed).toBe(false);
    expect(res.skipped).toBe('NON_TRADING_DAY');
    expect(res.date).toBe('2026-04-26');
  });

  it('평일 KRX 공휴일 (어린이날 5/5) → NON_TRADING_DAY 스킵', async () => {
    const { runNightlyReflection } = await import('./nightlyReflectionEngine.js');
    // 2026-05-05 KST 화요일 19:00 = 2026-05-05 10:00 UTC. 어린이날(KRX 휴장).
    const now = new Date(Date.UTC(2026, 4, 5, 10, 0, 0));
    const res = await runNightlyReflection({ now });
    expect(res.executed).toBe(false);
    expect(res.skipped).toBe('NON_TRADING_DAY');
    expect(res.date).toBe('2026-05-05');
    // 리포트가 생성되지 않아야 한다
    expect(fs.existsSync(path.join(tmpDir, 'reflections', '2026-05-05.json'))).toBe(false);
  });

  it('평일 영업일(화요일 4/21) → 가드 통과 후 정상 실행', async () => {
    const { runNightlyReflection } = await import('./nightlyReflectionEngine.js');
    // 2026-04-21 KST 화요일 19:00. 영업일이고 KRX 공휴일 아님.
    const now = new Date(Date.UTC(2026, 3, 21, 10, 0, 0));
    const res = await runNightlyReflection({ now });
    expect(res.executed).toBe(true);
    expect(res.skipped).toBeUndefined();
    expect(res.date).toBe('2026-04-21');
    expect(fs.existsSync(path.join(tmpDir, 'reflections', '2026-04-21.json'))).toBe(true);
  });

  it('opts.force=true + 토요일 → 가드 우회, 실제 실행 진입', async () => {
    const { runNightlyReflection } = await import('./nightlyReflectionEngine.js');
    // 2026-04-25 KST 토요일. force=true 면 가드 우회.
    const now = new Date(Date.UTC(2026, 3, 25, 10, 0, 0));
    const res = await runNightlyReflection({ now, force: true });
    expect(res.executed).toBe(true);
    expect(res.skipped).toBeUndefined();
    expect(res.date).toBe('2026-04-25');
    expect(fs.existsSync(path.join(tmpDir, 'reflections', '2026-04-25.json'))).toBe(true);
  });

  it('주말 가드는 ALREADY_EXISTS 보다 늦게 작동 (기존 reflection 보존)', async () => {
    const { runNightlyReflection } = await import('./nightlyReflectionEngine.js');
    const { saveReflection } = await import('../persistence/reflectionRepo.js');
    // 토요일에 이미 reflection 이 저장되어 있다면 (force 로 생성된 과거 기록 등)
    // ALREADY_EXISTS 가 우선 — 주말 가드보다 위에 있다.
    saveReflection({
      date: '2026-04-25',
      generatedAt: '2026-04-25T10:00:00Z',
      dailyVerdict: 'SILENT',
      keyLessons: [{ text: '기존 기록', sourceIds: ['t1'] }],
      questionableDecisions: [],
      tomorrowAdjustments: [],
      followUpActions: [],
      mode: 'TEMPLATE_ONLY',
    });
    const now = new Date(Date.UTC(2026, 3, 25, 10, 0, 0));
    const res = await runNightlyReflection({ now });
    expect(res.executed).toBe(false);
    expect(res.skipped).toBe('ALREADY_EXISTS');
    expect(res.report?.keyLessons[0]?.text).toBe('기존 기록');
  });
});
