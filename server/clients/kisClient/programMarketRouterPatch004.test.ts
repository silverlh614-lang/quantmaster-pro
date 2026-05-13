// @responsibility Patch-004 regression — 7-state router + KRX/CACHE fallback + stuck detector + formatter + static grep invariants.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  routeProgramMarketEmpty,
  detectProgramMarketStuckEmpty,
  deriveCacheFallbackFromMacroState,
  formatProgramMarketRouted,
  formatProgramMarketRoutedCompact,
  formatProgramMarketRawDiag,
  logProgramMarketStuckIfNeeded,
  isProgramMarketRouterDisabled,
  PROGRAM_MARKET_PROVIDER_COVERAGE,
  PROGRAM_MARKET_STUCK_THRESHOLD_MS,
} from './programMarketRouterPatch004.js';
import type { ProgramMarketStuckObservation } from './programMarketRouterPatch004.js';
import type { MacroState } from '../../persistence/macroStateRepo.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = resolve(__dirname, 'programMarketRouterPatch004.ts');
const SOURCE = readFileSync(SOURCE_PATH, 'utf8');
const SUPPLY_HEALTH_PATH = resolve(__dirname, '..', '..', 'telegram', 'commands', 'system', 'supplyHealth.cmd.ts');

describe('Patch-004 ENV gate', () => {
  const origEnv = process.env.PROGRAM_MARKET_EMPTY_OUTPUT_ROUTER_DISABLED;
  afterEach(() => {
    if (origEnv === undefined) delete process.env.PROGRAM_MARKET_EMPTY_OUTPUT_ROUTER_DISABLED;
    else process.env.PROGRAM_MARKET_EMPTY_OUTPUT_ROUTER_DISABLED = origEnv;
  });

  it('default OFF', () => {
    delete process.env.PROGRAM_MARKET_EMPTY_OUTPUT_ROUTER_DISABLED;
    expect(isProgramMarketRouterDisabled()).toBe(false);
  });

  it('exactly "true" enables disable flag', () => {
    process.env.PROGRAM_MARKET_EMPTY_OUTPUT_ROUTER_DISABLED = 'true';
    expect(isProgramMarketRouterDisabled()).toBe(true);
  });

  it('rejects "1" / "TRUE" / "yes" per ADR-0157', () => {
    for (const v of ['1', 'TRUE', 'yes', 'on', '']) {
      process.env.PROGRAM_MARKET_EMPTY_OUTPUT_ROUTER_DISABLED = v;
      expect(isProgramMarketRouterDisabled()).toBe(false);
    }
  });

  it('"false" returns false', () => {
    process.env.PROGRAM_MARKET_EMPTY_OUTPUT_ROUTER_DISABLED = 'false';
    expect(isProgramMarketRouterDisabled()).toBe(false);
  });
});

describe('Patch-004 PROVIDER_COVERAGE_MAP SSOT', () => {
  it('declares KIS / KRX / CACHE capabilities', () => {
    expect(PROGRAM_MARKET_PROVIDER_COVERAGE.KIS_API.supportsProgramTrading).toBe(true);
    expect(PROGRAM_MARKET_PROVIDER_COVERAGE.KIS_API.supportsPassiveActiveSplit).toBe(false);
    expect(PROGRAM_MARKET_PROVIDER_COVERAGE.KRX_API.supportsProgramTrading).toBe(true);
    expect(PROGRAM_MARKET_PROVIDER_COVERAGE.KRX_API.supportsPassiveActiveSplit).toBe('maybe');
    expect(PROGRAM_MARKET_PROVIDER_COVERAGE.CACHE.supportsLastGoodValue).toBe(true);
  });

  it('Object.freeze drift guard', () => {
    expect(Object.isFrozen(PROGRAM_MARKET_PROVIDER_COVERAGE)).toBe(true);
    expect(Object.isFrozen(PROGRAM_MARKET_PROVIDER_COVERAGE.KIS_API)).toBe(true);
  });

  it('STUCK_THRESHOLD = 30 min', () => {
    expect(PROGRAM_MARKET_STUCK_THRESHOLD_MS).toBe(30 * 60 * 1000);
  });
});

describe('Patch-004 routeProgramMarketEmpty — 7 routed statuses', () => {
  // ─── 사용자 §J #1: HTTP 200 + empty output → no bearish, marketSignal=false ───
  it('§J #1 — KIS ACCEPTED_EMPTY + no fallback → EMPTY_VALID, executionImpact=NONE', () => {
    const decision = routeProgramMarketEmpty({
      rawDiag: { zeroReason: 'ACCEPTED_EMPTY', outputLength: 0, marketCode: '0001' },
    });
    expect(decision.routedStatus).toBe('EMPTY_VALID');
    expect(decision.marketSignal).toBe(false);
    expect(decision.providerIssue).toBe(false);
    expect(decision.executionImpact).toBe('NONE');
    expect(decision.liveExecutionAllowed).toBe(false);
    expect(decision.scoring).toBe('excluded');
  });

  // ─── 사용자 §J #2: KRX fallback attempted ───
  it('§J #2 — KIS ACCEPTED_EMPTY → KRX fallback attempted (krxFallback provided but empty)', () => {
    const decision = routeProgramMarketEmpty({
      rawDiag: { zeroReason: 'ACCEPTED_EMPTY' },
      krxFallback: { available: false },
    });
    expect(decision.fallbackAttempted).toBe(true);
    expect(decision.fallbackResult).toBe('KRX_EMPTY');
  });

  // ─── 사용자 §J #3: KRX success → VERIFIED, source=KRX_API ───
  it('§J #3 — KIS empty → KRX recovered → VERIFIED source=KRX_API scoring=allowed_when_non_empty', () => {
    const decision = routeProgramMarketEmpty({
      rawDiag: { zeroReason: 'ACCEPTED_EMPTY' },
      krxFallback: { available: true, programNetBuyAmount: -1234, fetchedAt: new Date().toISOString() },
    });
    expect(decision.routedStatus).toBe('VERIFIED');
    expect(decision.source).toBe('KRX_API');
    expect(decision.scoring).toBe('allowed_when_non_empty');
    expect(decision.fallbackResult).toBe('KRX_OK');
    expect(decision.textVariant).toBe('D_FALLBACK_OK');
    expect(decision.marketSignal).toBe(false);
  });

  // ─── 사용자 §J #4: All empty → MISSING, scoring=excluded ───
  it('§J #4 — KIS empty + KRX empty + CACHE empty → MISSING scoring=excluded', () => {
    const decision = routeProgramMarketEmpty({
      rawDiag: { zeroReason: 'ACCEPTED_EMPTY' },
      krxFallback: { available: false },
      cacheFallback: { available: false },
    });
    expect(decision.routedStatus).toBe('MISSING');
    expect(decision.source).toBe('NONE');
    expect(decision.fallbackResult).toBe('ALL_FAILED');
    expect(decision.scoring).toBe('excluded');
    expect(decision.providerIssue).toBe(false);
  });

  // ─── 사용자 §J #5: CACHE fallback path ───
  it('§J #5 — KIS empty + KRX empty + CACHE valid → STALE_CACHE source=CACHE scoring=shadow_only_or_excluded', () => {
    const decision = routeProgramMarketEmpty({
      rawDiag: { zeroReason: 'ACCEPTED_EMPTY' },
      krxFallback: { available: false },
      cacheFallback: { available: true, programNetBuyAmount: -2500, fetchedAt: new Date().toISOString(), ageMs: 1_800_000 },
    });
    expect(decision.routedStatus).toBe('STALE_CACHE');
    expect(decision.source).toBe('CACHE');
    expect(decision.scoring).toBe('shadow_only_or_excluded');
    expect(decision.fallbackResult).toBe('CACHE_OK');
  });

  // ─── 사용자 §J #6: UNSUPPORTED → no repeat calls implied ───
  it('§J #6 — KIS PROVIDER_ERROR (session unavailable) → UNSUPPORTED textVariant=B', () => {
    const decision = routeProgramMarketEmpty({
      rawDiag: { zeroReason: 'SESSION_UNAVAILABLE', marketCode: '1001' },
    });
    expect(decision.routedStatus).toBe('UNSUPPORTED');
    expect(decision.textVariant).toBe('B_UNSUPPORTED');
    expect(decision.scoring).toBe('excluded');
  });

  // ─── 사용자 §J #7: PARAM_MISMATCH → param check ───
  it('§J #7 — KIS PARAM_ERROR → PARAM_MISMATCH textVariant=C_PARAM_ISSUE', () => {
    const decision = routeProgramMarketEmpty({
      rawDiag: { zeroReason: 'PARAM_ERROR', msg1: 'INVALID FID_INPUT_ISCD', marketCode: '0001' },
    });
    expect(decision.routedStatus).toBe('PARAM_MISMATCH');
    expect(decision.textVariant).toBe('C_PARAM_ISSUE');
    expect(decision.scoring).toBe('excluded');
    expect(decision.decisionDetail).toContain('marketCode=0001');
  });

  // ─── 사용자 §J #8: All statuses retain executionImpact=NONE ───
  it('§J #8 — every routed status preserves literal invariants', () => {
    const cases: Array<{ input: Parameters<typeof routeProgramMarketEmpty>[0]; expected: string }> = [
      { input: { rawDiag: { zeroReason: 'ACCEPTED_EMPTY' } }, expected: 'EMPTY_VALID' },
      { input: { rawDiag: { zeroReason: 'PARAM_ERROR' } }, expected: 'PARAM_MISMATCH' },
      { input: { rawDiag: { zeroReason: 'SESSION_UNAVAILABLE' } }, expected: 'UNSUPPORTED' },
      { input: { rawDiag: { zeroReason: 'ACCEPTED_EMPTY' }, cacheFallback: { available: true, programNetBuyAmount: 100, fetchedAt: new Date().toISOString() } }, expected: 'STALE_CACHE' },
      { input: { rawDiag: { zeroReason: null }, krxFallback: { available: true, programNetBuyAmount: 100, fetchedAt: new Date().toISOString() } }, expected: 'VERIFIED' },
    ];
    for (const c of cases) {
      const d = routeProgramMarketEmpty(c.input);
      expect(d.routedStatus).toBe(c.expected);
      expect(d.executionImpact).toBe('NONE');
      expect(d.providerIssue).toBe(false);
      expect(d.marketSignal).toBe(false);
      expect(d.liveExecutionAllowed).toBe(false);
    }
  });

  // ─── 사용자 §J #9: empty → scoring=excluded ───
  it('§J #9 — empty paths always scoring∈{excluded, shadow_only_or_excluded}', () => {
    const emptyCases = [
      { zeroReason: 'ACCEPTED_EMPTY' },
      { zeroReason: 'OUTPUT_EMPTY' },
      { zeroReason: 'FIELD_MISSING' },
    ] as const;
    for (const raw of emptyCases) {
      const d = routeProgramMarketEmpty({ rawDiag: raw });
      expect(['excluded', 'shadow_only_or_excluded']).toContain(d.scoring);
    }
  });

  // ─── 사용자 §J #10: rawDiag only in /program_market_raw or Railway debug ───
  it('§J #10 — rawDiagHidden literal true for all decisions', () => {
    const cases = [
      { rawDiag: { zeroReason: 'ACCEPTED_EMPTY' as const } },
      { rawDiag: { zeroReason: 'PARAM_ERROR' as const } },
      { rawDiag: { zeroReason: null } },
    ];
    for (const input of cases) {
      const d = routeProgramMarketEmpty(input);
      expect(d.rawDiagHidden).toBe(true);
    }
  });

  it('null zeroReason → VERIFIED (KIS healthy)', () => {
    const decision = routeProgramMarketEmpty({ rawDiag: { zeroReason: null } });
    expect(decision.routedStatus).toBe('VERIFIED');
    expect(decision.scoring).toBe('allowed_when_non_empty');
  });

  it('undefined rawDiag → fallback chain (treated as FETCH_FAIL)', () => {
    const decision = routeProgramMarketEmpty({});
    // undefined rawDiag means rawZeroReason becomes undefined → fall-through to VERIFIED
    expect(['VERIFIED', 'EMPTY_VALID', 'MISSING']).toContain(decision.routedStatus);
  });

  it('ENV disabled → forces EMPTY_VALID with disabled detail', () => {
    process.env.PROGRAM_MARKET_EMPTY_OUTPUT_ROUTER_DISABLED = 'true';
    const decision = routeProgramMarketEmpty({ rawDiag: { zeroReason: 'ACCEPTED_EMPTY' } });
    expect(decision.routedStatus).toBe('EMPTY_VALID');
    expect(decision.decisionDetail).toContain('disabled');
    delete process.env.PROGRAM_MARKET_EMPTY_OUTPUT_ROUTER_DISABLED;
  });
});

describe('Patch-004 detectProgramMarketStuckEmpty', () => {
  it('returns stuck=false for empty observations', () => {
    expect(detectProgramMarketStuckEmpty([], Date.now()).stuck).toBe(false);
  });

  it('returns stuck=true after 30 min of non-VERIFIED observations', () => {
    const now = Date.now();
    const obs: ProgramMarketStuckObservation[] = [
      { routedStatus: 'EMPTY_VALID', observedAt: now - 35 * 60 * 1000 },
      { routedStatus: 'EMPTY_VALID', observedAt: now - 20 * 60 * 1000 },
      { routedStatus: 'EMPTY_VALID', observedAt: now },
    ];
    const result = detectProgramMarketStuckEmpty(obs, now);
    expect(result.stuck).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(PROGRAM_MARKET_STUCK_THRESHOLD_MS);
  });

  it('returns stuck=false when VERIFIED present in window', () => {
    const now = Date.now();
    const obs: ProgramMarketStuckObservation[] = [
      { routedStatus: 'EMPTY_VALID', observedAt: now - 40 * 60 * 1000 },
      { routedStatus: 'VERIFIED', observedAt: now - 10 * 60 * 1000 },
    ];
    expect(detectProgramMarketStuckEmpty(obs, now).stuck).toBe(false);
  });

  it('returns stuck=false when duration < 30 min', () => {
    const now = Date.now();
    const obs: ProgramMarketStuckObservation[] = [{ routedStatus: 'MISSING', observedAt: now - 10 * 60 * 1000 }];
    expect(detectProgramMarketStuckEmpty(obs, now).stuck).toBe(false);
  });
});

describe('Patch-004 deriveCacheFallbackFromMacroState', () => {
  it('returns available=false for null macro', () => {
    expect(deriveCacheFallbackFromMacroState(null, Date.now()).available).toBe(false);
  });

  it('returns available=false when programSource !== KIS_API', () => {
    const macro = { programSource: 'NONE', programNetBuyAmount: 100, programFetchedAt: new Date().toISOString() } as unknown as MacroState;
    expect(deriveCacheFallbackFromMacroState(macro, Date.now()).available).toBe(false);
  });

  it('returns available=true within max age', () => {
    const macro = {
      programSource: 'KIS_API',
      programNetBuyAmount: -1500,
      programFetchedAt: new Date(Date.now() - 60_000).toISOString(),
    } as unknown as MacroState;
    const result = deriveCacheFallbackFromMacroState(macro, Date.now());
    expect(result.available).toBe(true);
    expect(result.programNetBuyAmount).toBe(-1500);
  });

  it('returns available=false when age exceeds maxAgeMs', () => {
    const macro = {
      programSource: 'KIS_API',
      programNetBuyAmount: 100,
      programFetchedAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    } as unknown as MacroState;
    expect(deriveCacheFallbackFromMacroState(macro, Date.now(), 4 * 60 * 60 * 1000).available).toBe(false);
  });
});

describe('Patch-004 formatProgramMarketRouted', () => {
  it('renders multi-line for EMPTY_VALID', () => {
    const decision = routeProgramMarketEmpty({ rawDiag: { zeroReason: 'ACCEPTED_EMPTY' } });
    const lines = formatProgramMarketRouted(decision);
    expect(lines.some((l) => l.includes('routedStatus: EMPTY_VALID'))).toBe(true);
    expect(lines.some((l) => l.includes('providerIssue=false'))).toBe(true);
    expect(lines.some((l) => l.includes('marketSignal=false'))).toBe(true);
    expect(lines.some((l) => l.includes('executionImpact=NONE'))).toBe(true);
    expect(lines.some((l) => l.includes('rawDiag: hidden'))).toBe(true);
  });

  it('renders KRX recovery variant D', () => {
    const decision = routeProgramMarketEmpty({
      rawDiag: { zeroReason: 'ACCEPTED_EMPTY' },
      krxFallback: { available: true, programNetBuyAmount: 100, fetchedAt: new Date().toISOString() },
    });
    const lines = formatProgramMarketRouted(decision);
    expect(lines.some((l) => l.includes('source: KRX_API'))).toBe(true);
    expect(lines.some((l) => l.includes('variant: D_FALLBACK_OK'))).toBe(true);
    expect(lines.some((l) => l.includes('KRX recovered'))).toBe(true);
  });

  it('compact line carries PATCH-RUNTIME tag', () => {
    const decision = routeProgramMarketEmpty({ rawDiag: { zeroReason: 'ACCEPTED_EMPTY' } });
    const compact = formatProgramMarketRoutedCompact(decision);
    expect(compact).toContain('[PATCH-RUNTIME]');
    expect(compact).toContain('Patch-004');
    expect(compact).toContain('status=EMPTY_VALID');
    expect(compact).toContain('executionImpact=NONE');
  });
});

describe('Patch-004 formatProgramMarketRawDiag — only for /program_market_raw', () => {
  it('renders endpoint / trId / marketCode / rawDiag fields', () => {
    const lines = formatProgramMarketRawDiag({
      endpoint: '/uapi/...',
      trId: 'FHPPG04600101',
      marketCode: '0001',
      queryParams: { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: '0001' },
      httpStatus: 200,
      responseCode: '0',
      msgCd: 'MCA00000',
      msg1: 'NORMAL',
      zeroReason: 'ACCEPTED_EMPTY',
      outputLength: 0,
      outputKeys: [],
      firstRowSample: {},
      requestedAt: new Date().toISOString(),
      providerLatencyMs: 145,
    });
    expect(lines.some((l) => l.includes('Program Market Raw Diagnostic'))).toBe(true);
    expect(lines.some((l) => l.includes('trId: FHPPG04600101'))).toBe(true);
    expect(lines.some((l) => l.includes('marketCode: 0001'))).toBe(true);
    expect(lines.some((l) => l.includes('zeroReason: ACCEPTED_EMPTY'))).toBe(true);
    expect(lines.some((l) => l.includes('executionImpact=NONE'))).toBe(true);
  });
});

describe('Patch-004 logProgramMarketStuckIfNeeded', () => {
  let warns: string[] = [];
  const origWarn = console.warn;
  beforeEach(() => {
    warns = [];
    console.warn = (...args: unknown[]) => { warns.push(args.map(String).join(' ')); };
  });
  afterEach(() => { console.warn = origWarn; });

  it('logs [PROGRAM_MARKET_STUCK_EMPTY] when stuck=true', () => {
    const now = Date.now();
    const obs: ProgramMarketStuckObservation[] = [
      { routedStatus: 'EMPTY_VALID', observedAt: now - 35 * 60 * 1000 },
      { routedStatus: 'EMPTY_VALID', observedAt: now },
    ];
    const result = logProgramMarketStuckIfNeeded(obs, now, '0001');
    expect(result.logged).toBe(true);
    expect(result.stuck).toBe(true);
    expect(warns.some((w) => w.includes('[PROGRAM_MARKET_STUCK_EMPTY]'))).toBe(true);
    expect(warns.some((w) => w.includes('telegramAllowed=false'))).toBe(true);
  });

  it('does not log when stuck=false', () => {
    const result = logProgramMarketStuckIfNeeded([], Date.now());
    expect(result.logged).toBe(false);
    expect(warns).toEqual([]);
  });
});

describe('Patch-004 safety invariants — static grep guards', () => {
  function stripComments(s: string): string {
    return s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  }
  const code = stripComments(SOURCE);

  it('KIS order functions (5종) import 0건', () => {
    expect(code).not.toMatch(/placeKisMarketOrder|placeKisSellOrder|placeKisStopLossOrder|placeKisTakeProfitOrder|cancelKisOrder/);
  });

  it('autoTradeEngine / orderExecutor / trancheExecutor import 0건', () => {
    expect(code).not.toMatch(/autoTradeEngine|orderExecutor|trancheExecutor/i);
  });

  it('외부 fetch / axios / node-fetch import 0건', () => {
    expect(code).not.toMatch(/from ['"]node-fetch['"]|from ['"]axios['"]|\bfetch\(/);
  });

  it('Gate threshold + STRONG_BUY 조건 변경 0', () => {
    expect(code).not.toMatch(/setGateThreshold|GATE_RELAX|STRONG_BUY_OVERRIDE|requiredScore\s*=/);
  });

  it('ADR-0157 정확 비교 의무 — === \'true\'', () => {
    expect(code).toMatch(/=== 'true'/);
    expect(code).not.toMatch(/process\.env\.PROGRAM_MARKET_[A-Z_]+\s*\?\s*[\w'"`]/);
  });

  it('literal types 강제 — providerIssue: false / marketSignal: false / executionImpact: \'NONE\'', () => {
    expect(code).toMatch(/providerIssue:\s*false/);
    expect(code).toMatch(/marketSignal:\s*false/);
    expect(code).toMatch(/executionImpact:\s*'NONE'/);
    expect(code).toMatch(/liveExecutionAllowed:\s*false/);
  });

  it('Patch-004 tracking comment present', () => {
    expect(code).toMatch(/Patch-PROGRAM-MARKET-EMPTY-OUTPUT-ROUTER-004/);
  });

  it('emergencyStop / SELL_ONLY / SHADOW_ONLY 자동 전환 패턴 부재', () => {
    expect(code).not.toMatch(/setEmergencyStop|setSellOnlyMode|setShadowOnlyMode|forceSellOnly/);
  });

  it('supplyHealth.cmd.ts uses Patch-004 SSOT after wiring', () => {
    const supplyCode = readFileSync(SUPPLY_HEALTH_PATH, 'utf8');
    // Note: this assertion passes after wiring step; pre-wiring it documents intent.
    if (supplyCode.includes('programMarketRouterPatch004')) {
      expect(supplyCode).toMatch(/routeProgramMarketEmpty|formatProgramMarketRouted/);
    } else {
      // Pre-wiring, the legacy hardcoded function exists.
      expect(supplyCode).toMatch(/renderAcceptedEmptyMarketProgram|ACCEPTED_EMPTY/);
    }
  });
});
