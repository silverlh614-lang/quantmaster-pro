/**
 * phase5E2E.test.ts — End-to-End integration test.
 *
 * 목표: 실제 거래/사건/놓친 신호가 있는 상황에서 Phase 1~4 전 모듈이
 *        1회 runNightlyReflection 으로 일관된 리포트를 생성하는지 검증.
 *
 * Mock 범위:
 *   - callGemini : 메인·페르소나·5-Why·서사 순서대로 반응
 *   - Telegram   : no-op
 *   - RAG        : 빈 hits
 *   - KIS        : 가격 고정 리턴
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Phase 5 — E2E runNightlyReflection (FULL path with all modules)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-reflection-'));
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

  it('손절 1건 + 익절 1건 + 사건 1건 + 놓친 신호 2건 → 리포트 전 필드 채움', async () => {
    // Mock Gemini: 메인 JSON → 페르소나 4명 → 5-Why 5단계 → 서사
    const callGemini = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({
        dailyVerdict: 'MIXED',
        keyLessons: [{ text: '손절 기계화 유효 확인', sourceIds: ['trade_loss1'] }],
        questionableDecisions: [{ text: '익절 너무 빨랐음', sourceIds: ['trade_win1'] }],
        tomorrowAdjustments: [{ text: '섹터 집중 40% 상한 유지', sourceIds: ['trade_loss1'] }],
        followUpActions: [{ text: 'weekly L3 캘리브레이션 체크', sourceIds: ['2026-04-21T05:00:00Z'] }],
      }))
      // 페르소나 4명 (primary trade)
      .mockResolvedValueOnce('{"signal":"GREEN","comment":"데이터 양호"}')
      .mockResolvedValueOnce('{"signal":"YELLOW","comment":"포지션 약간 과대"}')
      .mockResolvedValueOnce('{"signal":"GREEN","comment":"편향 미검출"}')
      .mockResolvedValueOnce('{"signal":"GREEN","comment":"반례 없음"}')
      // 5-Why 5단계 (손절 1건)
      .mockResolvedValueOnce('Q1 answer: 공급망 경보 무시')
      .mockResolvedValueOnce('Q2 answer: 섹터 집중도 체크 누락')
      .mockResolvedValueOnce('Q3 answer: 레짐 전환 감지 지연')
      .mockResolvedValueOnce('Q4 answer: 과거에도 동일 패턴 2회')
      .mockResolvedValueOnce('Q5 answer: 레짐 전환기에 섹터 집중 금지')
      // 서사 (여러 호출 대비)
      .mockResolvedValue('오늘은 관망세로 출발해 오후 외인 순매도로 KOSPI -1%. 손절 1건과 익절 1건 혼재. 레짐 전환기 섹터 집중도 점검 필요.');

    vi.doMock('../clients/geminiClient.js', () => ({
      callGemini,
      getBudgetState: () => ({ pctUsed: 10, spentUsd: 0, budgetUsd: 5 }),
    }));
    vi.doMock('../rag/localRag.js', () => ({ queryRag: vi.fn().mockResolvedValue([]) }));
    vi.doMock('../alerts/telegramClient.js', () => ({
      sendTelegramAlert: vi.fn().mockResolvedValue(undefined),
    }));

    // Seed data files — 2026-04-21 KST 거래
    const todayKst = '2026-04-21';
    const closedIso = '2026-04-21T06:30:00Z'; // 15:30 KST
    fs.writeFileSync(path.join(tmpDir, 'shadow-trades.json'), JSON.stringify([
      {
        id: 'trade_loss1', stockCode: '005930', stockName: '삼성전자',
        signalTime: '2026-04-21T00:05:00Z', signalPrice: 70000,
        shadowEntryPrice: 70000, quantity: 10, stopLoss: 66000,
        targetPrice: 77000, status: 'HIT_STOP',
        exitPrice: 65500, exitTime: closedIso, returnPct: -6.43,
        exitRuleTag: 'HARD_STOP', entryRegime: 'R2_BULL',
      },
      {
        id: 'trade_win1', stockCode: '000660', stockName: 'SK하이닉스',
        signalTime: '2026-04-21T00:10:00Z', signalPrice: 120000,
        shadowEntryPrice: 120000, quantity: 5, stopLoss: 114000,
        targetPrice: 132000, status: 'HIT_TARGET',
        exitPrice: 132000, exitTime: closedIso, returnPct: 10,
        exitRuleTag: 'TARGET', entryRegime: 'R2_BULL',
      },
    ]));
    fs.writeFileSync(path.join(tmpDir, 'attribution-records.json'), JSON.stringify([
      {
        schemaVersion: 1, tradeId: 'trade_loss1', stockCode: '005930', stockName: '삼성전자',
        closedAt: closedIso, returnPct: -6.43, isWin: false, entryRegime: 'R2_BULL',
        conditionScores: { 17: 8, 21: 9, 5: 7 }, holdingDays: 3, sellReason: 'HARD_STOP',
      },
    ]));
    fs.writeFileSync(path.join(tmpDir, 'incident-log.json'), JSON.stringify([
      { at: '2026-04-21T05:00:00Z', severity: 'WARN', source: 'preOrderGuard', reason: '수량 불일치 경고' },
    ]));
    fs.writeFileSync(path.join(tmpDir, 'watchlist.json'), JSON.stringify([
      { code: '005380', name: '현대차', isFocus: false },
      { code: '035420', name: 'NAVER', isFocus: true },
    ]));

    const { runNightlyReflection } = await import('./nightlyReflectionEngine.js');
    const now = new Date(Date.UTC(2026, 3, 21, 10, 0, 0)); // KST 19:00
    const res = await runNightlyReflection({ now });

    expect(res.executed).toBe(true);
    expect(res.mode).toBe('FULL');
    // Integrity Guard 통과한 claims 존재
    expect(res.report?.keyLessons.length).toBeGreaterThan(0);
    expect(res.report?.tomorrowAdjustments.length).toBeGreaterThan(0);
    // Counterfactual — HIT_STOP exitPrice < stopLoss 이므로 lateStopKrw 양수
    expect(res.report?.counterfactual?.lateStopKrw).toBeGreaterThan(0);
    // 5-Why 결과 기록
    expect(res.report?.fiveWhy?.length).toBe(1);
    expect(res.report?.fiveWhy?.[0].steps).toHaveLength(5);
    // 페르소나 결과 기록
    expect(res.report?.personaReview?.votes).toHaveLength(4);
    // Regret 수치 계산됨
    expect(res.report?.regret?.immediateStopLossKrw).toBeGreaterThan(0);
    // Narrative ≤ 300자
    expect(res.report?.narrative?.length).toBeLessThanOrEqual(300);
    // Bias 기록됨
    const biasFile = path.join(tmpDir, 'bias-heatmap.json');
    expect(fs.existsSync(biasFile)).toBe(true);
    const biasEntries = JSON.parse(fs.readFileSync(biasFile, 'utf-8'));
    expect(biasEntries[0].scores).toHaveLength(10);
    // Tomorrow priming 저장
    const priming = JSON.parse(fs.readFileSync(path.join(tmpDir, 'tomorrow-priming.json'), 'utf-8'));
    expect(priming.forDate).toBe('2026-04-22');
    expect(priming.oneLineLearning).toBeTruthy();
    // Ghost Portfolio 에 놓친 신호 등록
    const ghost = JSON.parse(fs.readFileSync(path.join(tmpDir, 'ghost-portfolio.json'), 'utf-8'));
    expect(ghost.length).toBe(2); // watchlist 2종목 모두 enter/close 이력 없음
  });
});

describe('Phase 5 — weeklyReflectionAudit', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('auditReports — claim 집계 + parseFailed + 5-Why 태그 분포', async () => {
    const { auditReports } = await import('./reflectionModules/weeklyReflectionAudit.js');
    const reports: any[] = [
      {
        date: '2026-04-14', generatedAt: '', dailyVerdict: 'MIXED', mode: 'FULL',
        keyLessons: [{ text: '교훈 A', sourceIds: ['t1'] }, { text: '교훈 B', sourceIds: ['t2'] }],
        questionableDecisions: [], tomorrowAdjustments: [], followUpActions: [],
        integrity: { claimsIn: 3, claimsOut: 2, removed: ['bad'] },
        fiveWhy: [{ tradeId: 't1', stockCode: '', steps: [], tag: 'YELLOW_NEW_INSIGHT' }],
      },
      {
        date: '2026-04-15', generatedAt: '', dailyVerdict: 'BAD_DAY', mode: 'FULL',
        keyLessons: [{ text: '교훈 A', sourceIds: ['t3'] }],
        questionableDecisions: [], tomorrowAdjustments: [], followUpActions: [],
        integrity: { claimsIn: 2, claimsOut: 1, removed: ['x'], parseFailed: true },
        fiveWhy: [{ tradeId: 't3', stockCode: '', steps: [], tag: 'GREEN_EXISTING' }],
      },
      {
        date: '2026-04-20', generatedAt: '', dailyVerdict: 'SILENT', mode: 'SILENCE_MONDAY',
        keyLessons: [], questionableDecisions: [], tomorrowAdjustments: [], followUpActions: [],
      },
    ];
    const audit = auditReports(reports, 7);
    expect(audit.totalReports).toBe(3);
    expect(audit.modeDistribution.FULL).toBe(2);
    expect(audit.modeDistribution.SILENCE_MONDAY).toBe(1);
    expect(audit.totalClaimsIn).toBe(5);
    expect(audit.totalClaimsOut).toBe(3);
    expect(audit.totalClaimsRemoved).toBe(2);
    expect(audit.removalRatePct).toBe(40);
    expect(audit.parseFailedCount).toBe(1);
    expect(audit.fiveWhyYellowCount).toBe(1);
    expect(audit.fiveWhyGreenCount).toBe(1);
    expect(audit.topLessons[0].text).toBe('교훈 A');
    expect(audit.topLessons[0].count).toBe(2);
  });
});

describe('Phase 5 — callReflectionGemini fallback', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => {
    vi.doUnmock('../clients/geminiClient.js');
    vi.doUnmock('../ai/aiProvider.js');
  });

  it('aiProvider 미구성 시 callGemini 로 fallback', async () => {
    const callGemini = vi.fn().mockResolvedValue('fallback response');
    vi.doMock('../clients/geminiClient.js', () => ({ callGemini }));
    vi.doMock('../ai/aiProvider.js', () => ({
      getAiProvider: () => ({ isConfigured: () => false, textOnly: vi.fn(), name: 'gemini' }),
    }));
    const { callReflectionGemini } = await import('./reflectionModules/reflectionGemini.js');
    const res = await callReflectionGemini('prompt', 'test');
    expect(res).toBe('fallback response');
    expect(callGemini).toHaveBeenCalledWith('prompt', 'test');
  });

  it('aiProvider 구성 시 temperature=0.2 로 호출', async () => {
    const textOnly = vi.fn().mockResolvedValue('provider response');
    vi.doMock('../clients/geminiClient.js', () => ({ callGemini: vi.fn() }));
    vi.doMock('../ai/aiProvider.js', () => ({
      getAiProvider: () => ({ isConfigured: () => true, textOnly, name: 'gemini' }),
    }));
    const { callReflectionGemini } = await import('./reflectionModules/reflectionGemini.js');
    const res = await callReflectionGemini('prompt', 'test');
    expect(res).toBe('provider response');
    expect(textOnly).toHaveBeenCalledWith('prompt', expect.objectContaining({
      temperature: 0.2,
      caller: 'test',
    }));
  });
});
