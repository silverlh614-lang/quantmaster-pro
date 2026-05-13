/**
 * @responsibility ADR-0506 — /scan_blockers compact mode + ADR-0505 emission verification 회귀.
 *
 * 사용자 명시 §L 12 mandatory test cases + 안전 invariant (live trading / order
 * path / executionImpact NONE 보존) 정적 grep 가드.
 */

import { describe, expect, it } from 'vitest';
import {
  applyScanBlockersLengthGuard,
  deriveAdr0505EmissionStatus,
  extractAdrMarkersFromSection,
  formatAdr0505EmissionCompactLine,
  formatAdr0505EmissionDetailBlock,
  formatScanBlockersCompactMessage,
  parseScanBlockersMode,
  SCAN_BLOCKERS_ALLOWED_MODES,
  SCAN_BLOCKERS_LENGTH_BUDGET,
  SCAN_BLOCKERS_USAGE_HINT,
  sectionMatchesMode,
  MODE_ADR_INCLUSION,
  type Adr0505EmissionStatus,
} from './scanBlockersCompactAdr0506.js';
import type { ScanSummary } from '../../../trading/signalScanner/scanDiagnostics.js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/* ───────── parseScanBlockersMode ───────── */

describe('parseScanBlockersMode', () => {
  it('빈 args → compact (default)', () => {
    const r = parseScanBlockersMode(undefined);
    expect(r.mode).toBe('compact');
    expect(r.isUnknown).toBe(false);
    expect(r.rawToken).toBeNull();
  });

  it('빈 배열 → compact', () => {
    const r = parseScanBlockersMode([]);
    expect(r.mode).toBe('compact');
    expect(r.isUnknown).toBe(false);
  });

  it('"full" → full', () => {
    expect(parseScanBlockersMode(['full']).mode).toBe('full');
    expect(parseScanBlockersMode(['gate']).mode).toBe('gate');
    expect(parseScanBlockersMode(['supply']).mode).toBe('supply');
    expect(parseScanBlockersMode(['sector']).mode).toBe('sector');
    expect(parseScanBlockersMode(['runtime']).mode).toBe('runtime');
  });

  it('case-insensitive', () => {
    expect(parseScanBlockersMode(['FULL']).mode).toBe('full');
    expect(parseScanBlockersMode(['Gate']).mode).toBe('gate');
  });

  it('unknown → compact fallback + isUnknown=true', () => {
    const r = parseScanBlockersMode(['xyz']);
    expect(r.mode).toBe('compact');
    expect(r.isUnknown).toBe(true);
    expect(r.rawToken).toBe('xyz');
  });

  it('string 입력 — 첫 토큰만 사용', () => {
    expect(parseScanBlockersMode('full some-other-arg').mode).toBe('full');
  });

  it('SCAN_BLOCKERS_ALLOWED_MODES SSOT — 6값 정확', () => {
    expect(SCAN_BLOCKERS_ALLOWED_MODES.size).toBe(6);
    for (const m of ['compact', 'full', 'gate', 'supply', 'sector', 'runtime'] as const) {
      expect(SCAN_BLOCKERS_ALLOWED_MODES.has(m)).toBe(true);
    }
  });
});

/* ───────── deriveAdr0505EmissionStatus — 사용자 §C 7-state 결정 트리 ───────── */

describe('deriveAdr0505EmissionStatus', () => {
  const emptyEnv: Record<string, string | undefined> = {};

  it('ENV disabled → DISABLED_BY_ENV', () => {
    const diag = deriveAdr0505EmissionStatus(null, {
      GATE1_MINIMUM_SIGNAL_FORENSIC_ADR_0505_DISABLED: 'true',
    });
    expect(diag.status).toBe<Adr0505EmissionStatus>('DISABLED_BY_ENV');
    expect(diag.envDisabled).toBe(true);
  });

  it('ENV "1"/"TRUE"/"yes" → DISABLED_BY_ENV 아님 (ADR-0157 정확 비교 의무)', () => {
    expect(deriveAdr0505EmissionStatus(null, { GATE1_MINIMUM_SIGNAL_FORENSIC_ADR_0505_DISABLED: '1' }).status).not.toBe('DISABLED_BY_ENV');
    expect(deriveAdr0505EmissionStatus(null, { GATE1_MINIMUM_SIGNAL_FORENSIC_ADR_0505_DISABLED: 'TRUE' }).status).not.toBe('DISABLED_BY_ENV');
    expect(deriveAdr0505EmissionStatus(null, { GATE1_MINIMUM_SIGNAL_FORENSIC_ADR_0505_DISABLED: 'yes' }).status).not.toBe('DISABLED_BY_ENV');
  });

  it('summary null + env enabled → PERSIST_SKIPPED', () => {
    const diag = deriveAdr0505EmissionStatus(null, emptyEnv);
    expect(diag.status).toBe<Adr0505EmissionStatus>('PERSIST_SKIPPED');
    expect(diag.hasSummary).toBe(false);
  });

  it('summary 존재 + gate1MinimumSignalForensicAdr0505 부재 → SUMMARY_FIELD_MISSING', () => {
    const summary = { time: '2026-05-13T00:00:00Z', candidates: 10, entries: 0 } as unknown as ScanSummary;
    const diag = deriveAdr0505EmissionStatus(summary, emptyEnv);
    expect(diag.status).toBe<Adr0505EmissionStatus>('SUMMARY_FIELD_MISSING');
    expect(diag.hasSummary).toBe(true);
    expect(diag.hasSummaryField).toBe(false);
    expect(diag.recommendedAction).toMatch(/gate1ForensicInputs/);
  });

  it('summary.gate1MinimumSignalForensicAdr0505 존재 + totalCandidates=0 → BUILDER_NOT_CALLED', () => {
    const summary = {
      time: '2026-05-13T00:00:00Z',
      candidates: 0,
      entries: 0,
      gate1MinimumSignalForensicAdr0505: { totalCandidates: 0 },
    } as unknown as ScanSummary;
    const diag = deriveAdr0505EmissionStatus(summary, emptyEnv);
    expect(diag.status).toBe<Adr0505EmissionStatus>('BUILDER_NOT_CALLED');
    expect(diag.totalCandidates).toBe(0);
  });

  it('summary.gate1MinimumSignalForensicAdr0505 존재 + totalCandidates>0 → EMITTED', () => {
    const summary = {
      time: '2026-05-13T00:00:00Z',
      candidates: 50,
      entries: 0,
      gate1MinimumSignalForensicAdr0505: { totalCandidates: 50 },
    } as unknown as ScanSummary;
    const diag = deriveAdr0505EmissionStatus(summary, emptyEnv);
    expect(diag.status).toBe<Adr0505EmissionStatus>('EMITTED');
    expect(diag.totalCandidates).toBe(50);
  });
});

/* ───────── ADR-0505 emission compact + detail formatters ───────── */

describe('formatAdr0505EmissionCompactLine / formatAdr0505EmissionDetailBlock', () => {
  it('EMITTED — compact 한 줄', () => {
    const out = formatAdr0505EmissionCompactLine({
      status: 'EMITTED',
      hasSummary: true,
      hasSummaryField: true,
      envDisabled: false,
      totalCandidates: 50,
      recommendedAction: 'OK',
    });
    expect(out).toContain('EMITTED ✅');
    expect(out).toContain('50건');
  });

  it('NOT_EMITTED — compact 4줄 (status + reason + action + impact=NONE)', () => {
    const out = formatAdr0505EmissionCompactLine({
      status: 'SUMMARY_FIELD_MISSING',
      hasSummary: true,
      hasSummaryField: false,
      envDisabled: false,
      totalCandidates: null,
      recommendedAction: 'check wiring',
    });
    expect(out).toContain('SUMMARY_FIELD_MISSING ⚠️');
    expect(out).toContain('impact=NONE');
    expect(out).toContain('action=check wiring');
  });

  it('detail block — 모든 필드 노출 + impact NONE 명시', () => {
    const out = formatAdr0505EmissionDetailBlock({
      status: 'FORENSIC_INPUTS_MISSING',
      hasSummary: true,
      hasSummaryField: false,
      envDisabled: false,
      totalCandidates: null,
      recommendedAction: 'verify Phase 1',
    });
    expect(out).toContain('Emission Diagnostic');
    expect(out).toContain('FORENSIC_INPUTS_MISSING');
    expect(out).toContain('envDisabled: false');
    expect(out).toContain('hasSummary: true');
    expect(out).toContain('impact: NONE');
  });
});

/* ───────── formatScanBlockersCompactMessage — 사용자 §B compact 출력 ───────── */

describe('formatScanBlockersCompactMessage', () => {
  it('summary 부재 — 안전 fallback, 미실행 표시', () => {
    const out = formatScanBlockersCompactMessage(null);
    expect(out).toContain('매수 차단 요약');
    expect(out).toContain('미실행');
    expect(out).toContain('candidates: 0');
    expect(out).toContain('Gate1: 0/0');
  });

  it('summary 정상 — session / candidates / Gate1 / Supply / SectorEnergy 노출', () => {
    const summary = {
      time: '2026-05-13T00:00:00Z',
      candidates: 50,
      entries: 0,
      gateMisses: 0,
      gatePassDistribution: { gate1Pass: 0, gate2Pass: 0, gate3Pass: 0, lastTriggerPass: 0 },
      macroGateState: { sellOnlyMode: true },
      sectorEnergyQuality: 'PARTIAL',
      investorFlowProviderRouter: {
        status: 'OK',
        selectedProvider: 'KIS_API',
        executionImpact: 'shadowOnly',
        coverage: { available: 2, total: 11, missing: 9, stale: 0, acceptedEmpty: 0, providerMismatch: 0, notWired: 0 },
      },
    } as unknown as ScanSummary;
    const out = formatScanBlockersCompactMessage(summary);
    expect(out).toContain('SELL_ONLY');
    expect(out).toContain('candidates: 50');
    expect(out).toContain('Gate1: 0/50');
    expect(out).toContain('KIS_API');
    expect(out).toContain('PARTIAL');
    expect(out).toContain('coverage 2/11');
  });

  it('ADR-0505 EMITTED 시 emission 한 줄 포함', () => {
    const summary = {
      time: '2026-05-13T00:00:00Z',
      candidates: 50,
      entries: 0,
      gate1MinimumSignalForensicAdr0505: { totalCandidates: 50, averageActualScore: 3.0, requiredScore: 70 },
    } as unknown as ScanSummary;
    const adr0505 = deriveAdr0505EmissionStatus(summary);
    const out = formatScanBlockersCompactMessage(summary, { adr0505 });
    expect(out).toContain('ADR-0505');
    expect(out).toContain('EMITTED');
  });

  it('ADR-0505 NOT_EMITTED (SUMMARY_FIELD_MISSING) — compact 안에 표시', () => {
    const summary = { time: '2026-05-13T00:00:00Z', candidates: 50, entries: 0 } as unknown as ScanSummary;
    const adr0505 = deriveAdr0505EmissionStatus(summary);
    const out = formatScanBlockersCompactMessage(summary, { adr0505 });
    expect(out).toContain('SUMMARY_FIELD_MISSING');
  });

  it('SCAN_BLOCKERS_USAGE_HINT 마지막 줄 포함', () => {
    const out = formatScanBlockersCompactMessage(null);
    expect(out.split('\n').pop()).toBe(SCAN_BLOCKERS_USAGE_HINT);
  });
});

/* ───────── ADR section → mode 분류 ───────── */

describe('MODE_ADR_INCLUSION + sectionMatchesMode + extractAdrMarkersFromSection', () => {
  it('MODE_ADR_INCLUSION — 사용자 명시 §E-H 매트릭스 정확', () => {
    // gate: ADR-0505 포함
    expect(MODE_ADR_INCLUSION.gate).toContain('0505');
    expect(MODE_ADR_INCLUSION.gate).toContain('0466');
    // supply: ADR-0477 포함
    expect(MODE_ADR_INCLUSION.supply).toContain('0477');
    expect(MODE_ADR_INCLUSION.supply).toContain('0498');
    // sector: ADR-0423 포함
    expect(MODE_ADR_INCLUSION.sector).toContain('0423');
    expect(MODE_ADR_INCLUSION.sector).toContain('0488');
    // runtime: ADR-0501 포함
    expect(MODE_ADR_INCLUSION.runtime).toContain('0501');
    expect(MODE_ADR_INCLUSION.runtime).toContain('0451');
  });

  it('extractAdrMarkersFromSection — section 안 ADR-XXXX 추출', () => {
    expect(extractAdrMarkersFromSection('foo ADR-0505 bar ADR-0466')).toEqual(['0505', '0466']);
    expect(extractAdrMarkersFromSection('🛡️ Trading Engine Liveness (ADR-0451)')).toEqual(['0451']);
    expect(extractAdrMarkersFromSection('no marker here')).toEqual([]);
  });

  it('sectionMatchesMode — gate mode 가 ADR-0505 section 통과', () => {
    expect(sectionMatchesMode('🧬 ADR-0505 ...', 'gate')).toBe(true);
    expect(sectionMatchesMode('🧬 ADR-0505 ...', 'supply')).toBe(false);
    expect(sectionMatchesMode('Supply ADR-0477', 'supply')).toBe(true);
    expect(sectionMatchesMode('SectorEnergy ADR-0423', 'sector')).toBe(true);
    expect(sectionMatchesMode('Liveness ADR-0451', 'runtime')).toBe(true);
  });

  it('compact / full → 모든 section 통과', () => {
    expect(sectionMatchesMode('any section', 'compact')).toBe(true);
    expect(sectionMatchesMode('any section', 'full')).toBe(true);
  });

  it('null/undefined section → false', () => {
    expect(sectionMatchesMode(null, 'gate')).toBe(false);
    expect(sectionMatchesMode(undefined, 'gate')).toBe(false);
  });
});

/* ───────── length guard ───────── */

describe('applyScanBlockersLengthGuard', () => {
  it('budget 이하 → 그대로', () => {
    const short = 'short message';
    expect(applyScanBlockersLengthGuard(short, 'compact')).toBe(short);
  });

  it('compact budget 2000 초과 → truncate + 안내', () => {
    const long = 'x'.repeat(3000);
    const guarded = applyScanBlockersLengthGuard(long, 'compact');
    expect(guarded.length).toBeLessThanOrEqual(SCAN_BLOCKERS_LENGTH_BUDGET.compact);
    expect(guarded).toContain('truncated');
    expect(guarded).toContain('/scan_blockers full');
  });

  it('full budget 4096', () => {
    expect(SCAN_BLOCKERS_LENGTH_BUDGET.full).toBe(4096);
    expect(SCAN_BLOCKERS_LENGTH_BUDGET.compact).toBe(2000);
  });
});

/* ───────── 안전 invariant 정적 grep 가드 ───────── */

describe('ADR-0506 안전 invariant 정적 grep 가드', () => {
  function readSrc(rel: string): string {
    return readFileSync(resolve(__dirname, rel), 'utf-8');
  }

  it('scanBlockersCompactAdr0506.ts — KIS 주문 함수 5종 import 0건', () => {
    const src = readSrc('./scanBlockersCompactAdr0506.ts');
    expect(src).not.toMatch(/placeKisMarketBuyOrder/);
    expect(src).not.toMatch(/placeKisSellOrder/);
    expect(src).not.toMatch(/cancelKisOrder/);
    expect(src).not.toMatch(/placeKisStopLossOrder/);
    expect(src).not.toMatch(/placeKisTakeProfitOrder/);
  });

  it('scanBlockersCompactAdr0506.ts — autoTradeEngine / orderExecutor / trancheExecutor import 0건', () => {
    const src = readSrc('./scanBlockersCompactAdr0506.ts');
    expect(src).not.toMatch(/autoTradeEngine/);
    expect(src).not.toMatch(/orderExecutor/);
    expect(src).not.toMatch(/trancheExecutor/);
  });

  it('scanBlockersCompactAdr0506.ts — Gate threshold / STRONG_BUY / requiredScore 변경 0건', () => {
    const src = readSrc('./scanBlockersCompactAdr0506.ts');
    expect(src).not.toMatch(/setGateThreshold/);
    expect(src).not.toMatch(/GATE_RELAX/);
    expect(src).not.toMatch(/STRONG_BUY_OVERRIDE/);
  });

  it('scanBlockersCompactAdr0506.ts — 외부 fetch/axios/node-fetch 0건 (read-only diagnostic)', () => {
    const src = readSrc('./scanBlockersCompactAdr0506.ts');
    expect(src).not.toMatch(/from ['"]axios['"]/);
    expect(src).not.toMatch(/from ['"]node-fetch['"]/);
    expect(src).not.toMatch(/global\s*\.\s*fetch/);
  });

  it('scanBlockersCompactAdr0506.ts — console.log 직접 추가 금지 (사용자 §"안전 조건")', () => {
    const src = readSrc('./scanBlockersCompactAdr0506.ts');
    expect(src).not.toMatch(/console\.log\(/);
  });

  it('scanBlockers.cmd.ts — ADR-0506 wiring (parseScanBlockersMode + deriveAdr0505EmissionStatus import)', () => {
    const src = readSrc('./scanBlockers.cmd.ts');
    expect(src).toMatch(/parseScanBlockersMode/);
    expect(src).toMatch(/deriveAdr0505EmissionStatus/);
    expect(src).toMatch(/scanBlockersCompactAdr0506/);
  });

  it('scanBlockers.cmd.ts — 매수 결정/주문 함수 import 0건 (LIVE 본체 무수정)', () => {
    const src = readSrc('./scanBlockers.cmd.ts');
    expect(src).not.toMatch(/placeKisMarketBuyOrder/);
    expect(src).not.toMatch(/placeKisSellOrder/);
    expect(src).not.toMatch(/autoTradeEngine/);
  });
});
