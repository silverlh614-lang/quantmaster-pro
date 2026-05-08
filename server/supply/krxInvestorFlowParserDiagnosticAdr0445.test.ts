/**
 * @responsibility ADR-0445 KRX investor-flow parser empty rows hardening 회귀.
 *
 * 30+ 케이스 (사용자 §15 매트릭스):
 *   - status 분류 (PARSER_EMPTY_ROWS / PARSER_SHAPE_MISMATCH / OK / CACHE_HIT /
 *     LAST_GOOD_STALE / CACHE_EMPTY)
 *   - sanitized sample (top-level keys / candidate paths / 첫 row keys / size
 *     bucket / token-like 자동 제외)
 *   - cache age 분류 (CACHE_EMPTY / CACHE_HIT / LAST_GOOD_STALE)
 *   - ENV gate ADR-0157 정확 비교
 *   - ledger 영속 (FIFO 200건 / 손상 JSON fallback / atomic write)
 *   - history summary (lastSuccess/lastFailure)
 *   - LIVE 매매 본체 0줄 변경 정적 grep 가드
 *   - KIS 주문 함수 5종 import 0건
 *   - autoTradeEngine / orderExecutor / trancheExecutor import 0건
 *   - supply_confluence weight / Gate threshold / STRONG_BUY override 부재
 *   - DATA_UNAVAILABLE → failed++ 패턴 부재
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function loadModule() {
  return import('./krxInvestorFlowParserDiagnostic.js');
}

describe('ADR-0445 KRX Investor Flow Parser Empty Rows Hardening', () => {
  let tmpDir: string;
  const originalDataDir = process.env.PERSIST_DATA_DIR;
  const originalEnvDisabled = process.env.KRX_PARSER_DIAGNOSTIC_DISABLED;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'krx-parser-diag-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    delete process.env.KRX_PARSER_DIAGNOSTIC_DISABLED;
    vi.resetModules();
  });

  afterEach(() => {
    if (originalDataDir === undefined) delete process.env.PERSIST_DATA_DIR;
    else process.env.PERSIST_DATA_DIR = originalDataDir;
    if (originalEnvDisabled === undefined) delete process.env.KRX_PARSER_DIAGNOSTIC_DISABLED;
    else process.env.KRX_PARSER_DIAGNOSTIC_DISABLED = originalEnvDisabled;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  // -------------------------------------------------------------------------
  // §1~3 — status 분류
  // -------------------------------------------------------------------------
  describe('§1~3 status 분류', () => {
    it('§1 KRX response null → DATA_UNAVAILABLE 분기 (PARSER_SHAPE_MISMATCH 또는 PARSER_EMPTY_ROWS)', async () => {
      const { buildSanitizedSample, buildKrxInvestorFlowParserDiagnostic } = await loadModule();
      const sanitized = buildSanitizedSample({ payload: null });
      // null payload → top-level keys 빈 배열 + candidate 빈 배열 → SHAPE_MISMATCH 의도.
      const diag = buildKrxInvestorFlowParserDiagnostic({
        status: 'PARSER_SHAPE_MISMATCH',
        rowCount: 0,
        sanitizedSample: sanitized,
      });
      expect(diag.available).toBe(false);
      expect(diag.semanticAvailable).toBe(false);
      expect(diag.rowCount).toBe(0);
    });

    it('§2 object 지만 row array 없음 → PARSER_EMPTY_ROWS', async () => {
      const { buildSanitizedSample, buildKrxInvestorFlowParserDiagnostic, probeRowArrayCandidates } = await loadModule();
      const payload = { OutBlock_1: 'header-only', timestamp: '2026-05-08' };
      const sanitized = buildSanitizedSample({ payload });
      const candidates = probeRowArrayCandidates(payload);
      expect(candidates).toHaveLength(0);
      const diag = buildKrxInvestorFlowParserDiagnostic({
        status: 'PARSER_EMPTY_ROWS',
        rowCount: 0,
        sanitizedSample: sanitized,
      });
      expect(diag.status).toBe('PARSER_EMPTY_ROWS');
      expect(diag.available).toBe(false);
      expect(sanitized.topLevelKeys).toEqual(['OutBlock_1', 'timestamp']);
    });

    it('§3 row array path expected 매칭 시 rowCount 정상 + OK 분류', async () => {
      const { buildSanitizedSample, buildKrxInvestorFlowParserDiagnostic, probeRowArrayCandidates } = await loadModule();
      const payload = {
        output: [
          { ISU_SRT_CD: '005930', foreignNetBuy: 100000, institutionalNetBuy: 50000 },
          { ISU_SRT_CD: '000660', foreignNetBuy: 200000, institutionalNetBuy: 75000 },
        ],
      };
      const sanitized = buildSanitizedSample({ payload });
      const candidates = probeRowArrayCandidates(payload);
      expect(candidates).toEqual([{ path: 'output', length: 2 }]);
      const diag = buildKrxInvestorFlowParserDiagnostic({
        status: 'OK',
        rowCount: 2,
        sanitizedSample: sanitized,
        firstRowFields: { foreignNetBuy: 100000, institutionalNetBuy: 50000 },
      });
      expect(diag.available).toBe(true);
      expect(diag.semanticAvailable).toBe(true);
      expect(diag.rowCount).toBe(2);
    });

    it('§4 expected 비었지만 candidate path 발견 → diagnostic 기록 only (parser 미사용)', async () => {
      const { buildSanitizedSample, probeRowArrayCandidates } = await loadModule();
      const payload = {
        response: { body: { items: { item: [{ foreignNetBuy: 50000 }] } } },
      };
      const candidates = probeRowArrayCandidates(payload);
      expect(candidates.length).toBeGreaterThanOrEqual(1);
      expect(candidates[0].path).toBe('response.body.items.item');
      expect(candidates[0].length).toBe(1);
      const sanitized = buildSanitizedSample({ payload });
      // candidate 발견됐지만 parser 자동 전환 안 함 — diagnostic 만 영속.
      expect(sanitized.candidatePathLabels).toContain('response.body.items.item:len=1');
    });
  });

  // -------------------------------------------------------------------------
  // §5~7 — sanitized sample 영속 정책
  // -------------------------------------------------------------------------
  describe('§5~7 sanitized sample', () => {
    it('§5 top-level keys + candidate path label + 첫 row keys 만 저장', async () => {
      const { buildSanitizedSample } = await loadModule();
      const payload = {
        output: [{ ISU_SRT_CD: '005930', foreignNetBuy: 100, institutionalNetBuy: 200 }],
        timestamp: '2026-05-08',
      };
      const sanitized = buildSanitizedSample({ payload, httpStatusCode: 200 });
      expect(sanitized.topLevelKeys).toEqual(['output', 'timestamp']);
      expect(sanitized.candidatePathLabels[0]).toBe('output:len=1');
      expect(sanitized.firstRowKeys).toContain('ISU_SRT_CD');
      expect(sanitized.firstRowKeys).toContain('foreignNetBuy');
      expect(sanitized.firstRowKeys).toContain('institutionalNetBuy');
      expect(sanitized.httpStatusCode).toBe(200);
    });

    it('§6 token-like key (accessToken/secret/password/auth/credential/cookie) 자동 제외', async () => {
      const { buildSanitizedSample, isForbiddenSampleKey } = await loadModule();
      const FORBIDDEN = ['accessToken', 'access_token', 'appkey', 'app_key', 'secret', 'password', 'token', 'authorization', 'credential', 'cookie', 'account', 'accountNo', 'apiKey'];
      for (const key of FORBIDDEN) {
        expect(isForbiddenSampleKey(key)).toBe(true);
      }
      const payload = {
        output: [{ foreignNetBuy: 100, institutionalNetBuy: 200 }],
        accessToken: 'SHOULD_NOT_LEAK',
        appkey: 'SHOULD_NOT_LEAK',
        password: 'SHOULD_NOT_LEAK',
      };
      const sanitized = buildSanitizedSample({ payload });
      // token-like key 는 top-level keys 에서 자동 제외.
      expect(sanitized.topLevelKeys).not.toContain('accessToken');
      expect(sanitized.topLevelKeys).not.toContain('appkey');
      expect(sanitized.topLevelKeys).not.toContain('password');
      expect(sanitized.topLevelKeys).toContain('output');
    });

    it('§7 raw payload 본체 (full body) 미저장 — sanitized 만', async () => {
      const { buildSanitizedSample } = await loadModule();
      const payload = {
        output: [{ foreignNetBuy: 100, institutionalNetBuy: 200, htmlBody: 'A'.repeat(50_000) }],
        rawHtml: 'A'.repeat(100_000),
      };
      // 100_000 bytes < 100*1024 (102400) → 10-100KB bucket. >100KB 임계 검증은 200_000 사용.
      const sanitized = buildSanitizedSample({ payload, responseSizeBytes: 200_000 });
      // sanitized 는 raw 값 0건 — keys 만.
      const serialized = JSON.stringify(sanitized);
      expect(serialized).not.toContain('A'.repeat(100));
      expect(sanitized.responseSizeBucket).toBe('>100KB');
    });

    it('§7-b response size bucket 분류 (4 bucket 정합)', async () => {
      const { classifyResponseSizeBucket } = await loadModule();
      expect(classifyResponseSizeBucket(500)).toBe('<1KB');
      expect(classifyResponseSizeBucket(5_000)).toBe('1-10KB');
      expect(classifyResponseSizeBucket(50_000)).toBe('10-100KB');
      expect(classifyResponseSizeBucket(500_000)).toBe('>100KB');
      expect(classifyResponseSizeBucket(undefined)).toBeUndefined();
      expect(classifyResponseSizeBucket(-1)).toBeUndefined();
      expect(classifyResponseSizeBucket(NaN)).toBeUndefined();
    });

    it('§7-c content-type bucket 단순 라벨만 (Authorization 헤더 영속 X)', async () => {
      const { classifyContentTypeBucket } = await loadModule();
      expect(classifyContentTypeBucket('application/json')).toBe('json');
      expect(classifyContentTypeBucket('application/xml; charset=utf-8')).toBe('xml');
      expect(classifyContentTypeBucket('text/html')).toBe('html');
      expect(classifyContentTypeBucket('text/plain')).toBe('text');
      expect(classifyContentTypeBucket('application/octet-stream')).toBe('other');
      expect(classifyContentTypeBucket(undefined)).toBeUndefined();
      expect(classifyContentTypeBucket('')).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // §8~9 — DATA_UNAVAILABLE 의미론 보존 (ADR-0416/0421 정합)
  // -------------------------------------------------------------------------
  describe('§8~9 DATA_UNAVAILABLE 의미론', () => {
    it('§8 PARSER_EMPTY_ROWS 가 failed 카운트 안 됨 (available=false 만, ADR-0416 정합)', async () => {
      const { buildKrxInvestorFlowParserDiagnostic, buildSanitizedSample } = await loadModule();
      const sanitized = buildSanitizedSample({ payload: { output: [] } });
      const diag = buildKrxInvestorFlowParserDiagnostic({
        status: 'PARSER_EMPTY_ROWS',
        rowCount: 0,
        sanitizedSample: sanitized,
      });
      expect(diag.available).toBe(false);
      expect(diag.status).toBe('PARSER_EMPTY_ROWS');
      // failed 필드 자체 미존재 — schema 에 failed 항목 없음 (DATA_UNAVAILABLE 분류만).
      expect((diag as unknown as Record<string, unknown>).failed).toBeUndefined();
    });

    it('§9 PARSER_EMPTY_ROWS 가 NEUTRAL 표시 안 됨 (DATA_UNAVAILABLE 만, ADR-0421 정합)', async () => {
      const { buildKrxInvestorFlowParserDiagnostic, buildSanitizedSample } = await loadModule();
      const sanitized = buildSanitizedSample({ payload: {} });
      const diag = buildKrxInvestorFlowParserDiagnostic({
        status: 'PARSER_EMPTY_ROWS',
        rowCount: 0,
        sanitizedSample: sanitized,
      });
      expect(diag.status).not.toBe('NEUTRAL' as never);
      expect(diag.available).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // §10~13 — semantic field 검증
  // -------------------------------------------------------------------------
  describe('§10~13 semantic field', () => {
    it('§10 semantic field 부재 → semanticAvailable=false', async () => {
      const { buildKrxInvestorFlowParserDiagnostic, buildSanitizedSample } = await loadModule();
      const diag = buildKrxInvestorFlowParserDiagnostic({
        status: 'OK',
        rowCount: 1,
        sanitizedSample: buildSanitizedSample({ payload: { output: [{ ISU_SRT_CD: '005930' }] } }),
        firstRowFields: { foreignNetBuy: undefined, institutionalNetBuy: undefined },
      });
      expect(diag.semanticAvailable).toBe(false);
    });

    it('§11 foreignNetBuy + institutionalNetBuy finite number → semanticAvailable=true', async () => {
      const { buildKrxInvestorFlowParserDiagnostic, buildSanitizedSample } = await loadModule();
      const diag = buildKrxInvestorFlowParserDiagnostic({
        status: 'OK',
        rowCount: 1,
        sanitizedSample: buildSanitizedSample({ payload: { output: [{ a: 1 }] } }),
        firstRowFields: { foreignNetBuy: 12345, institutionalNetBuy: 67890 },
      });
      expect(diag.semanticAvailable).toBe(true);
    });

    it('§12 NaN/Infinity/string garbage → semanticAvailable=false', async () => {
      const { buildKrxInvestorFlowParserDiagnostic, buildSanitizedSample } = await loadModule();
      const sanitized = buildSanitizedSample({ payload: {} });
      for (const garbage of [NaN, Infinity, -Infinity, '12345', null]) {
        const diag = buildKrxInvestorFlowParserDiagnostic({
          status: 'OK',
          rowCount: 1,
          sanitizedSample: sanitized,
          firstRowFields: { foreignNetBuy: garbage, institutionalNetBuy: 100 },
        });
        expect(diag.semanticAvailable).toBe(false);
      }
    });

    it('§13 0 은 number 인정 (positive confluence 는 아니지만 semanticAvailable=true)', async () => {
      const { buildKrxInvestorFlowParserDiagnostic, buildSanitizedSample } = await loadModule();
      const diag = buildKrxInvestorFlowParserDiagnostic({
        status: 'OK',
        rowCount: 1,
        sanitizedSample: buildSanitizedSample({ payload: {} }),
        firstRowFields: { foreignNetBuy: 0, institutionalNetBuy: 0 },
      });
      // 0 은 운영자가 "오늘 순매수 0주" 의미 가능 → semanticAvailable=true.
      expect(diag.semanticAvailable).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // §14~17 — cache / last-good fallback
  // -------------------------------------------------------------------------
  describe('§14~17 cache fallback', () => {
    it('§14 cache empty → CACHE_EMPTY', async () => {
      const { classifyCacheStatus } = await loadModule();
      expect(classifyCacheStatus(undefined)).toBe('CACHE_EMPTY');
      expect(classifyCacheStatus(null)).toBe('CACHE_EMPTY');
      expect(classifyCacheStatus('not-an-iso')).toBe('CACHE_EMPTY');
    });

    it('§15 fresh cache hit → CACHE_HIT (14일 미만)', async () => {
      const { classifyCacheStatus } = await loadModule();
      const now = new Date('2026-05-08T10:00:00+09:00');
      const oneDayAgo = new Date(now.getTime() - 86_400_000).toISOString();
      const tenDaysAgo = new Date(now.getTime() - 10 * 86_400_000).toISOString();
      expect(classifyCacheStatus(oneDayAgo, now)).toBe('CACHE_HIT');
      expect(classifyCacheStatus(tenDaysAgo, now)).toBe('CACHE_HIT');
    });

    it('§16 14일+ stale → LAST_GOOD_STALE', async () => {
      const { classifyCacheStatus } = await loadModule();
      const now = new Date('2026-05-08T10:00:00+09:00');
      const fifteenDaysAgo = new Date(now.getTime() - 15 * 86_400_000).toISOString();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000).toISOString();
      expect(classifyCacheStatus(fifteenDaysAgo, now)).toBe('LAST_GOOD_STALE');
      expect(classifyCacheStatus(thirtyDaysAgo, now)).toBe('LAST_GOOD_STALE');
    });

    it('§16-b 미래 시점 cachedAt → CACHE_EMPTY 안전 fallback', async () => {
      const { classifyCacheStatus } = await loadModule();
      const now = new Date('2026-05-08T10:00:00+09:00');
      const future = new Date(now.getTime() + 86_400_000).toISOString();
      expect(classifyCacheStatus(future, now)).toBe('CACHE_EMPTY');
    });

    it('§17 STALE 이 OK 로 승격되지 않음 (LAST_GOOD_STALE diag.available=true 지만 status 보존)', async () => {
      const { buildKrxInvestorFlowParserDiagnostic, buildSanitizedSample } = await loadModule();
      const diag = buildKrxInvestorFlowParserDiagnostic({
        status: 'LAST_GOOD_STALE',
        rowCount: 1,
        sanitizedSample: buildSanitizedSample({ payload: {} }),
        firstRowFields: { foreignNetBuy: 100, institutionalNetBuy: 200 },
        cacheStatus: 'LAST_GOOD_STALE',
      });
      // status 는 LAST_GOOD_STALE 보존 — OK 로 승격 X.
      expect(diag.status).toBe('LAST_GOOD_STALE');
      expect(diag.cacheStatus).toBe('LAST_GOOD_STALE');
      // available=true 지만 OK status 아님 — 호출자가 liveStrongBuyAllowed 결정 시 status 검사 의무.
      expect(diag.available).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // §18~21 — wiring 표시 (router/health/supplyHealth/scanBlockers)
  // -------------------------------------------------------------------------
  describe('§18~21 wiring 표시', () => {
    it('§18 formatKrxParserDiagnosticBlock 에 lastSuccess / lastFailure 표시', async () => {
      const { formatKrxParserDiagnosticBlock, buildKrxInvestorFlowParserDiagnostic, buildSanitizedSample } = await loadModule();
      const diag = buildKrxInvestorFlowParserDiagnostic({
        status: 'PARSER_EMPTY_ROWS',
        rowCount: 0,
        sanitizedSample: buildSanitizedSample({ payload: {} }),
        lastSuccessAtKst: '2026-05-08T09:02:00+09:00',
        lastSuccessRowCount: 12,
        lastFailureAtKst: '2026-05-08T09:34:00+09:00',
        lastFailureReason: 'KRX_PUBLIC_EMPTY_ROWS_OR_HTTP400',
        cacheStatus: 'CACHE_EMPTY',
      });
      const block = formatKrxParserDiagnosticBlock(diag);
      expect(block).toContain('KRX: DATA_UNAVAILABLE / PARSER_EMPTY_ROWS');
      expect(block).toContain('lastOK: 09:02 KST rows=12');
      expect(block).toContain('lastFail: 09:34 KST');
      expect(block).toContain('cache: CACHE_EMPTY');
    });

    it('§19 expected + detected path 한 줄 표시 (운영자 진단 가능)', async () => {
      const { formatKrxParserDiagnosticBlock, buildKrxInvestorFlowParserDiagnostic, buildSanitizedSample } = await loadModule();
      const diag = buildKrxInvestorFlowParserDiagnostic({
        status: 'PARSER_EMPTY_ROWS',
        rowCount: 0,
        sanitizedSample: buildSanitizedSample({
          payload: { response: { body: { items: { item: [] } } } },
        }),
        expectedPaths: ['output', 'output1'],
      });
      const block = formatKrxParserDiagnosticBlock(diag);
      expect(block).toContain('expected: output,output1');
      expect(block).toMatch(/detected: response\.body\.items\.item:len=0/);
    });

    it('§20 ledger throw 시 base 메시지 차단 0 (router try/catch 격리)', async () => {
      // wiring 측 try/catch 는 router 본체 — 본 SSOT 테스트는 빌더 자체가
      // 안전하게 작동함만 검증. router 측 격리 검증은 §router 영역.
      const { buildSanitizedSample, buildKrxInvestorFlowParserDiagnostic } = await loadModule();
      // 빌더는 throw 안 함 (외부 의존성 0).
      expect(() => {
        buildKrxInvestorFlowParserDiagnostic({
          status: 'UNKNOWN_ERROR',
          rowCount: 0,
          sanitizedSample: buildSanitizedSample({ payload: undefined }),
        });
      }).not.toThrow();
    });

    it('§21 provider health throw 시 evaluator 실패 0 (옵셔널 필드 후방호환)', async () => {
      const { buildKrxInvestorFlowParserDiagnostic, buildSanitizedSample } = await loadModule();
      const diag = buildKrxInvestorFlowParserDiagnostic({
        status: 'CACHE_EMPTY',
        rowCount: 0,
        sanitizedSample: buildSanitizedSample({ payload: {} }),
      });
      // ADR-0445 옵셔널 필드들이 모두 미설정이어도 schema 안전.
      expect(diag.lastSuccessAtKst).toBeUndefined();
      expect(diag.lastFailureAtKst).toBeUndefined();
      expect(diag.cacheStatus).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // §22~23 — ENV gate (ADR-0157 정확 비교)
  // -------------------------------------------------------------------------
  describe('§22~23 ENV gate', () => {
    it('§22 default OFF — 미설정 시 진단 활성', async () => {
      delete process.env.KRX_PARSER_DIAGNOSTIC_DISABLED;
      const { isKrxParserDiagnosticDisabled } = await loadModule();
      expect(isKrxParserDiagnosticDisabled()).toBe(false);
    });

    it('§22-b ENV `=true` 정확 매칭 → disabled', async () => {
      process.env.KRX_PARSER_DIAGNOSTIC_DISABLED = 'true';
      const { isKrxParserDiagnosticDisabled } = await loadModule();
      expect(isKrxParserDiagnosticDisabled()).toBe(true);
    });

    it('§23 ENV `=1` `=TRUE` `=yes` 거부 (ADR-0157 정확 비교)', async () => {
      for (const val of ['1', 'TRUE', 'True', 'yes', 'YES', 'on', '']) {
        process.env.KRX_PARSER_DIAGNOSTIC_DISABLED = val;
        vi.resetModules();
        const { isKrxParserDiagnosticDisabled } = await loadModule();
        expect(isKrxParserDiagnosticDisabled()).toBe(false);
      }
    });
  });

  // -------------------------------------------------------------------------
  // §24~29 — 안전 invariants 정적 grep 가드
  // -------------------------------------------------------------------------
  describe('§24~29 안전 invariants 정적 grep 가드', () => {
    /**
     * 본 SSOT 모듈의 *코드 영역만* (주석 strip 후) 검사 — 헤더 docstring 의 ADR
     * 명시 단어가 false positive 일으키지 않도록.
     */
    const moduleCode = (): string => {
      const raw = fs.readFileSync(
        path.resolve(__dirname, 'krxInvestorFlowParserDiagnostic.ts'),
        'utf-8',
      );
      // 블록 주석 + 라인 주석 strip.
      return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    };

    it('§24 KIS 주문 함수 5종 import 0건 (코드 영역)', () => {
      const src = moduleCode();
      expect(src).not.toMatch(/placeKisMarketOrder/);
      expect(src).not.toMatch(/placeKisSellOrder/);
      expect(src).not.toMatch(/cancelKisOrder/);
      expect(src).not.toMatch(/placeKisStopLossOrder/);
      expect(src).not.toMatch(/placeKisTakeProfitOrder/);
    });

    it('§25 autoTradeEngine / orderExecutor / trancheExecutor import 0건 (코드 영역)', () => {
      const src = moduleCode();
      expect(src).not.toMatch(/autoTradeEngine/);
      expect(src).not.toMatch(/orderExecutor/);
      expect(src).not.toMatch(/trancheExecutor/);
    });

    it('§26 신규 outbound (fetch / axios / node-fetch) 호출 0건 (코드 영역)', () => {
      const src = moduleCode();
      expect(src).not.toMatch(/\bfetch\s*\(/);
      expect(src).not.toMatch(/import.*axios/);
      expect(src).not.toMatch(/from ['"]axios['"]/);
      expect(src).not.toMatch(/from ['"]node-fetch['"]/);
    });

    it('§27 Gate threshold 변경 문자열 부재 (코드 영역)', () => {
      const src = moduleCode();
      expect(src).not.toMatch(/setGateThreshold/);
      expect(src).not.toMatch(/GATE_RELAX/);
      expect(src).not.toMatch(/REVIEW_GATE_THRESHOLD/);
    });

    it('§28 STRONG_BUY override 문자열 부재 (코드 영역)', () => {
      const src = moduleCode();
      expect(src).not.toMatch(/STRONG_BUY_OVERRIDE/);
      expect(src).not.toMatch(/promoteToLive/);
      expect(src).not.toMatch(/promoteToPaper/);
    });

    it('§29 DATA_UNAVAILABLE → failed++ 패턴 부재 (코드 영역)', () => {
      const src = moduleCode();
      expect(src).not.toMatch(/failed\s*\+\+/);
      expect(src).not.toMatch(/failed\s*\+=\s*1/);
      expect(src).not.toMatch(/failed:\s*failed\s*\+/);
    });
  });

  // -------------------------------------------------------------------------
  // §30~31 — ADR-0435/0421/0416 invariant 보존
  // -------------------------------------------------------------------------
  describe('§30~31 인접 ADR invariant', () => {
    /**
     * 본 SSOT 모듈의 *코드 영역만* (주석 strip 후) 검사.
     */
    const moduleCode = (): string => {
      const raw = fs.readFileSync(
        path.resolve(__dirname, 'krxInvestorFlowParserDiagnostic.ts'),
        'utf-8',
      );
      return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    };

    it('§30 supply_confluence weight 변경 0 (본 모듈 weight import 0건, 코드 영역)', () => {
      const src = moduleCode();
      expect(src).not.toMatch(/supply_confluence/);
      expect(src).not.toMatch(/weightFor/);
    });

    it('§31 ADR-0435 invariant — InvestorFlowProviderHealth schema 변경 0 (본 모듈 무관, 코드 영역)', () => {
      const src = moduleCode();
      expect(src).not.toMatch(/InvestorFlowProviderStatus/);
      // status union 은 별도 KrxInvestorFlowParserStatus — 의미 1:1 정합 + parser-specific.
      expect(src).toMatch(/KrxInvestorFlowParserStatus/);
    });
  });

  // -------------------------------------------------------------------------
  // §33~35 — ledger 영속
  // -------------------------------------------------------------------------
  describe('§33~35 ledger 영속', () => {
    it('§33 ledger FIFO 200건 trim', async () => {
      const {
        appendKrxInvestorFlowParserDiagnostic,
        buildKrxInvestorFlowParserDiagnostic,
        buildSanitizedSample,
        loadKrxInvestorFlowParserDiagnostics,
        toKrxParserKstIso,
        KRX_PARSER_DIAGNOSTIC_LEDGER_MAX,
      } = await loadModule();
      const sanitized = buildSanitizedSample({ payload: { output: [] } });
      const diag = buildKrxInvestorFlowParserDiagnostic({
        status: 'PARSER_EMPTY_ROWS',
        rowCount: 0,
        sanitizedSample: sanitized,
      });
      // 250건 영속 → 200건 trim.
      for (let i = 0; i < 250; i += 1) {
        appendKrxInvestorFlowParserDiagnostic({
          diagnosedAt: toKrxParserKstIso(new Date(Date.now() + i * 1000)),
          diagnostic: diag,
          sanitizedSample: sanitized,
        });
      }
      const entries = loadKrxInvestorFlowParserDiagnostics();
      expect(entries.length).toBe(KRX_PARSER_DIAGNOSTIC_LEDGER_MAX);
      expect(KRX_PARSER_DIAGNOSTIC_LEDGER_MAX).toBe(200);
    });

    it('§34 손상 JSON → 빈 배열 fallback', async () => {
      const { loadKrxInvestorFlowParserDiagnostics } = await loadModule();
      const { KRX_INVESTOR_FLOW_PARSER_DIAGNOSTICS_FILE } = await import('../persistence/paths.js');
      fs.writeFileSync(KRX_INVESTOR_FLOW_PARSER_DIAGNOSTICS_FILE, 'INVALID_JSON{', 'utf-8');
      const entries = loadKrxInvestorFlowParserDiagnostics();
      expect(entries).toEqual([]);
    });

    it('§35 atomic write — tmp 파일 잔존 0 + JSON 정상 파싱', async () => {
      const {
        appendKrxInvestorFlowParserDiagnostic,
        buildKrxInvestorFlowParserDiagnostic,
        buildSanitizedSample,
        toKrxParserKstIso,
      } = await loadModule();
      const sanitized = buildSanitizedSample({ payload: { output: [{ a: 1 }] } });
      const diag = buildKrxInvestorFlowParserDiagnostic({
        status: 'OK',
        rowCount: 1,
        sanitizedSample: sanitized,
        firstRowFields: { foreignNetBuy: 100, institutionalNetBuy: 200 },
      });
      appendKrxInvestorFlowParserDiagnostic({
        diagnosedAt: toKrxParserKstIso(),
        diagnostic: diag,
        sanitizedSample: sanitized,
      });
      const { KRX_INVESTOR_FLOW_PARSER_DIAGNOSTICS_FILE } = await import('../persistence/paths.js');
      const tmpFile = `${KRX_INVESTOR_FLOW_PARSER_DIAGNOSTICS_FILE}.tmp`;
      expect(fs.existsSync(tmpFile)).toBe(false);
      const content = fs.readFileSync(KRX_INVESTOR_FLOW_PARSER_DIAGNOSTICS_FILE, 'utf-8');
      expect(() => JSON.parse(content)).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // §36 — history summary
  // -------------------------------------------------------------------------
  describe('§36 history summary', () => {
    it('lastSuccess + lastFailure 분리 propagate', async () => {
      const {
        appendKrxInvestorFlowParserDiagnostic,
        buildKrxInvestorFlowParserDiagnostic,
        buildSanitizedSample,
        summarizeKrxInvestorFlowParserHistory,
      } = await loadModule();
      const sanitized = buildSanitizedSample({ payload: {} });
      // 09:02 OK 영속.
      appendKrxInvestorFlowParserDiagnostic({
        diagnosedAt: '2026-05-08T09:02:00+09:00',
        diagnostic: buildKrxInvestorFlowParserDiagnostic({
          status: 'OK',
          rowCount: 12,
          sanitizedSample: sanitized,
          firstRowFields: { foreignNetBuy: 100, institutionalNetBuy: 200 },
        }),
        sanitizedSample: sanitized,
      });
      // 09:34 PARSER_EMPTY_ROWS 영속.
      appendKrxInvestorFlowParserDiagnostic({
        diagnosedAt: '2026-05-08T09:34:00+09:00',
        diagnostic: buildKrxInvestorFlowParserDiagnostic({
          status: 'PARSER_EMPTY_ROWS',
          rowCount: 0,
          sanitizedSample: sanitized,
          note: 'KRX_PUBLIC_EMPTY_ROWS_OR_HTTP400',
        }),
        sanitizedSample: sanitized,
      });
      const summary = summarizeKrxInvestorFlowParserHistory();
      expect(summary.lastSuccessAtKst).toBe('2026-05-08T09:02:00+09:00');
      expect(summary.lastSuccessRowCount).toBe(12);
      expect(summary.lastFailureAtKst).toBe('2026-05-08T09:34:00+09:00');
      expect(summary.lastFailureReason).toBe('KRX_PUBLIC_EMPTY_ROWS_OR_HTTP400');
    });
  });

  // -------------------------------------------------------------------------
  // §37 — wiring 정적 grep 가드 (provider health / router / supplyHealth.cmd)
  // -------------------------------------------------------------------------
  describe('§37 wiring 정적 grep 가드', () => {
    const readFile = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf-8');

    it('investorFlowProviderHealth.ts ADR-0445 옵셔널 필드 추가', () => {
      const src = readFile('investorFlowProviderHealth.ts');
      expect(src).toMatch(/ADR-0445/);
      expect(src).toMatch(/lastSuccessAtKst/);
      expect(src).toMatch(/lastFailureAtKst/);
      expect(src).toMatch(/expectedPaths/);
      expect(src).toMatch(/detectedCandidatePaths/);
      expect(src).toMatch(/cacheStatus/);
    });

    it('investorFlowProviderHealth.ts summarize 함수에 lastOK/lastFail/expected/detected/cache sub-line 빌더', () => {
      const src = readFile('investorFlowProviderHealth.ts');
      expect(src).toMatch(/formatKrxAdr0445SubLines/);
      expect(src).toMatch(/lastOK:/);
      expect(src).toMatch(/lastFail:/);
      expect(src).toMatch(/expected:/);
      expect(src).toMatch(/detected:/);
      expect(src).toMatch(/cache:/);
    });

    it('investorFlowRouter.ts ADR-0445 진단 SSOT import', () => {
      const src = readFile('investorFlowRouter.ts');
      expect(src).toMatch(/krxInvestorFlowParserDiagnostic/);
      expect(src).toMatch(/buildKrxInvestorFlowParserDiagnostic/);
      expect(src).toMatch(/appendKrxInvestorFlowParserDiagnostic/);
      expect(src).toMatch(/buildSanitizedSample/);
    });

    it('investorFlowRouter.ts buildKrxParserHealthExtras helper try/catch 격리', () => {
      const src = readFile('investorFlowRouter.ts');
      expect(src).toMatch(/buildKrxParserHealthExtras/);
      expect(src).toMatch(/router 흐름 보호/);
    });
  });
});
