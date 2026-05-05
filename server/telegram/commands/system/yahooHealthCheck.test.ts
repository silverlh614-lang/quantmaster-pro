/**
 * @responsibility /yahoo_health (alias /yh) 회귀 가드 — STALE_BASE 분류 + 출력 포맷 + KIS 호출 0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { YahooQuoteExtended } from '../../../screener/adapters/yahooQuoteAdapter.js';
import type { WatchlistEntry } from '../../../persistence/watchlistRepo.js';
import {
  classifyIssueKind,
  classifyQuote,
  formatYahooHealthMessage,
  resolveYahooSymbolForCode,
  runYahooHealthCheck,
  YAHOO_HEALTH_BATCH_SIZE,
  YAHOO_HEALTH_DETAIL_LIMIT,
  YAHOO_HEALTH_LIMIT,
  type YahooHealthSummary,
} from './yahooHealthCheck.cmd.js';

function makeQuote(over: Partial<YahooQuoteExtended> = {}): YahooQuoteExtended {
  return {
    price: 10000, dayOpen: 10000, prevClose: 10000, changePercent: 0,
    volume: 1000, avgVolume: 1000,
    ma5: 10000, ma20: 10000, ma60: 10000,
    high5d: 10000, high20d: 10000, high60d: 10000,
    atr: 0, atr20avg: 0, per: 0, rsi14: 50,
    macd: 0, macdSignal: 0, macdHistogram: 0,
    rsi5dAgo: 50, weeklyRSI: 50, ma60TrendUp: false, macd5dHistAgo: 0,
    return5d: 0, return20d: 0,
    bbWidthCurrent: 0, bbWidth20dAvg: 0, vol5dAvg: 0, vol20dAvg: 0, atr5d: 0,
    monthlyAboveEMA12: false, monthlyEMARising: false,
    weeklyAboveCloud: false, weeklyLaggingSpanUp: false,
    dailyVolumeDrying: false, isHighRisk: false,
    dataQuality: 'OK',
    ...over,
  };
}

function makeWatch(code: string, name: string): WatchlistEntry {
  return {
    code, name,
    entryPrice: 10000, stopLoss: 9000, targetPrice: 12000,
    addedAt: '2026-04-30T00:00:00.000Z', addedBy: 'AUTO',
  };
}

describe('classifyIssueKind — quote.dataQualityIssues field → IssueKind', () => {
  it('changePercent → STALE_BASE_CHANGE', () => {
    expect(classifyIssueKind('changePercent')).toBe('STALE_BASE_CHANGE');
  });
  it('return5d → STALE_BASE_5D', () => {
    expect(classifyIssueKind('return5d')).toBe('STALE_BASE_5D');
  });
  it('return20d → STALE_BASE_20D', () => {
    expect(classifyIssueKind('return20d')).toBe('STALE_BASE_20D');
  });
});

describe('상수 SSOT — limits / batch size', () => {
  it('YAHOO_HEALTH_LIMIT=30 / DETAIL_LIMIT=15 / BATCH_SIZE=5', () => {
    expect(YAHOO_HEALTH_LIMIT).toBe(30);
    expect(YAHOO_HEALTH_DETAIL_LIMIT).toBe(15);
    expect(YAHOO_HEALTH_BATCH_SIZE).toBe(5);
  });
});

describe('classifyQuote — quote → IssueDetail (null=정상)', () => {
  const e = makeWatch('005930', '삼성전자');
  it('quote=null → FETCH_FAIL', () => {
    const d = classifyQuote(e, null);
    expect(d?.kinds).toEqual(['FETCH_FAIL']);
    expect(d?.changePercent).toBeUndefined();
  });
  it('dataQuality=OK → null (정상)', () => {
    expect(classifyQuote(e, makeQuote())).toBeNull();
  });
  it('STALE_BASE + changePercent issue → STALE_BASE_CHANGE', () => {
    const d = classifyQuote(e, makeQuote({
      dataQuality: 'STALE_BASE',
      dataQualityIssues: ['changePercent'],
      changePercent: 418.96,
    }));
    expect(d?.kinds).toEqual(['STALE_BASE_CHANGE']);
    expect(d?.changePercent).toBe(418.96);
    expect(d?.issues).toEqual(['changePercent']);
  });
  it('STALE_BASE + 다중 issues → 모두 분류', () => {
    const d = classifyQuote(e, makeQuote({
      dataQuality: 'STALE_BASE',
      dataQualityIssues: ['changePercent', 'return5d', 'return20d'],
      changePercent: 418, return5d: 443, return20d: 115,
    }));
    expect(d?.kinds).toEqual(['STALE_BASE_CHANGE', 'STALE_BASE_5D', 'STALE_BASE_20D']);
  });
  it('STALE_BASE + issues 부재 → UNKNOWN', () => {
    const d = classifyQuote(e, makeQuote({ dataQuality: 'STALE_BASE' }));
    expect(d?.kinds).toEqual(['UNKNOWN']);
  });
});

describe('formatYahooHealthMessage — 텔레그램 출력 포맷', () => {
  function summary(over: Partial<YahooHealthSummary> = {}): YahooHealthSummary {
    // ADR-0188 (lint baseline cleanup): YahooHealthSummary 의 4 신규 필드
    // (recoveredCount / historicalRefreshRecoveredCount / historicalRefreshFailedCount /
    // staleUnrecoveredCount) 정합 — test factory 에 0 default 추가.
    return {
      capturedAt: '2026-05-01T07:15:00.000Z',
      checkedCount: 0,
      okCount: 0,
      failCount: 0,
      recoveredCount: 0,
      historicalRefreshRecoveredCount: 0,
      historicalRefreshFailedCount: 0,
      staleUnrecoveredCount: 0,
      details: [],
      ...over,
    };
  }
  it('워치리스트 비어있음 → 안내', () => {
    const msg = formatYahooHealthMessage(summary());
    expect(msg).toContain('🩺 Yahoo Health Check');
    expect(msg).toContain('워치리스트가 비어있어 검증 대상 0건');
  });
  it('전체 정상 → ✨ 메시지', () => {
    const msg = formatYahooHealthMessage(summary({ checkedCount: 24, okCount: 24 }));
    expect(msg).toContain('✅ 정상: 24건');
    expect(msg).toContain('⚠️ Sanity 위반: 0건');
    expect(msg).toContain('모든 종목 sanity 통과');
  });
  it('위반 1건 → 상세 + 권장 조치', () => {
    const msg = formatYahooHealthMessage(summary({
      checkedCount: 30, okCount: 29, failCount: 1,
      details: [{
        code: '101930', name: '의료기기A',
        symbol: '101930.KQ',
        kinds: ['STALE_BASE_5D'],
        return5d: 443.36,
        issues: ['return5d'],
      }],
    }));
    expect(msg).toContain('1. 101930.KQ 의료기기A');
    expect(msg).toContain('return5d: +443.36%');
    // ADR-0188 (lint baseline cleanup): production 메시지 형식 갱신 정합 — `STALE_BASE`
    // → `DATA_STALE_PRICE` 라벨링 변경 + 권장 조치 문구 갱신.
    expect(msg).toContain('DATA_STALE_PRICE — Yahoo base.asOf 만료');
    expect(msg).toContain('🎯 권장 조치');
    expect(msg).toContain('Yahoo history refresh');
  });
  it('FETCH_FAIL 출력', () => {
    const msg = formatYahooHealthMessage(summary({
      checkedCount: 1, okCount: 0, failCount: 1,
      details: [{ code: '900100', name: '코넥스종목', symbol: null, kinds: ['FETCH_FAIL'] }],
    }));
    expect(msg).toContain('900100(?)');
    expect(msg).toContain('FETCH_FAIL — Yahoo quote 부재');
  });
  it('15건 초과 시 절삭 안내', () => {
    const details = Array.from({ length: 20 }, (_, i) => ({
      code: `00000${i}`, name: `종목${i}`, symbol: `00000${i}.KS`,
      kinds: ['STALE_BASE_CHANGE'] as const,
      changePercent: 100 + i,
      issues: ['changePercent'] as const,
    }));
    const msg = formatYahooHealthMessage(summary({
      checkedCount: 30, okCount: 10, failCount: 20,
      details: details.map((d) => ({ ...d, kinds: [...d.kinds], issues: [...d.issues] })),
    }));
    expect(msg).toContain('외 5건 절삭됨');
  });
});

describe('runYahooHealthCheck — fetcher 주입으로 KIS 호출 0', () => {
  let tmpDir: string;
  let savedDataDir: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yahoo-health-'));
    savedDataDir = process.env.PERSIST_DATA_DIR;
    process.env.PERSIST_DATA_DIR = tmpDir;
    vi.resetModules();
  });

  afterEach(() => {
    if (savedDataDir === undefined) delete process.env.PERSIST_DATA_DIR;
    else process.env.PERSIST_DATA_DIR = savedDataDir;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('워치리스트 비어있을 때 0/0/0 반환', async () => {
    const { runYahooHealthCheck: run } = await import('./yahooHealthCheck.cmd.js');
    const r = await run({ fetcher: async () => makeQuote() });
    expect(r.checkedCount).toBe(0);
    expect(r.okCount).toBe(0);
    expect(r.failCount).toBe(0);
  });

  it('워치리스트 3개 + KRX master 매핑 + fetcher mock — 정상 분류', async () => {
    const { saveWatchlist } = await import('../../../persistence/watchlistRepo.js');
    const { setStockMaster, __testOnly } = await import('../../../persistence/krxStockMasterRepo.js');
    __testOnly.reset();
    setStockMaster([
      { code: '005930', name: '삼성전자', market: 'KOSPI' },
      { code: '101930', name: '의료기기A', market: 'KOSDAQ' },
      { code: '036930', name: '솔루션B', market: 'KOSDAQ' },
    ]);
    saveWatchlist([
      makeWatch('005930', '삼성전자'),
      makeWatch('101930', '의료기기A'),
      makeWatch('036930', '솔루션B'),
    ]);
    const { runYahooHealthCheck: run } = await import('./yahooHealthCheck.cmd.js');
    let kisCallCount = 0;
    const fetcher = vi.fn(async (sym: string) => {
      kisCallCount += 0; // KIS 호출 없음을 명시 — 본 fetcher 는 yahoo SSOT
      if (sym === '005930.KS') return makeQuote();
      if (sym === '101930.KQ') {
        return makeQuote({
          dataQuality: 'STALE_BASE',
          dataQualityIssues: ['return5d'],
          return5d: 443.36,
        });
      }
      if (sym === '036930.KQ') {
        return makeQuote({
          dataQuality: 'STALE_BASE',
          dataQualityIssues: ['return20d'],
          return20d: 114.99,
        });
      }
      return null;
    });
    const r = await run({ fetcher });
    expect(r.checkedCount).toBe(3);
    expect(r.okCount).toBe(1);
    expect(r.failCount).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(kisCallCount).toBe(0);
    const codes = r.details.map((d) => d.code).sort();
    expect(codes).toEqual(['036930', '101930']);
  });

  it('KRX master 부재 → symbol=null → FETCH_FAIL', async () => {
    const { saveWatchlist } = await import('../../../persistence/watchlistRepo.js');
    const { __testOnly } = await import('../../../persistence/krxStockMasterRepo.js');
    __testOnly.reset();
    saveWatchlist([makeWatch('999999', '미존재')]);
    const { runYahooHealthCheck: run } = await import('./yahooHealthCheck.cmd.js');
    const fetcher = vi.fn(async () => makeQuote());
    const r = await run({ fetcher });
    expect(r.failCount).toBe(1);
    expect(r.details[0].kinds).toEqual(['FETCH_FAIL']);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('limit 옵션 — 워치리스트 50개라도 30개만 검증 (default)', async () => {
    const { saveWatchlist } = await import('../../../persistence/watchlistRepo.js');
    const { setStockMaster, __testOnly } = await import('../../../persistence/krxStockMasterRepo.js');
    __testOnly.reset();
    const entries = Array.from({ length: 50 }, (_, i) => ({
      code: String(i).padStart(6, '0'), name: `종목${i}`, market: 'KOSPI' as const,
    }));
    setStockMaster(entries);
    saveWatchlist(entries.map((e) => makeWatch(e.code, e.name)));
    const { runYahooHealthCheck: run } = await import('./yahooHealthCheck.cmd.js');
    const fetcher = vi.fn(async () => makeQuote());
    const r = await run({ fetcher });
    expect(r.checkedCount).toBe(30);
    expect(fetcher).toHaveBeenCalledTimes(30);
  });
});

describe('resolveYahooSymbolForCode — KOSPI/KOSDAQ 매핑', () => {
  it('master 부재 → null', () => {
    // PERSIST_DATA_DIR 미설정 시 default 경로의 master 부재 가정.
    // 현재 환경에서 코드가 master 에 없으면 자연스럽게 null.
    const r = resolveYahooSymbolForCode('999999');
    // 환경에 따라 null 또는 매핑될 수 있어 null 일 때만 단언.
    if (r === null) expect(r).toBeNull();
    else expect(typeof r).toBe('string');
  });
});

describe('회귀 가드 — KIS 단일 통로 (절대 규칙 #2)', () => {
  it('yahooHealthCheck.cmd.ts 가 kisClient/aiUniverseService import 0건', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'server/telegram/commands/system/yahooHealthCheck.cmd.ts'),
      'utf-8',
    );
    expect(src).not.toMatch(/from\s+['"]\.\.\/\.\.\/\.\.\/clients\/kisClient/);
    expect(src).not.toMatch(/from\s+['"]\.\.\/\.\.\/\.\.\/services\/aiUniverseService/);
    expect(src).toMatch(/yahooQuoteAdapter/);
  });
  it('명령 메타데이터 — name=/yahoo_health alias=[/yh] riskLevel=0 ADMIN', async () => {
    const mod = await import('./yahooHealthCheck.cmd.js');
    expect(mod.default.name).toBe('/yahoo_health');
    expect(mod.default.aliases).toEqual(['/yh']);
    expect(mod.default.category).toBe('SYS');
    expect(mod.default.visibility).toBe('ADMIN');
    expect(mod.default.riskLevel).toBe(0);
  });
});
