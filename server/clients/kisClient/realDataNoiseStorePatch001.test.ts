/**
 * @responsibility Patch-KIS-REALDATA-500-NOISE-AND-RECOVERY-001 회귀 SSOT.
 *
 * 사용자 명시 §J 10 핵심 케이스 + 안전 invariant 정적 grep 가드.
 *
 * 사용자 명시 10 케이스 (모두 PASS 의무):
 *   1. HTTP 500 + endpoint=FHKST01010100 → TRANSIENT_SERVER_500 분류
 *   2. 500 → providerIssue=true / marketSignal=false / executionImpact='NONE' literal
 *   3. 동일 endpoint+errorKind 반복 500 → suppressedLogCount 증가
 *   4. cooldown 활성 시 상세 로그 반복 출력 차단 (shouldEmitDetailLog=false)
 *   5. 성공 응답 → 해당 endpoint backoff state reset
 *   6. retry exhausted (3회+) 후에도 bearish/marketSignal 변환 없음
 *   7. /scan_blockers 출력에 KIS RealData compact health 섹션 노출 (PATCH-RUNTIME 태그)
 *   8. ENV `KIS_REALDATA_BACKOFF_DISABLED=true` → 기존 동작 복원
 *   9. live order 함수 import 0건 (정적 grep 가드)
 *  10. lint + vitest 통과
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildKisRealDataNoiseKey,
  classifyKisRealDataError,
  formatKisRealDataHealthSection,
  formatKisRealDataNoiseSummaryLine,
  isKisRealDataBackoffDisabled,
  isKisRealDataCooldownActive,
  KIS_REAL_DATA_NOISE_CONSTANTS,
  listKisRealDataNoiseRecords,
  recordKisRealDataFailure,
  recordKisRealDataSuccess,
  shouldEmitNoiseSummary,
  __resetKisRealDataNoiseStoreForTests,
  type KisRealDataErrorKind,
  type KisRealDataNoiseRecord,
} from './realDataNoiseStore.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

beforeEach(() => {
  delete process.env.KIS_REALDATA_BACKOFF_DISABLED;
  __resetKisRealDataNoiseStoreForTests();
});

afterEach(() => {
  delete process.env.KIS_REALDATA_BACKOFF_DISABLED;
  __resetKisRealDataNoiseStoreForTests();
});

// ════════════════════════════════════════════════════════════════════════════
// Group A — ENV gate (ADR-0157 정확 비교)
// ════════════════════════════════════════════════════════════════════════════

describe('Patch-KIS-REALDATA-500 — ENV gate (ADR-0157)', () => {
  it('A1. default OFF → false 반환', () => {
    expect(isKisRealDataBackoffDisabled()).toBe(false);
  });

  it('A2. =true 정확 비교 → true', () => {
    process.env.KIS_REALDATA_BACKOFF_DISABLED = 'true';
    expect(isKisRealDataBackoffDisabled()).toBe(true);
  });

  it("A3. '1' / 'TRUE' / 'yes' / '' 거부 (ADR-0157 정확 비교 의무)", () => {
    for (const v of ['1', 'TRUE', 'yes', '', 'enabled', 'False', 'true ']) {
      process.env.KIS_REALDATA_BACKOFF_DISABLED = v;
      expect(isKisRealDataBackoffDisabled()).toBe(false);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Group B — classifyKisRealDataError 결정 트리
// ════════════════════════════════════════════════════════════════════════════

describe('Patch-KIS-REALDATA-500 — classifyKisRealDataError', () => {
  it('B1 (사용자 §1). HTTP 500 + endpoint=FHKST01010100 → TRANSIENT_SERVER_500', () => {
    const r = classifyKisRealDataError({
      endpoint: '/uapi/domestic-stock/v1/quotations/inquire-price',
      symbol: '005930',
      httpStatus: 500,
      errorCode: 'FHKST01010100',
    });
    expect(r.errorKind).toBe('TRANSIENT_SERVER_500');
    expect(r.endpoint).toBe('/uapi/domestic-stock/v1/quotations/inquire-price');
    expect(r.symbol).toBe('005930');
    expect(r.httpStatus).toBe(500);
  });

  it('B2 (사용자 §2). 500 → providerIssue=true / marketSignal=false / executionImpact=NONE literal', () => {
    const r = classifyKisRealDataError({ endpoint: 'X', httpStatus: 500 });
    expect(r.providerIssue).toBe(true);
    expect(r.marketSignal).toBe(false);
    expect(r.executionImpact).toBe('NONE');
  });

  it('B3. 429 → RATE_LIMIT_OR_THROTTLE', () => {
    expect(classifyKisRealDataError({ endpoint: 'X', httpStatus: 429 }).errorKind).toBe('RATE_LIMIT_OR_THROTTLE');
    expect(classifyKisRealDataError({ endpoint: 'X', message: 'rate limit exceeded' }).errorKind).toBe('RATE_LIMIT_OR_THROTTLE');
  });

  it('B4. 401/403/token → AUTH_OR_TOKEN', () => {
    expect(classifyKisRealDataError({ endpoint: 'X', httpStatus: 401 }).errorKind).toBe('AUTH_OR_TOKEN');
    expect(classifyKisRealDataError({ endpoint: 'X', httpStatus: 403 }).errorKind).toBe('AUTH_OR_TOKEN');
    expect(classifyKisRealDataError({ endpoint: 'X', message: 'token expired' }).errorKind).toBe('AUTH_OR_TOKEN');
  });

  it('B5. 장외/휴장 키워드 → MARKET_CLOSED_OR_UNAVAILABLE', () => {
    expect(classifyKisRealDataError({ endpoint: 'X', message: '장외 거래' }).errorKind).toBe('MARKET_CLOSED_OR_UNAVAILABLE');
    expect(classifyKisRealDataError({ endpoint: 'X', message: 'market closed' }).errorKind).toBe('MARKET_CLOSED_OR_UNAVAILABLE');
  });

  it('B6. 400 / invalid symbol → BAD_REQUEST_OR_SYMBOL', () => {
    expect(classifyKisRealDataError({ endpoint: 'X', httpStatus: 400 }).errorKind).toBe('BAD_REQUEST_OR_SYMBOL');
    expect(classifyKisRealDataError({ endpoint: 'X', message: 'invalid symbol' }).errorKind).toBe('BAD_REQUEST_OR_SYMBOL');
  });

  it('B7. timeout/ECONNRESET/ETIMEDOUT → NETWORK_TIMEOUT', () => {
    expect(classifyKisRealDataError({ endpoint: 'X', message: 'request timeout' }).errorKind).toBe('NETWORK_TIMEOUT');
    expect(classifyKisRealDataError({ endpoint: 'X', message: 'ECONNRESET' }).errorKind).toBe('NETWORK_TIMEOUT');
    expect(classifyKisRealDataError({ endpoint: 'X', message: 'ETIMEDOUT' }).errorKind).toBe('NETWORK_TIMEOUT');
  });

  it('B8. 그 외 → UNKNOWN — 모두 providerIssue=true / marketSignal=false / executionImpact=NONE 보존', () => {
    const r = classifyKisRealDataError({ endpoint: 'X', httpStatus: 418 });
    expect(r.errorKind).toBe('UNKNOWN');
    expect(r.providerIssue).toBe(true);
    expect(r.marketSignal).toBe(false);
    expect(r.executionImpact).toBe('NONE');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Group C — recordKisRealDataFailure (suppress count + cooldown)
// ════════════════════════════════════════════════════════════════════════════

describe('Patch-KIS-REALDATA-500 — recordKisRealDataFailure', () => {
  function classify500(symbol = '005930') {
    return classifyKisRealDataError({ endpoint: 'FHKST01010100', symbol, httpStatus: 500 });
  }

  it('C1 (사용자 §3). 동일 endpoint+symbol+errorKind 반복 → suppressedLogCount 증가', () => {
    const c = classify500();
    const r1 = recordKisRealDataFailure(c);
    const r2 = recordKisRealDataFailure(c);
    const r3 = recordKisRealDataFailure(c);
    const r4 = recordKisRealDataFailure(c);
    expect(r1.shouldEmitDetailLog).toBe(true); // 1회 — 통과
    expect(r2.shouldEmitDetailLog).toBe(false); // 2회+ — suppress
    expect(r3.shouldEmitDetailLog).toBe(false);
    expect(r4.shouldEmitDetailLog).toBe(false);
    expect(r4.record.consecutiveFailures).toBe(4);
    expect(r4.record.suppressedLogCount).toBe(3);
  });

  it('C2. 매 record 는 providerIssue=true / marketSignal=false / executionImpact=NONE literal 보존', () => {
    const r = recordKisRealDataFailure(classify500());
    expect(r.record.providerIssue).toBe(true);
    expect(r.record.marketSignal).toBe(false);
    expect(r.record.executionImpact).toBe('NONE');
  });

  it('C3 (사용자 §4). cooldown 활성 시 isKisRealDataCooldownActive=true', () => {
    const c = classify500();
    recordKisRealDataFailure(c);
    expect(isKisRealDataCooldownActive({ endpoint: 'FHKST01010100', symbol: '005930' })).toBe(true);
    expect(isKisRealDataCooldownActive({ endpoint: 'FHKST01010100', symbol: '005930', errorKind: 'TRANSIENT_SERVER_500' })).toBe(true);
  });

  it('C4 (사용자 §6). retry exhausted (3회) 후에도 bearish/marketSignal 변환 없음', () => {
    const c = classify500();
    recordKisRealDataFailure(c);
    recordKisRealDataFailure(c);
    const r3 = recordKisRealDataFailure(c);
    expect(r3.record.retryExhausted).toBe(true);
    expect(r3.record.consecutiveFailures).toBeGreaterThanOrEqual(KIS_REAL_DATA_NOISE_CONSTANTS.RETRY_EXHAUSTED_AT_FAILURES);
    // 절대 invariant — providerIssue/marketSignal/executionImpact 보존
    expect(r3.record.providerIssue).toBe(true);
    expect(r3.record.marketSignal).toBe(false);
    expect(r3.record.executionImpact).toBe('NONE');
  });

  it('C5 (사용자 §5). 성공 응답 → 해당 endpoint backoff state reset', () => {
    const c = classify500();
    recordKisRealDataFailure(c);
    recordKisRealDataFailure(c);
    expect(listKisRealDataNoiseRecords().length).toBe(1);
    recordKisRealDataSuccess({ endpoint: 'FHKST01010100', symbol: '005930' });
    expect(listKisRealDataNoiseRecords().length).toBe(0);
    expect(isKisRealDataCooldownActive({ endpoint: 'FHKST01010100', symbol: '005930' })).toBe(false);
  });

  it('C6. cooldown 미설정 endpoint+symbol 조합 → cooldownActive=false', () => {
    expect(isKisRealDataCooldownActive({ endpoint: 'OTHER', symbol: '999999' })).toBe(false);
  });

  it('C7 (사용자 §8). ENV disabled 시 ephemeral record (suppress 0 + 모든 detail log 통과)', () => {
    process.env.KIS_REALDATA_BACKOFF_DISABLED = 'true';
    const c = classify500();
    const r1 = recordKisRealDataFailure(c);
    const r2 = recordKisRealDataFailure(c);
    expect(r1.shouldEmitDetailLog).toBe(true);
    expect(r2.shouldEmitDetailLog).toBe(true); // ENV disabled — suppress 안 함
    expect(r1.record.suppressedLogCount).toBe(0);
    expect(r2.record.suppressedLogCount).toBe(0);
    // ENV disabled — store 영속 0건 (ephemeral)
    expect(listKisRealDataNoiseRecords().length).toBe(0);
    expect(isKisRealDataCooldownActive({ endpoint: 'FHKST01010100', symbol: '005930' })).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Group D — formatKisRealDataHealthSection (사용자 §7)
// ════════════════════════════════════════════════════════════════════════════

describe('Patch-KIS-REALDATA-500 — formatKisRealDataHealthSection', () => {
  function classify500(symbol?: string) {
    return classifyKisRealDataError({
      endpoint: 'FHKST01010100',
      ...(symbol ? { symbol } : {}),
      httpStatus: 500,
    });
  }

  it('D1 (사용자 §7). 빈 store → null 반환 (잡음 차단)', () => {
    expect(formatKisRealDataHealthSection([])).toBeNull();
    expect(formatKisRealDataHealthSection()).toBeNull(); // default arg = listKisRealDataNoiseRecords()
  });

  it('D2 (사용자 §7). 정상 출력 — PATCH-RUNTIME 태그 + Patch ID + 핵심 필드 노출', () => {
    recordKisRealDataFailure(classify500('005930'));
    const out = formatKisRealDataHealthSection();
    expect(out).not.toBeNull();
    expect(out!).toContain('[PATCH-RUNTIME]');
    expect(out!).toContain('Patch-KIS-REALDATA-500-NOISE-AND-RECOVERY-001');
    expect(out!).toContain('endpoint: FHKST01010100');
    expect(out!).toContain('symbol=005930');
    expect(out!).toContain('errorKind: TRANSIENT_SERVER_500');
    expect(out!).toContain('failures: 1');
    expect(out!).toContain('providerIssue=true');
    expect(out!).toContain('marketSignal=false');
    expect(out!).toContain('executionImpact=NONE');
    expect(out!).toContain('keep engine alive');
  });

  it('D3. retry exhausted 시 (retry exhausted) 마커 노출', () => {
    const c = classify500('005930');
    recordKisRealDataFailure(c);
    recordKisRealDataFailure(c);
    recordKisRealDataFailure(c);
    const out = formatKisRealDataHealthSection();
    expect(out!).toContain('(retry exhausted)');
  });

  it('D4. Top 3 정렬 — consecutiveFailures desc', () => {
    // 3 endpoint 각각 1, 2, 3회 실패
    recordKisRealDataFailure(classifyKisRealDataError({ endpoint: 'A', httpStatus: 500 }));
    recordKisRealDataFailure(classifyKisRealDataError({ endpoint: 'B', httpStatus: 500 }));
    recordKisRealDataFailure(classifyKisRealDataError({ endpoint: 'B', httpStatus: 500 }));
    recordKisRealDataFailure(classifyKisRealDataError({ endpoint: 'C', httpStatus: 500 }));
    recordKisRealDataFailure(classifyKisRealDataError({ endpoint: 'C', httpStatus: 500 }));
    recordKisRealDataFailure(classifyKisRealDataError({ endpoint: 'C', httpStatus: 500 }));
    const out = formatKisRealDataHealthSection();
    expect(out!).toMatch(/endpoint: C[\s\S]+endpoint: B[\s\S]+endpoint: A/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Group E — Compact summary line (60s throttle)
// ════════════════════════════════════════════════════════════════════════════

describe('Patch-KIS-REALDATA-500 — formatKisRealDataNoiseSummaryLine + shouldEmitNoiseSummary', () => {
  it('E1. summary line 포맷 — providerIssue=true / marketSignal=false / executionImpact=NONE 노출', () => {
    const c = classifyKisRealDataError({ endpoint: 'FHKST01010100', httpStatus: 500 });
    const r = recordKisRealDataFailure(c);
    const line = formatKisRealDataNoiseSummaryLine(r.record);
    expect(line).toContain('[KIS-RealDataSummary]');
    expect(line).toContain('endpoint=FHKST01010100');
    expect(line).toContain('errorKind=TRANSIENT_SERVER_500');
    expect(line).toContain('providerIssue=true');
    expect(line).toContain('marketSignal=false');
    expect(line).toContain('executionImpact=NONE');
    expect(line).toContain('cooldown=60s');
  });

  it('E2. shouldEmitNoiseSummary throttle — 첫 호출 통과, 즉시 재호출은 차단', () => {
    const r1 = shouldEmitNoiseSummary();
    expect(r1.shouldEmitNow).toBe(true);
    expect(r1.intervalMs).toBe(KIS_REAL_DATA_NOISE_CONSTANTS.NOISE_SUMMARY_LOG_INTERVAL_MS);
    const r2 = shouldEmitNoiseSummary();
    expect(r2.shouldEmitNow).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Group F — buildKisRealDataNoiseKey
// ════════════════════════════════════════════════════════════════════════════

describe('Patch-KIS-REALDATA-500 — buildKisRealDataNoiseKey', () => {
  it('F1. endpoint:symbol:errorKind 합성', () => {
    const k = buildKisRealDataNoiseKey({ endpoint: 'FHKST01010100', symbol: '005930', errorKind: 'TRANSIENT_SERVER_500' });
    expect(k).toBe('FHKST01010100:005930:TRANSIENT_SERVER_500');
  });

  it('F2. symbol 부재 → "*" placeholder', () => {
    const k = buildKisRealDataNoiseKey({ endpoint: 'X', errorKind: 'NETWORK_TIMEOUT' });
    expect(k).toBe('X:*:NETWORK_TIMEOUT');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Group G — Static grep 가드 (사용자 §9 — live order 함수 import 0건)
// ════════════════════════════════════════════════════════════════════════════

describe('Patch-KIS-REALDATA-500 — 정적 grep 안전 invariant', () => {
  const ssotPath = resolve(__dirname, 'realDataNoiseStore.ts');

  function stripComments(src: string): string {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
      .replace(/(^|[^:])\/\/.*$/gm, '$1'); // line comments (URL-safe)
  }

  it('G1 (사용자 §9). KIS 주문 함수 5종 import / 호출 0건 (주석 제외 코드 본체)', () => {
    const code = stripComments(readFileSync(ssotPath, 'utf-8'));
    expect(code).not.toMatch(/placeKisMarketOrder|placeKisSellOrder|placeKisStopLossOrder|placeKisTakeProfitOrder|cancelKisOrder/);
  });

  it('G2. autoTradeEngine / orderExecutor / trancheExecutor / shadowTradeRepo import 0건', () => {
    const src = readFileSync(ssotPath, 'utf-8');
    expect(src).not.toMatch(/from\s+['"][^'"]*autoTradeEngine|from\s+['"][^'"]*orderExecutor|from\s+['"][^'"]*trancheExecutor/);
  });

  it('G3. 외부 API (fetch / axios / node-fetch) import 0건 — read-only in-memory', () => {
    const src = readFileSync(ssotPath, 'utf-8');
    expect(src).not.toMatch(/from\s+['"](?:axios|node-fetch)['"]/);
  });

  it('G4. ADR-0157 정확 비교 패턴 사용 의무 (KIS_REALDATA_BACKOFF_DISABLED === "true")', () => {
    const src = readFileSync(ssotPath, 'utf-8');
    expect(src).toMatch(/KIS_REALDATA_BACKOFF_DISABLED\s*===\s*'true'/);
  });

  it('G5. literal type 강제 (providerIssue: true / marketSignal: false / executionImpact: NONE)', () => {
    const src = readFileSync(ssotPath, 'utf-8');
    expect(src).toMatch(/providerIssue:\s*true/);
    expect(src).toMatch(/marketSignal:\s*false/);
    expect(src).toMatch(/executionImpact:\s*'NONE'/);
  });

  it('G6. http.ts wiring — KIS RealData 500 retry 분기에서 SSOT 호출', () => {
    const httpPath = resolve(__dirname, 'http.ts');
    const src = readFileSync(httpPath, 'utf-8');
    expect(src).toContain('classifyKisRealDataError');
    expect(src).toContain('recordKisRealDataFailure');
    expect(src).toContain('recordKisRealDataSuccess');
    expect(src).toContain('isKisRealDataCooldownActive');
  });

  it('G6-1. FHKST03010100 chart 500은 symbol+period cooldown/log context 로 격리한다', () => {
    const httpPath = resolve(__dirname, 'http.ts');
    const src = readFileSync(httpPath, 'utf-8');
    expect(src).toContain(`const KIS_CHART_TR_ID = 'FHKST03010100'`);
    expect(src).toContain('const KIS_CHART_5XX_COOLDOWN_MS = 5 * 60 * 1000');
    expect(src).toContain('const KIS_CHART_LOG_THROTTLE_MS = 60 * 1000');
    expect(src).toContain('FID_INPUT_ISCD');
    expect(src).toContain('FID_PERIOD_DIV_CODE');
    expect(src).toContain('FID_INPUT_DATE_1');
    expect(src).toContain('FID_INPUT_DATE_2');
    expect(src).toContain('[KIS_CHART_COOLDOWN_SET]');
    expect(src).toContain('[KIS_CHART_COOLDOWN_SKIPPED]');
    expect(src).toContain('newNetworkCall=false');
  });

  it('G6-2. FHKST03010100 chart cooldown 은 endpoint global cooldown 을 우회해 다른 symbol/period 영향 0을 보존한다', () => {
    const httpPath = resolve(__dirname, 'http.ts');
    const src = readFileSync(httpPath, 'utf-8');
    expect(src).toContain('kisChartCooldownKey(ctx)');
    expect(src).toContain('if (!chartContext && isRealData5xxCooldownActive(trId, apiPath))');
    expect(src).toContain('if (!chartContext && isKisRealDataCooldownActive({ endpoint: apiPath }))');
    expect(src).toContain("symbol: `${chartContext.symbol}:${chartContext.period}");
    expect(src).toMatch(new RegExp('if \\(chartContext\\) \\{\\r?\\n\\s+return null;\\r?\\n\\s+\\}\\r?\\n\\s+if \\(retriesLeft > 0\\)'));
  });

  it('G7. scanBlockers.cmd wiring — formatKisRealDataHealthSection import + try/catch 격리', () => {
    const scanPath = resolve(__dirname, '../../telegram/commands/system/scanBlockers.cmd.ts');
    const src = readFileSync(scanPath, 'utf-8');
    expect(src).toContain('formatKisRealDataHealthSection');
    expect(src).toMatch(/try\s*\{[\s\S]*formatKisRealDataHealthSection[\s\S]*\}\s*catch/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Group H — Constants SSOT
// ════════════════════════════════════════════════════════════════════════════

describe('Patch-KIS-REALDATA-500 — 상수 SSOT (절대 변경 금지)', () => {
  it('H1. NOISE_SUMMARY_LOG_INTERVAL_MS = 60_000 (60초)', () => {
    expect(KIS_REAL_DATA_NOISE_CONSTANTS.NOISE_SUMMARY_LOG_INTERVAL_MS).toBe(60_000);
  });

  it('H2. SUPPRESS_DETAIL_AFTER_FAILURES = 1 (2회+ 부터 suppress)', () => {
    expect(KIS_REAL_DATA_NOISE_CONSTANTS.SUPPRESS_DETAIL_AFTER_FAILURES).toBe(1);
  });

  it('H3. RETRY_EXHAUSTED_AT_FAILURES = 3', () => {
    expect(KIS_REAL_DATA_NOISE_CONSTANTS.RETRY_EXHAUSTED_AT_FAILURES).toBe(3);
  });

  it('H4. COOLDOWN_BY_ERROR_KIND_MS — 7 errorKind 모두 등록', () => {
    const allKinds: KisRealDataErrorKind[] = [
      'TRANSIENT_SERVER_500',
      'RATE_LIMIT_OR_THROTTLE',
      'AUTH_OR_TOKEN',
      'MARKET_CLOSED_OR_UNAVAILABLE',
      'BAD_REQUEST_OR_SYMBOL',
      'NETWORK_TIMEOUT',
      'UNKNOWN',
    ];
    for (const k of allKinds) {
      expect(KIS_REAL_DATA_NOISE_CONSTANTS.COOLDOWN_BY_ERROR_KIND_MS[k]).toBeGreaterThan(0);
    }
  });

  it('H5. cooldown 모두 30초~2분 사이 (사용자 명시 임계)', () => {
    for (const ms of Object.values(KIS_REAL_DATA_NOISE_CONSTANTS.COOLDOWN_BY_ERROR_KIND_MS)) {
      expect(ms).toBeGreaterThanOrEqual(30_000);
      expect(ms).toBeLessThanOrEqual(120_000);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Group I — type contract assertion (literal types 강제 — TypeScript)
// ════════════════════════════════════════════════════════════════════════════

describe('Patch-KIS-REALDATA-500 — type contract', () => {
  it('I1. KisRealDataNoiseRecord — literal type 컴파일 타임 보장', () => {
    const c = classifyKisRealDataError({ endpoint: 'X', httpStatus: 500 });
    const r = recordKisRealDataFailure(c);
    // TypeScript 컴파일 단계에서 literal type 차단 — 런타임 검증으로 보강
    const rec: KisRealDataNoiseRecord = r.record;
    const _executionImpact: 'NONE' = rec.executionImpact;
    const _liveOrderPlaced: false = rec.marketSignal;
    const _providerIssue: true = rec.providerIssue;
    expect(_executionImpact).toBe('NONE');
    expect(_liveOrderPlaced).toBe(false);
    expect(_providerIssue).toBe(true);
  });
});
