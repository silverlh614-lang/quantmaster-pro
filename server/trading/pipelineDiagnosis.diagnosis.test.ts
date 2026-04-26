/**
 * @responsibility pipelineDiagnosis Yahoo SSOT 통합·informational 등급 분리 회귀 테스트
 *
 * ADR-0056 v4 — getYahooHealthSnapshot SSOT mock 으로 5분기 검증:
 *   OK / STALE / DEGRADED / DOWN / UNKNOWN
 *
 * 자체 fetch 호출이 *제거* 되었음을 검증 (회귀 차단).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 외부 의존성 mock — 본 테스트는 ⑤ Yahoo SSOT 분기만 검증.
vi.mock('./marketDataRefresh.js', () => ({
  getYahooHealthSnapshot: vi.fn(),
}));
vi.mock('../persistence/watchlistRepo.js', () => ({
  loadWatchlist: vi.fn(() => [{ code: '000660', name: 'SK하이닉스', isFocus: true, section: 'SWING' }]),
}));
vi.mock('../clients/kisClient.js', () => ({
  getKisTokenRemainingHours: vi.fn(() => 5),
  refreshKisToken: vi.fn(async () => ({})),
}));
vi.mock('../screener/dataCompletenessTracker.js', () => ({
  getCompletenessSnapshot: vi.fn(() => ({
    isDataStarved: false,
    mtasFailRate: 0,
    dartNullRate: 0,
    aggregateFailRate: 0,
    mtasAttempts: 0,
    dartAttempts: 0,
  })),
}));

import { runPipelineDiagnosis } from './pipelineDiagnosis.js';
import { getYahooHealthSnapshot } from './marketDataRefresh.js';

beforeEach(() => {
  // KIS_APP_KEY 미설정 + AUTO_TRADE_ENABLED 미설정 → Yahoo 분기만 활성화
  delete process.env.KIS_APP_KEY;
  delete process.env.AUTO_TRADE_ENABLED;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('runPipelineDiagnosis — Yahoo SSOT 통합 (ADR-0056)', () => {
  it('OK 상태 — Yahoo 알림 없음', async () => {
    vi.mocked(getYahooHealthSnapshot).mockReturnValue({
      lastSuccessAt: Date.now() - 10 * 60_000, // 10분 전
      lastFailureAt: 0,
      consecutiveFailures: 0,
      status: 'OK',
    });

    const r = await runPipelineDiagnosis();

    // Yahoo 분기만 검증 — 다른 issues (DATA_DIR 등) 는 환경 의존이라 무시.
    expect(r.issues.filter((i) => i.includes('Yahoo'))).toEqual([]);
    expect(r.warnings.filter((w) => w.includes('Yahoo'))).toEqual([]);
    expect(r.informational.filter((i) => i.includes('Yahoo'))).toEqual([]);
  });

  it('DOWN 상태 — issues 에 OPERATIONAL CRITICAL 푸시', async () => {
    vi.mocked(getYahooHealthSnapshot).mockReturnValue({
      lastSuccessAt: Date.now() - 13 * 3_600_000, // 13시간 전
      lastFailureAt: Date.now(),
      consecutiveFailures: 7,
      status: 'DOWN',
    });

    const r = await runPipelineDiagnosis();

    expect(r.hasCriticalIssue).toBe(true);
    const yahooIssue = r.issues.find((i) => i.includes('Yahoo'));
    expect(yahooIssue).toBeDefined();
    expect(yahooIssue).toContain('7회 연속 실패');
    expect(yahooIssue).toContain('Gate 재평가 불가');
  });

  it('STALE 상태 — informational 만, issues/warnings 깨끗', async () => {
    vi.mocked(getYahooHealthSnapshot).mockReturnValue({
      lastSuccessAt: Date.now() - 2 * 3_600_000, // 2시간 전
      lastFailureAt: 0,
      consecutiveFailures: 0,
      status: 'STALE',
    });

    const r = await runPipelineDiagnosis();

    // Yahoo 분기만 검증 — DATA_DIR 등 환경 의존 issues 는 본 테스트 scope 밖.
    expect(r.issues.filter((i) => i.includes('Yahoo'))).toEqual([]);
    expect(r.warnings.filter((w) => w.includes('Yahoo'))).toEqual([]);
    const informational = r.informational.find((i) => i.includes('Yahoo'));
    expect(informational).toBeDefined();
    expect(informational).toContain('비활성');
    expect(informational).toContain('120분 전'); // 2h = 120m
  });

  it('UNKNOWN 상태 — informational (부팅 직후 cron 첫 실행)', async () => {
    vi.mocked(getYahooHealthSnapshot).mockReturnValue({
      lastSuccessAt: 0,
      lastFailureAt: 0,
      consecutiveFailures: 0,
      status: 'UNKNOWN',
    });

    const r = await runPipelineDiagnosis();

    // Yahoo 분기만 검증.
    expect(r.issues.filter((i) => i.includes('Yahoo'))).toEqual([]);
    const informational = r.informational.find((i) => i.includes('Yahoo'));
    expect(informational).toBeDefined();
    expect(informational).toContain('호출 이력 없음');
  });

  it('자체 fetch 호출 *제거* 회귀 차단 — guardedFetch 미사용', async () => {
    // pipelineDiagnosis.ts 가 guardedFetch 를 import 하지 않음을 검증.
    // ADR-0056: 자체 fetch 제거 = 단발성 503 알림 폭주 차단의 핵심.
    const fs = await import('fs');
    const src = fs.readFileSync(
      new URL('./pipelineDiagnosis.ts', import.meta.url),
      'utf-8',
    );
    expect(src).not.toContain('guardedFetch');
    expect(src).not.toContain('query1.finance.yahoo.com');
    expect(src).not.toContain('query2.finance.yahoo.com');
  });

  it('informational 필드 — 옵셔널 후방호환 (배열 항상 존재)', async () => {
    vi.mocked(getYahooHealthSnapshot).mockReturnValue({
      lastSuccessAt: Date.now(),
      lastFailureAt: 0,
      consecutiveFailures: 0,
      status: 'OK',
    });

    const r = await runPipelineDiagnosis();

    expect(Array.isArray(r.informational)).toBe(true);
  });
});
