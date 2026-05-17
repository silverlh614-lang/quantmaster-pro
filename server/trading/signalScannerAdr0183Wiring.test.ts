/**
 * @responsibility ADR-0183 Phase 3 Stage A — signalScanner Always-On early-return Shadow learning wiring 회귀 테스트
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SCANNER_PATH = path.resolve(__dirname, 'signalScanner/preflight.ts');
const RECORDER_PATH = path.resolve(__dirname, 'signalScanner/preflightLearningRecorder.ts');
const src = fs.readFileSync(SCANNER_PATH, 'utf-8');
const recorderSrc = fs.readFileSync(RECORDER_PATH, 'utf-8');

function shadowLearningReasonsFromPreflight(): string[] {
  return [...src.matchAll(/recordBlockedDayShadowScan\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]!);
}

function importBlockFrom(fileSrc: string): string {
  return fileSrc
    .split('\n')
    .filter((line) => /^\s*import\b/.test(line) || /\bfrom\s+['"]/.test(line))
    .join('\n');
}

describe('ADR-0183 Phase 3 Stage A — Shadow learning wiring 정적 가드', () => {
  describe('SSOT 헬퍼 import + 정의', () => {
    it('preflight.ts delegates learning recording to preflightLearningRecorder.ts', () => {
      expect(src).toContain("from './preflightLearningRecorder.js'");
      expect(src).toMatch(/recordBlockedDayShadowScan[\s,]/);
      expect(src).toMatch(/recordPreflightUniverseLearningSnapshot[\s,]/);
    });

    it('preflight.ts does not directly import/call shadow learning internals', () => {
      expect(src).not.toContain("from '../shadowLearningOnlyScan.js'");
      expect(src).not.toMatch(/\bisShadowLearningOnBlockedDaysEnabled\b/);
      expect(src).not.toMatch(/\brunShadowLearningOnlyScan\s*\(/);
      expect(src).not.toContain('type ShadowLearningOnlyScanReason');
    });

    it('preflight.ts no longer defines inline learning helper bodies', () => {
      expect(src).not.toContain('async function captureSupplyHealthSnapshot(');
      expect(src).not.toContain('async function recordBlockedDayShadowScan(');
      expect(src).not.toContain('async function recordPreflightUniverseLearningSnapshot(');
    });

    it('preflightLearningRecorder.ts owns Shadow/Universe recorder helpers', () => {
      expect(recorderSrc).toContain('export async function captureSupplyHealthSnapshot(');
      expect(recorderSrc).toContain('export async function recordBlockedDayShadowScan(');
      expect(recorderSrc).toContain('export async function recordPreflightUniverseLearningSnapshot(');
      expect(recorderSrc).toContain('ADR-0183');
    });
  });

  describe('SSOT 헬퍼 안전 invariant', () => {
    it('ENV gate default ON helper guard (isShadowLearningOnBlockedDaysEnabled 호출)', () => {
      const helperBody = recorderSrc.split('export async function recordBlockedDayShadowScan')[1];
      expect(helperBody).toBeDefined();
      const headBody = helperBody!.slice(0, 600);
      expect(headBody).toContain('isShadowLearningOnBlockedDaysEnabled()');
      expect(headBody).toContain('return;');
    });

    it('try/catch 격리 (scan throw → 매매 흐름 차단 차단)', () => {
      const helperBody = recorderSrc.split('export async function recordBlockedDayShadowScan')[1];
      const headBody = helperBody!.slice(0, 1000);
      expect(headBody).toContain('try {');
      expect(headBody).toContain('catch (e)');
      expect(headBody).toContain('console.warn');
    });

    it('runShadowLearningOnlyScan 호출 — allowRealOrder=false literal', () => {
      const helperBody = recorderSrc.split('export async function recordBlockedDayShadowScan')[1];
      const headBody = helperBody!.slice(0, 1000);
      expect(headBody).toContain('runShadowLearningOnlyScan({');
      expect(headBody).toContain('allowRealOrder: false');
    });

    it('bypassMacroEntryBlock=true 명시 (의도 명문화)', () => {
      const helperBody = recorderSrc.split('export async function recordBlockedDayShadowScan')[1];
      const headBody = helperBody!.slice(0, 1000);
      expect(headBody).toContain('bypassMacroEntryBlock: true');
    });

    it('KST scanDate 산출 (UTC+9 offset)', () => {
      const helperBody = recorderSrc.split('export async function recordBlockedDayShadowScan')[1];
      const headBody = helperBody!.slice(0, 1000);
      expect(headBody).toContain('9 * 60 * 60 * 1000');
      expect(headBody).toContain('.toISOString()');
      expect(headBody).toContain('.slice(0, 10)');
    });
  });

  describe('Always-On early-return site wiring 정합', () => {
    it('SELL_ONLY → MANUAL_BLOCK', () => {
      expect(src).toContain("recordBlockedDayShadowScan('MANUAL_BLOCK')");
    });

    it('R6_DEFENSE → RISK_OFF_REGIME', () => {
      expect(src).toContain("recordBlockedDayShadowScan('RISK_OFF_REGIME')");
    });

    it('VIX 게이팅 → VIX_SPIKE', () => {
      expect(src).toContain("recordBlockedDayShadowScan('VIX_SPIKE')");
    });

    it('FOMC 게이팅 → FOMC_BLOCK', () => {
      expect(src).toContain("recordBlockedDayShadowScan('FOMC_BLOCK')");
    });

    it('호출 site 수는 최소 11개 이상 — exact-count drift 방지', () => {
      const matches = src.match(/recordBlockedDayShadowScan\(['"]/g);
      expect(matches).toBeDefined();
      expect(matches!.length).toBeGreaterThanOrEqual(11);
    });

    it('Always-On 핵심 차단 사유 wiring 포함', () => {
      const reasons = shadowLearningReasonsFromPreflight();
      expect(reasons).toEqual(
        expect.arrayContaining([
          'KIS_CONFIG_MISSING',
          'WATCHLIST_EMPTY',
          'MANUAL_BLOCK',
          'RISK_OFF_REGIME',
          'VIX_SPIKE',
          'FOMC_BLOCK',
          'DATA_STARVED',
          'POSITION_FULL',
          'VOLUME_CLOCK_BLOCK',
          'R3_SANITY_BLOCK',
        ]),
      );
    });

    it('reserved/low-frequency reason은 union에서 허용하되 preflight direct wiring 강제 대상이 아니다', () => {
      const shadowSrc = fs.readFileSync(
        path.resolve(__dirname, 'shadowLearningOnlyScan.ts'),
        'utf-8',
      );
      for (const reason of ['LIQUIDITY_BLOCK', 'KRX_HOLIDAY_REPLAY', 'R1_DEFENSIVE', 'R0_CRISIS', 'SECTOR_ENERGY_STALE', 'SUPPLY_DATA_UNSTABLE']) {
        expect(shadowSrc).toContain(`| '${reason}'`);
      }
    });
  });

  describe('LIVE 매매 본체 — diagnostic-only marker 보존 (P3/P4 isolation 정합)', () => {
    it('SELL_ONLY early-return 직전 호출 (await updateShadowResults 위에)', () => {
      // SELL_ONLY 만 자체 early-return 보유 — wiring 위치 정합
      const sellOnlyBlock = src.split("recordBlockedDayShadowScan('MANUAL_BLOCK')")[1];
      expect(sellOnlyBlock).toBeDefined();
      const next200 = sellOnlyBlock!.slice(0, 1400);
      expect(next200).toContain('await updateShadowResults(shadows, regime)');
      expect(next200).toContain('saveShadowTrades(shadows)');
      // ADR-0367/0433: context: diagnosticContext(...) 옵셔널 인자 허용 (runtime shape 동일)
      expect(next200).toMatch(
        /return \{ shouldAbort: true, skipPersist: true(\s*,\s*context:\s*diagnosticContext\(|\s*\})/,
      );
    });

    it('R6_DEFENSE diagnostic-only marker (자체 early-return 없음 — 후속 분기로 위임)', () => {
      // ADR-0183 Phase 3 Stage A + P3/P4 isolation:
      // R6_DEFENSE 는 diagnostic-only — 자체 updateShadowResults / early-return 없음
      // recordBlockedDayShadowScan('RISK_OFF_REGIME') 직전에 diagnostic-only 마커 코멘트 보존
      const splitParts = src.split("recordBlockedDayShadowScan('RISK_OFF_REGIME')");
      expect(splitParts.length).toBe(2);
      const beforeCall = splitParts[0]!.slice(-600);
      expect(beforeCall).toContain('R6_DEFENSE diagnostic-only live block active; continuing scan diagnostics');
    });

    it('VIX diagnostic-only marker (자체 early-return 없음 — 후속 분기로 위임)', () => {
      // ADR-0183 Phase 3 Stage A + P3/P4 isolation:
      // VIX_BLOCK 은 diagnostic-only — 자체 updateShadowResults / early-return 없음
      const splitParts = src.split("recordBlockedDayShadowScan('VIX_SPIKE')");
      expect(splitParts.length).toBe(2);
      const beforeCall = splitParts[0]!.slice(-600);
      expect(beforeCall).toContain('VIX_BLOCK diagnostic-only live block active; continuing scan diagnostics');
    });

    it('FOMC diagnostic-only marker (자체 early-return 없음 — 후속 분기로 위임)', () => {
      // ADR-0183 Phase 3 Stage A + P3/P4 isolation:
      // FOMC_BLOCK 은 diagnostic-only — 자체 updateShadowResults / early-return 없음
      const splitParts = src.split("recordBlockedDayShadowScan('FOMC_BLOCK')");
      expect(splitParts.length).toBe(2);
      const beforeCall = splitParts[0]!.slice(-600);
      expect(beforeCall).toContain('FOMC_BLOCK diagnostic-only live block active; continuing scan diagnostics');
    });
  });

  describe('회귀 가드 — 호출자 측 ENV 검사 부재 (SSOT 단일 위치 보장)', () => {
    it('호출자 (early-return 위치) 에 isShadowLearningOnBlockedDaysEnabled 직접 호출 0건', () => {
      const callMatches = src.match(/recordBlockedDayShadowScan\(['"][^'"]+['"]\)/g);
      expect(callMatches).toBeDefined();
      for (const call of callMatches!) {
        const idx = src.indexOf(call);
        const before = src.slice(Math.max(0, idx - 200), idx);
        expect(before).not.toContain('isShadowLearningOnBlockedDaysEnabled()');
      }
    });

    it('호출자 측 try/catch 부재 (SSOT 헬퍼 안 격리)', () => {
      const callMatches = src.match(/recordBlockedDayShadowScan\(['"][^'"]+['"]\)/g);
      for (const call of callMatches!) {
        const idx = src.indexOf(call);
        const before = src.slice(Math.max(0, idx - 100), idx);
        expect(before.trim().endsWith('await')).toBe(true);
      }
    });
  });

  describe('KIS 주문 함수 import 0건 (절대 규칙 #2 준수)', () => {
    it('preflight.ts와 preflightLearningRecorder.ts가 KIS 주문 함수 import 0건', () => {
      const importBlock = [importBlockFrom(src), importBlockFrom(recorderSrc)].join('\n');
      const KIS_ORDER_FNS = [
        'placeKisMarketOrder',
        'placeKisMarketBuyOrder',
        'placeKisSellOrder',
        'cancelKisOrder',
        'placeKisStopLossOrder',
        'placeKisTakeProfitOrder',
      ];
      for (const fn of KIS_ORDER_FNS) {
        expect(importBlock).not.toContain(fn);
      }
    });
  });
});
