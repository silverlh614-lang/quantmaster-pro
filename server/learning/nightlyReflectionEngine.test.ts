/**
 * nightlyReflectionEngine.test.ts — Phase 1 Foundation 검증.
 *
 * 검증 범위:
 *   - KST 날짜 유틸 (타임존 경계)
 *   - Integrity Guard claim 필터링
 *   - Budget Governor 모드 결정 (Silence Monday flag / 85% / 95% / 100%)
 *   - runNightlyReflection 기본 흐름 (첫 실행 저장, 중복 스킵, priming 생성)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Phase 1 — reflectionIntegrity.applyIntegrityGuard', () => {
  it('sourceIds 미존재 claim 은 삭제되고 감사 기록된다', async () => {
    const { applyIntegrityGuard } = await import('./reflectionIntegrity.js');
    const report: any = {
      date: '2026-04-20',
      generatedAt: '2026-04-20T10:00:00Z',
      dailyVerdict: 'MIXED',
      keyLessons: [
        { text: '유효 교훈', sourceIds: ['t1'] },
        { text: '원천 없음', sourceIds: [] },
        { text: '미존재 원천', sourceIds: ['bogus'] },
      ],
      questionableDecisions: [],
      tomorrowAdjustments: [],
      followUpActions: [],
    };
    const audit = applyIntegrityGuard(report, new Set(['t1']));
    expect(audit.claimsIn).toBe(3);
    expect(audit.claimsOut).toBe(1);
    expect(audit.removed).toHaveLength(2);
    expect(report.keyLessons).toHaveLength(1);
    expect(report.keyLessons[0].text).toBe('유효 교훈');
    expect(report.integrity).toBe(audit);
  });

  it('knownSourceIds 가 비어있으면 sourceIds 하나 이상이면 통과', async () => {
    const { applyIntegrityGuard } = await import('./reflectionIntegrity.js');
    const report: any = {
      date: '2026-04-20', generatedAt: '', dailyVerdict: 'SILENT',
      keyLessons: [
        { text: 'A', sourceIds: ['anything'] },
        { text: 'B', sourceIds: [] },
      ],
      questionableDecisions: [], tomorrowAdjustments: [], followUpActions: [],
    };
    const audit = applyIntegrityGuard(report, new Set());
    expect(audit.claimsOut).toBe(1);
    expect(report.keyLessons[0].text).toBe('A');
  });

  it('parseReflectionJson — 펜스 블록 제거 + 복구 파싱', async () => {
    const { parseReflectionJson } = await import('./reflectionIntegrity.js');
    expect(parseReflectionJson('```json\n{"dailyVerdict":"GOOD_DAY"}\n```')).toEqual({ dailyVerdict: 'GOOD_DAY' });
    expect(parseReflectionJson('주의: {"dailyVerdict":"BAD_DAY"} 끝')).toEqual({ dailyVerdict: 'BAD_DAY' });
    expect(parseReflectionJson('not json')).toBeNull();
    expect(parseReflectionJson(null)).toBeNull();
  });
});

describe('Phase 1 — reflectionBudget.decideReflectionMode', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'refl-budget-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
    vi.doUnmock('../clients/geminiClient.js');
  });

  it('월요일 + SILENCE_MONDAY=true → SILENCE_MONDAY', async () => {
    vi.doMock('../clients/geminiClient.js', () => ({
      getBudgetState: () => ({ pctUsed: 10, spentUsd: 0, budgetUsd: 20 }),
    }));
    process.env.SILENCE_MONDAY = 'true';
    const { decideReflectionMode } = await import('./reflectionBudget.js');
    // 2026-04-20 = 월요일
    expect(decideReflectionMode('2026-04-20')).toBe('SILENCE_MONDAY');
    delete process.env.SILENCE_MONDAY;
  });

  it('월요일 + SILENCE_MONDAY 기본(비활성) → FULL', async () => {
    vi.doMock('../clients/geminiClient.js', () => ({
      getBudgetState: () => ({ pctUsed: 10, spentUsd: 0, budgetUsd: 20 }),
    }));
    const { decideReflectionMode } = await import('./reflectionBudget.js');
    expect(decideReflectionMode('2026-04-20')).toBe('FULL');
  });

  it('예산 여유 → FULL', async () => {
    vi.doMock('../clients/geminiClient.js', () => ({
      getBudgetState: () => ({ pctUsed: 10, spentUsd: 0, budgetUsd: 20 }),
    }));
    const { decideReflectionMode } = await import('./reflectionBudget.js');
    // 2026-04-21 = 화요일
    expect(decideReflectionMode('2026-04-21')).toBe('FULL');
  });

  it('예산 75% → FULL (임계값 완화로 85% 미만은 FULL)', async () => {
    vi.doMock('../clients/geminiClient.js', () => ({
      getBudgetState: () => ({ pctUsed: 75, spentUsd: 0, budgetUsd: 20 }),
    }));
    const { decideReflectionMode } = await import('./reflectionBudget.js');
    expect(decideReflectionMode('2026-04-21')).toBe('FULL');
  });

  it('예산 88% + 어제 실행 이력 없음 → REDUCED_EOD', async () => {
    vi.doMock('../clients/geminiClient.js', () => ({
      getBudgetState: () => ({ pctUsed: 88, spentUsd: 0, budgetUsd: 20 }),
    }));
    const { decideReflectionMode } = await import('./reflectionBudget.js');
    expect(decideReflectionMode('2026-04-21')).toBe('REDUCED_EOD');
  });

  it('예산 88% + 어제 실행 이력 있음 → TEMPLATE_ONLY (격일)', async () => {
    vi.doMock('../clients/geminiClient.js', () => ({
      getBudgetState: () => ({ pctUsed: 88, spentUsd: 0, budgetUsd: 20 }),
    }));
    const { saveReflectionBudget } = await import('../persistence/reflectionRepo.js');
    saveReflectionBudget({ month: '2026-04', tokensUsed: 1, callCount: 1, lastReflectionDate: '2026-04-20' });
    const { decideReflectionMode } = await import('./reflectionBudget.js');
    expect(decideReflectionMode('2026-04-21')).toBe('TEMPLATE_ONLY');
  });

  it('예산 97% + 수요일 → REDUCED_MWF', async () => {
    vi.doMock('../clients/geminiClient.js', () => ({
      getBudgetState: () => ({ pctUsed: 97, spentUsd: 0, budgetUsd: 20 }),
    }));
    const { decideReflectionMode } = await import('./reflectionBudget.js');
    // 2026-04-22 = 수요일
    expect(decideReflectionMode('2026-04-22')).toBe('REDUCED_MWF');
  });

  it('예산 97% + 화요일 → TEMPLATE_ONLY', async () => {
    vi.doMock('../clients/geminiClient.js', () => ({
      getBudgetState: () => ({ pctUsed: 97, spentUsd: 0, budgetUsd: 20 }),
    }));
    const { decideReflectionMode } = await import('./reflectionBudget.js');
    expect(decideReflectionMode('2026-04-21')).toBe('TEMPLATE_ONLY');
  });

  it('예산 100% → TEMPLATE_ONLY (요일 무관)', async () => {
    vi.doMock('../clients/geminiClient.js', () => ({
      getBudgetState: () => ({ pctUsed: 100, spentUsd: 0, budgetUsd: 20 }),
    }));
    const { decideReflectionMode } = await import('./reflectionBudget.js');
    expect(decideReflectionMode('2026-04-22')).toBe('TEMPLATE_ONLY');
  });
});

describe('Phase 1 — runNightlyReflection 기본 흐름', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'refl-engine-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
    vi.doMock('../clients/geminiClient.js', () => ({
      getBudgetState: () => ({ pctUsed: 10, spentUsd: 0, budgetUsd: 5 }),
    }));
  });
  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
    vi.doUnmock('../clients/geminiClient.js');
  });

  it('첫 실행 → 리포트 저장 + priming 저장', async () => {
    const { runNightlyReflection } = await import('./nightlyReflectionEngine.js');
    // 2026-04-21 KST 19:00 = 2026-04-21 10:00 UTC
    const now = new Date(Date.UTC(2026, 3, 21, 10, 0, 0));
    const res = await runNightlyReflection({ now });
    expect(res.executed).toBe(true);
    expect(res.date).toBe('2026-04-21');
    expect(res.report?.dailyVerdict).toBe('SILENT'); // 입력 비어있음
    expect(fs.existsSync(path.join(tmpDir, 'reflections', '2026-04-21.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'tomorrow-priming.json'))).toBe(true);
    const priming = JSON.parse(fs.readFileSync(path.join(tmpDir, 'tomorrow-priming.json'), 'utf-8'));
    expect(priming.forDate).toBe('2026-04-22');
  });

  it('같은 날 재실행 → ALREADY_EXISTS 스킵', async () => {
    const { runNightlyReflection } = await import('./nightlyReflectionEngine.js');
    const now = new Date(Date.UTC(2026, 3, 21, 10, 0, 0));
    await runNightlyReflection({ now });
    const res2 = await runNightlyReflection({ now });
    expect(res2.executed).toBe(false);
    expect(res2.skipped).toBe('ALREADY_EXISTS');
  });

  it('월요일 + SILENCE_MONDAY=true → SILENCE_MONDAY 모드로 실행', async () => {
    const { runNightlyReflection } = await import('./nightlyReflectionEngine.js');
    // 2026-04-20 KST = 월요일. 10 UTC = 19 KST.
    process.env.SILENCE_MONDAY = 'true';
    try {
      const now = new Date(Date.UTC(2026, 3, 20, 10, 0, 0));
      const res = await runNightlyReflection({ now });
      expect(res.mode).toBe('SILENCE_MONDAY');
      expect(res.executed).toBe(true);
      expect(res.report?.keyLessons[0]?.text).toMatch(/월요일 침묵/);
    } finally {
      delete process.env.SILENCE_MONDAY;
    }
  });

  it('kstDate — UTC→KST 경계 변환', async () => {
    const { __test } = await import('./nightlyReflectionEngine.js');
    // 2026-04-20 23:00 UTC = 2026-04-21 08:00 KST
    expect(__test.kstDate(new Date(Date.UTC(2026, 3, 20, 23, 0, 0)))).toBe('2026-04-21');
    // 2026-04-20 10:00 UTC = 2026-04-20 19:00 KST
    expect(__test.kstDate(new Date(Date.UTC(2026, 3, 20, 10, 0, 0)))).toBe('2026-04-20');
    expect(__test.tomorrowKst('2026-04-30')).toBe('2026-05-01');
  });
});

describe('Phase 2 — runNightlyReflection FULL flow (mocked Gemini)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'refl-full-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
    vi.doUnmock('../clients/geminiClient.js');
    vi.doUnmock('../rag/localRag.js');
    vi.doUnmock('../alerts/telegramClient.js');
  });

  it('FULL 모드 — Gemini 성공 응답 → 리포트에 keyLessons + counterfactual 포함', async () => {
    const callGemini = vi.fn()
      // main reflection
      .mockResolvedValueOnce('{"dailyVerdict":"GOOD_DAY","keyLessons":[{"text":"이제 손절은 지연하지 말자.","sourceIds":["pre1"]}],"questionableDecisions":[],"tomorrowAdjustments":[{"text":"섹터 집중 40%로 제한.","sourceIds":["pre1"]}],"followUpActions":[]}')
      // narrative (Phase 4 #13) — 이후 모든 호출 기본 문자열
      .mockResolvedValue('오늘은 관망세로 출발해 오후 외인 순매도로 KOSPI -1%.');
    vi.doMock('../clients/geminiClient.js', () => ({
      callGemini,
      getBudgetState: () => ({ pctUsed: 10, spentUsd: 0, budgetUsd: 5 }),
    }));
    vi.doMock('../rag/localRag.js', () => ({ queryRag: vi.fn().mockResolvedValue([]) }));
    vi.doMock('../alerts/telegramClient.js', () => ({
      sendTelegramAlert: vi.fn().mockResolvedValue(undefined),
    }));

    // pre-populate watchlist so knownSourceIds contains 'pre1'
    fs.writeFileSync(path.join(tmpDir, 'watchlist.json'), JSON.stringify([{ code: 'pre1', name: 'TEST', isFocus: false }]));

    const { runNightlyReflection } = await import('./nightlyReflectionEngine.js');
    const now = new Date(Date.UTC(2026, 3, 21, 10, 0, 0)); // 2026-04-21 (Tue) KST 19:00
    const res = await runNightlyReflection({ now });
    expect(res.executed).toBe(true);
    expect(res.mode).toBe('FULL');
    expect(res.report?.dailyVerdict).toBe('GOOD_DAY');
    expect(res.report?.keyLessons).toHaveLength(1);
    expect(res.report?.tomorrowAdjustments).toHaveLength(1);
    expect(res.report?.counterfactual).toBeDefined();
    expect(res.report?.narrative).toBeTruthy();
    expect(res.report?.narrative?.length).toBeLessThanOrEqual(300);
    // priming 에 내일 조정이 주입됨
    const priming = JSON.parse(fs.readFileSync(path.join(tmpDir, 'tomorrow-priming.json'), 'utf-8'));
    expect(priming.adjustments).toHaveLength(1);
  });

  it('Gemini 응답 null → GEMINI_FALLBACK + parseFailed 플래그', async () => {
    vi.doMock('../clients/geminiClient.js', () => ({
      callGemini: vi.fn().mockResolvedValue(null),
      getBudgetState: () => ({ pctUsed: 10, spentUsd: 0, budgetUsd: 5 }),
    }));
    vi.doMock('../rag/localRag.js', () => ({ queryRag: vi.fn().mockResolvedValue([]) }));
    vi.doMock('../alerts/telegramClient.js', () => ({
      sendTelegramAlert: vi.fn().mockResolvedValue(undefined),
    }));
    const { runNightlyReflection } = await import('./nightlyReflectionEngine.js');
    const now = new Date(Date.UTC(2026, 3, 21, 10, 0, 0));
    const res = await runNightlyReflection({ now });
    expect(res.executed).toBe(true);
    expect(res.report?.integrity?.parseFailed).toBe(true);
    expect(res.report?.keyLessons[0]?.text).toMatch(/Gemini 응답 실패/);
  });

  it('disableGemini=true → 템플릿 모드 강제', async () => {
    vi.doMock('../clients/geminiClient.js', () => ({
      callGemini: vi.fn(),
      getBudgetState: () => ({ pctUsed: 10, spentUsd: 0, budgetUsd: 5 }),
    }));
    vi.doMock('../alerts/telegramClient.js', () => ({
      sendTelegramAlert: vi.fn().mockResolvedValue(undefined),
    }));
    const { runNightlyReflection } = await import('./nightlyReflectionEngine.js');
    const now = new Date(Date.UTC(2026, 3, 21, 10, 0, 0));
    const res = await runNightlyReflection({ now, disableGemini: true });
    expect(res.report?.keyLessons[0]?.text).toMatch(/로컬 템플릿/);
  });
});
