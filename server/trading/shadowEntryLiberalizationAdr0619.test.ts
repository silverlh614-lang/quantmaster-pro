// @responsibility ADR-0619 shadow 진입 개방 회귀 — Gate3 타이밍 bypass(live byte-identical·ENV/isShadow/skipCause 조건·score 직교)·PREBREAKOUT_SHADOW 라벨·skipCause 정규화·ledger FIFO/upsert/손상fallback/flag OFF 미append 검증

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

import { evaluateEntryRevalidation } from './entryEngine.js';
import {
  isShadowPrebreakoutEntryEnabled,
  resolveEntryThresholdModeLabel,
} from './gate1ShadowEntryThreshold.js';
import { entryRevalidationStep } from './signalScanner/revalidationSteps/entryRevalidationStep.js';
import {
  appendShadowEntryLiberalizationObservation,
  buildShadowEntryLiberalizationRow,
  emptySkipCauseDist,
  loadShadowEntryLiberalizationLedger,
  tallySkipCause,
  __resetShadowEntryLiberalizationLedgerForTests,
  SHADOW_ENTRY_LIBERALIZATION_WINDOW,
} from './signalScanner/shadowEntryLiberalizationLedgerAdr0619.js';

const PREBREAKOUT_ENV = 'SHADOW_PREBREAKOUT_ENTRY_ENABLED';
const KILL_ENV = 'SHADOW_LIBERALIZATION_KILL';

// minGate 충분 + 모든 sanity 통과 입력(SKIP 타이밍 절만 분리 검증).
const passingBase = {
  symbol: '삼성전자',
  currentPrice: 70_000,
  entryPrice: 70_000,
  quoteGateScore: 8,
  dayOpen: 70_000,
  prevClose: 69_500,
  volume: 1_000_000,
  avgVolume: 1_000_000,
  minGateScore: 5,
  marketElapsedMinutes: 390,
};

describe('ADR-0619/0624 D1 — isShadowPrebreakoutEntryEnabled (ENV SSOT, default ON opt-out + kill-switch)', () => {
  let saved: string | undefined;
  let savedKill: string | undefined;
  beforeEach(() => {
    saved = process.env[PREBREAKOUT_ENV];
    savedKill = process.env[KILL_ENV];
    delete process.env[PREBREAKOUT_ENV];
    delete process.env[KILL_ENV];
  });
  afterEach(() => {
    if (saved === undefined) delete process.env[PREBREAKOUT_ENV]; else process.env[PREBREAKOUT_ENV] = saved;
    if (savedKill === undefined) delete process.env[KILL_ENV]; else process.env[KILL_ENV] = savedKill;
  });

  it('미설정 → true (ADR-0624 default ON, always-on 복원)', () => { expect(isShadowPrebreakoutEntryEnabled()).toBe(true); });
  it("'true' → true", () => { process.env[PREBREAKOUT_ENV] = 'true'; expect(isShadowPrebreakoutEntryEnabled()).toBe(true); });
  it("'false' → false (opt-out 1줄 롤백)", () => { process.env[PREBREAKOUT_ENV] = 'false'; expect(isShadowPrebreakoutEntryEnabled()).toBe(false); });
  it.each(['TRUE', '1', 'yes', ''])('임의값 %s → true (default ON)', (v) => {
    process.env[PREBREAKOUT_ENV] = v;
    expect(isShadowPrebreakoutEntryEnabled()).toBe(true);
  });
  it('(8) kill-switch ON → false (flag 미설정이어도 강제 OFF, byte-identical 롤백)', () => {
    delete process.env[PREBREAKOUT_ENV];
    process.env[KILL_ENV] = 'true';
    expect(isShadowPrebreakoutEntryEnabled()).toBe(false);
  });
  it("(8) kill-switch ON → false (flag='true' 여도 강제 OFF)", () => {
    process.env[PREBREAKOUT_ENV] = 'true';
    process.env[KILL_ENV] = 'true';
    expect(isShadowPrebreakoutEntryEnabled()).toBe(false);
  });
});

describe('ADR-0619/0624 — Gate3 타이밍 bypass (evaluateEntryRevalidation)', () => {
  let saved: string | undefined;
  let savedKill: string | undefined;
  beforeEach(() => {
    saved = process.env[PREBREAKOUT_ENV];
    savedKill = process.env[KILL_ENV];
    delete process.env[KILL_ENV]; // kill-switch 미발동 baseline.
  });
  afterEach(() => {
    if (saved === undefined) delete process.env[PREBREAKOUT_ENV]; else process.env[PREBREAKOUT_ENV] = saved;
    if (savedKill === undefined) delete process.env[KILL_ENV]; else process.env[KILL_ENV] = savedKill;
  });

  // (1) flag OFF(`=false`) → SKIP byte-identical (live+shadow 현행 차단).
  it('(1) flag OFF(`=false`) + isShadow + BAND_MISS SKIP → 차단(byte-identical) — `(SKIP && !false)===SKIP`', () => {
    process.env[PREBREAKOUT_ENV] = 'false';
    const r = evaluateEntryRevalidation({
      ...passingBase, quoteSignalType: 'SKIP', skipCause: 'BAND_MISS', isShadow: true,
    });
    expect(r.ok).toBe(false);
    expect(r.gate3Liberalized).toBe(false);
    expect(r.reasons.some((x) => x.includes('Gate 재검증 미달'))).toBe(true);
  });

  // (1b) ADR-0624 default ON — 미설정 + isShadow + BAND_MISS SKIP → bypass(운영자 미개입 진입 허용).
  it('(1b) ADR-0624 미설정(default ON) + isShadow + BAND_MISS SKIP → bypass 진입 허용 (always-on)', () => {
    delete process.env[PREBREAKOUT_ENV];
    const r = evaluateEntryRevalidation({
      ...passingBase, quoteSignalType: 'SKIP', skipCause: 'BAND_MISS', isShadow: true,
    });
    expect(r.ok).toBe(true);
    expect(r.gate3Liberalized).toBe(true);
    expect(r.status).toBe('PASS');
  });

  // (8) kill-switch ON → bypass 강제 OFF (default ON 이어도 byte-identical 차단).
  it('(8) kill-switch ON(미설정 default ON) + isShadow + BAND_MISS SKIP → 차단(byte-identical 롤백)', () => {
    delete process.env[PREBREAKOUT_ENV];
    process.env[KILL_ENV] = 'true';
    const r = evaluateEntryRevalidation({
      ...passingBase, quoteSignalType: 'SKIP', skipCause: 'BAND_MISS', isShadow: true,
    });
    expect(r.ok).toBe(false);
    expect(r.gate3Liberalized).toBe(false);
    expect(r.reasons.some((x) => x.includes('Gate 재검증 미달'))).toBe(true);
  });

  // (2) ON + isShadow + BAND_MISS/MTAS_WEAK → bypass(진입 허용).
  it.each(['BAND_MISS', 'MTAS_WEAK'] as const)('(2) ENV ON + isShadow + %s SKIP → bypass 진입 허용', (cause) => {
    process.env[PREBREAKOUT_ENV] = 'true';
    const r = evaluateEntryRevalidation({
      ...passingBase, quoteSignalType: 'SKIP', skipCause: cause, isShadow: true,
    });
    expect(r.ok).toBe(true);
    expect(r.gate3Liberalized).toBe(true);
    expect(r.status).toBe('PASS');
  });

  // (3) ON + isShadow + VIX/CONSEC/UNKNOWN → 여전히 SKIP(유지 차단).
  it.each(['VIX_CONSERVATIVE', 'CONSECUTIVE_LOSS_HOLD', 'UNKNOWN'] as const)(
    '(3) ENV ON + isShadow + %s SKIP → 여전히 차단(유지 차단, bypass 불가)', (cause) => {
      process.env[PREBREAKOUT_ENV] = 'true';
      const r = evaluateEntryRevalidation({
        ...passingBase, quoteSignalType: 'SKIP', skipCause: cause, isShadow: true,
      });
      expect(r.ok).toBe(false);
      expect(r.gate3Liberalized).toBe(false);
    },
  );

  // (6) skipCause 미전달 → bypass 불가(보수 차단).
  it('(6) ENV ON + isShadow + skipCause 미전달 → 여전히 차단(보수)', () => {
    process.env[PREBREAKOUT_ENV] = 'true';
    const r = evaluateEntryRevalidation({
      ...passingBase, quoteSignalType: 'SKIP', isShadow: true,
    });
    expect(r.ok).toBe(false);
    expect(r.gate3Liberalized).toBe(false);
  });

  // (4) ON + live(isShadow=false) + SKIP → 여전히 차단(byte-identical, live 무영향).
  it('(4) ENV ON + live(isShadow=false) + BAND_MISS SKIP → 여전히 차단(byte-identical)', () => {
    process.env[PREBREAKOUT_ENV] = 'true';
    const r = evaluateEntryRevalidation({
      ...passingBase, quoteSignalType: 'SKIP', skipCause: 'BAND_MISS', isShadow: false,
    });
    expect(r.ok).toBe(false);
    expect(r.gate3Liberalized).toBe(false);
  });

  it('(4b) ENV ON + isShadow 미전달 + SKIP → 여전히 차단(isShadow!==true)', () => {
    process.env[PREBREAKOUT_ENV] = 'true';
    const r = evaluateEntryRevalidation({
      ...passingBase, quoteSignalType: 'SKIP', skipCause: 'BAND_MISS',
    });
    expect(r.ok).toBe(false);
  });

  // (5) bypass 후 score < minGate 여전히 평가(두 완화 직교).
  it('(5) bypass(BAND_MISS) 후에도 score < minGate → 여전히 차단(Gate1 직교)', () => {
    process.env[PREBREAKOUT_ENV] = 'true';
    const r = evaluateEntryRevalidation({
      ...passingBase,
      quoteSignalType: 'SKIP', skipCause: 'BAND_MISS', isShadow: true,
      quoteGateScore: 3, minGateScore: 5, // 3 < 5 → 뒤 절이 여전히 차단
    });
    expect(r.ok).toBe(false);
    // gate3Liberalized 는 타이밍 절 우회 여부만 표기(뒤 절 score 미달과 직교).
    expect(r.gate3Liberalized).toBe(true);
    expect(r.reasons.some((x) => x.includes('Gate 재검증 미달'))).toBe(true);
  });

  // DATA_HOLD sanity 는 bypass 후에도 유지(extensionStrict 박제 괴리).
  it('(DATA_HOLD) bypass(BAND_MISS) 후에도 extensionStrict 박제 괴리 → DATA_HOLD 유지', () => {
    process.env[PREBREAKOUT_ENV] = 'true';
    const r = evaluateEntryRevalidation({
      ...passingBase,
      quoteSignalType: 'SKIP', skipCause: 'BAND_MISS', isShadow: true,
      currentPrice: 200_000, entryPrice: 70_000, // +185% → maxAbsPct 90 초과 → DATA_HOLD
    });
    expect(r.ok).toBe(false);
    expect(r.waitReason).toBe('DATA_HOLD');
  });

  // 비SKIP(NORMAL) 은 bypass 무관 — 통과(현행 동작 보존).
  it('비SKIP(NORMAL) signalType — bypass 무관 정상 통과', () => {
    process.env[PREBREAKOUT_ENV] = 'true';
    const r = evaluateEntryRevalidation({
      ...passingBase, quoteSignalType: 'NORMAL', isShadow: true,
    });
    expect(r.ok).toBe(true);
    expect(r.gate3Liberalized).toBe(false);
  });
});

describe('ADR-0619/0624 — entryRevalidationStep PREBREAKOUT_SHADOW 라벨 carry', () => {
  let savedPre: string | undefined;
  let savedGate1: string | undefined;
  let savedKill: string | undefined;
  beforeEach(() => {
    savedPre = process.env[PREBREAKOUT_ENV];
    savedGate1 = process.env.GATE1_REGIME_AWARE_SHADOW_ENTRY_ENABLED;
    savedKill = process.env[KILL_ENV];
    delete process.env[KILL_ENV]; // kill-switch 미발동 baseline.
  });
  afterEach(() => {
    if (savedPre === undefined) delete process.env[PREBREAKOUT_ENV]; else process.env[PREBREAKOUT_ENV] = savedPre;
    if (savedGate1 === undefined) delete process.env.GATE1_REGIME_AWARE_SHADOW_ENTRY_ENABLED;
    else process.env.GATE1_REGIME_AWARE_SHADOW_ENTRY_ENABLED = savedGate1;
    if (savedKill === undefined) delete process.env[KILL_ENV]; else process.env[KILL_ENV] = savedKill;
  });

  const stepBase = {
    stockName: '삼성전자',
    currentPrice: 70_000,
    entryPrice: 70_000,
    reCheckQuote: { dayOpen: 70_000, prevClose: 69_500, volume: 1_000_000, avgVolume: 1_000_000 },
    regime: 'R2_BULL',
    marketElapsedMinutes: 390,
  };

  it('(7) Gate3 완화 진입 → entryThresholdMode=PREBREAKOUT_SHADOW', () => {
    process.env[PREBREAKOUT_ENV] = 'true';
    // Gate1 만 격리 OFF(`=false`) — Gate3-only 완화 입증. ADR-0624 default ON 회피.
    process.env.GATE1_REGIME_AWARE_SHADOW_ENTRY_ENABLED = 'false';
    const r = entryRevalidationStep({
      ...stepBase,
      reCheckGate: { gateScore: 8, signalType: 'SKIP', skipCause: 'BAND_MISS' },
      isShadow: true,
    });
    expect(r.proceed).toBe(true);
    if (!r.proceed) return;
    expect(r.entryThresholdMode).toBe('PREBREAKOUT_SHADOW');
  });

  it('(7b) Gate1+Gate3 동시 완화 → 우선순위 PREBREAKOUT_SHADOW (보수 층화)', () => {
    process.env[PREBREAKOUT_ENV] = 'true';
    process.env.GATE1_REGIME_AWARE_SHADOW_ENTRY_ENABLED = 'true';
    // R3_EARLY SHADOW: Gate1 라벨 REGIME_AWARE_SHADOW 가 base 가 되지만 Gate3 완화 시 PREBREAKOUT 우선.
    const r = entryRevalidationStep({
      ...stepBase,
      regime: 'R3_EARLY',
      entryRegime: 'R3_EARLY',
      reCheckGate: { gateScore: 8, signalType: 'SKIP', skipCause: 'MTAS_WEAK' },
      isShadow: true,
    });
    expect(r.proceed).toBe(true);
    if (!r.proceed) return;
    expect(r.entryThresholdMode).toBe('PREBREAKOUT_SHADOW');
  });

  it('Gate3 OFF(`=false`) + SKIP → 기존 동작(차단, 라벨 미부착)', () => {
    // ADR-0624 default ON 이므로 양 flag 명시 OFF.
    process.env[PREBREAKOUT_ENV] = 'false';
    process.env.GATE1_REGIME_AWARE_SHADOW_ENTRY_ENABLED = 'false';
    const r = entryRevalidationStep({
      ...stepBase,
      reCheckGate: { gateScore: 8, signalType: 'SKIP', skipCause: 'BAND_MISS' },
      isShadow: true,
    });
    expect(r.proceed).toBe(false);
  });

  it('(8) kill-switch ON(양 flag 미설정 default ON) + Gate3 SKIP → 차단(byte-identical 롤백)', () => {
    delete process.env[PREBREAKOUT_ENV];
    delete process.env.GATE1_REGIME_AWARE_SHADOW_ENTRY_ENABLED;
    process.env[KILL_ENV] = 'true';
    const r = entryRevalidationStep({
      ...stepBase,
      reCheckGate: { gateScore: 8, signalType: 'SKIP', skipCause: 'BAND_MISS' },
      isShadow: true,
    });
    expect(r.proceed).toBe(false);
  });
});

describe('ADR-0619 — resolveEntryThresholdModeLabel 우선순위 SSOT', () => {
  it('Gate3 완화=true → PREBREAKOUT_SHADOW (base 무관)', () => {
    expect(resolveEntryThresholdModeLabel('LEGACY', true)).toBe('PREBREAKOUT_SHADOW');
    expect(resolveEntryThresholdModeLabel('REGIME_AWARE_SHADOW', true)).toBe('PREBREAKOUT_SHADOW');
    expect(resolveEntryThresholdModeLabel(undefined, true)).toBe('PREBREAKOUT_SHADOW');
  });
  it('Gate3 완화=false → base 유지(undefined→LEGACY)', () => {
    expect(resolveEntryThresholdModeLabel('REGIME_AWARE_SHADOW', false)).toBe('REGIME_AWARE_SHADOW');
    expect(resolveEntryThresholdModeLabel('LEGACY', false)).toBe('LEGACY');
    expect(resolveEntryThresholdModeLabel(undefined, false)).toBe('LEGACY');
  });
});

describe('ADR-0619 — skipCause 분포 집계 (tallySkipCause)', () => {
  it('enum → 해당 카운터 누적, 미상/undefined → unknown', () => {
    const d = emptySkipCauseDist();
    tallySkipCause(d, 'BAND_MISS');
    tallySkipCause(d, 'BAND_MISS');
    tallySkipCause(d, 'MTAS_WEAK');
    tallySkipCause(d, 'VIX_CONSERVATIVE');
    tallySkipCause(d, 'CONSECUTIVE_LOSS_HOLD');
    tallySkipCause(d, 'UNKNOWN');
    tallySkipCause(d, undefined);
    expect(d).toEqual({ bandMiss: 2, mtasWeak: 1, vixBlocked: 1, consecutiveLossHold: 1, unknown: 2 });
  });
});

describe('ADR-0619 — 관측 ledger (atomic/FIFO/upsert/손상 fallback)', () => {
  let tmpFile: string;
  beforeEach(() => {
    tmpFile = path.join(os.tmpdir(), `shadow-liberalization-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  });
  afterEach(() => { __resetShadowEntryLiberalizationLedgerForTests(tmpFile); });

  it('buildShadowEntryLiberalizationRow — liberalizedEntryCount = gate1+gate3, literal 강제', () => {
    const row = buildShadowEntryLiberalizationRow({
      scanDateKey: '2026-06-16',
      gate1RelaxedCount: 2,
      gate3RelaxedCount: 3,
      skipCauseDist: { bandMiss: 4, mtasWeak: 1, vixBlocked: 0, consecutiveLossHold: 0, unknown: 0 },
      now: new Date('2026-06-16T01:00:00Z'),
    });
    expect(row.liberalizedEntryCount).toBe(5);
    expect(row.executionImpact).toBe('NONE');
    expect(row.observationOnly).toBe(true);
  });

  it('append → 영속 후 load 로 1행 조회', () => {
    appendShadowEntryLiberalizationObservation({
      scanDateKey: '2026-06-16', gate1RelaxedCount: 1, gate3RelaxedCount: 2,
      skipCauseDist: emptySkipCauseDist(),
    }, tmpFile);
    const rows = loadShadowEntryLiberalizationLedger(tmpFile);
    expect(rows).toHaveLength(1);
    expect(rows[0].scanDateKey).toBe('2026-06-16');
    expect(rows[0].liberalizedEntryCount).toBe(3);
  });

  it('(upsert) 동일 scanDateKey 재append → last-write-wins(1행 유지)', () => {
    appendShadowEntryLiberalizationObservation({
      scanDateKey: '2026-06-16', gate1RelaxedCount: 1, gate3RelaxedCount: 0, skipCauseDist: emptySkipCauseDist(),
    }, tmpFile);
    appendShadowEntryLiberalizationObservation({
      scanDateKey: '2026-06-16', gate1RelaxedCount: 5, gate3RelaxedCount: 5, skipCauseDist: emptySkipCauseDist(),
    }, tmpFile);
    const rows = loadShadowEntryLiberalizationLedger(tmpFile);
    expect(rows).toHaveLength(1);
    expect(rows[0].liberalizedEntryCount).toBe(10);
  });

  it('(FIFO) WINDOW 초과 → 가장 오래된 scanDateKey 제거', () => {
    const total = SHADOW_ENTRY_LIBERALIZATION_WINDOW + 5;
    for (let i = 0; i < total; i += 1) {
      const d = new Date(2026, 0, 1 + i); // 2026-01-01 부터 연속일
      const key = new Date(d.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
      appendShadowEntryLiberalizationObservation({
        scanDateKey: key, gate1RelaxedCount: i, gate3RelaxedCount: 0, skipCauseDist: emptySkipCauseDist(),
      }, tmpFile);
    }
    const rows = loadShadowEntryLiberalizationLedger(tmpFile);
    expect(rows).toHaveLength(SHADOW_ENTRY_LIBERALIZATION_WINDOW);
    // 가장 오래된 5개 제거 → 첫 row 의 gate1RelaxedCount 는 5(=i)
    expect(rows[0].gate1RelaxedCount).toBe(5);
  });

  it('(손상 fallback) 손상 JSON → 빈 배열 후 append 복구', () => {
    fs.writeFileSync(tmpFile, '{ this is not valid json ]]]');
    const row = appendShadowEntryLiberalizationObservation({
      scanDateKey: '2026-06-16', gate1RelaxedCount: 1, gate3RelaxedCount: 1, skipCauseDist: emptySkipCauseDist(),
    }, tmpFile);
    expect(row.liberalizedEntryCount).toBe(2);
    const rows = loadShadowEntryLiberalizationLedger(tmpFile);
    expect(rows).toHaveLength(1);
  });

  it('(미존재 파일) load → 빈 배열', () => {
    expect(loadShadowEntryLiberalizationLedger(tmpFile)).toEqual([]);
  });
});
