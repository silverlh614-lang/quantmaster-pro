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

  describe('Always-On hard-block early-return site wiring 정합', () => {
    // [always-on cleanup 정합] SELL_ONLY / R6_DEFENSE / VIX / FOMC 는 always-on 전환
    // (3e7ca19 "remove time-of-day SELL_ONLY plumbing", REMOVED_POLICY_INPUT_IGNORED,
    //  rollback='SELL_ONLY_AND_R6_EXECUTION_DISABLED') 으로 *자체 early-return 폐지* →
    //  매크로 상태가 더 이상 스캔을 차단하지 않으므로 별도 blocked-day shadow scan 미기록.
    //  따라서 과거 MANUAL_BLOCK / RISK_OFF_REGIME / VIX_SPIKE / FOMC_BLOCK direct-wiring
    //  + "≥11 site" 카운트 + diagnostic-only marker 코멘트 가드는 *제거됐다*(아래 4개 it):
    //    - 'SELL_ONLY → MANUAL_BLOCK' / 'R6_DEFENSE → RISK_OFF_REGIME' /
    //      'VIX → VIX_SPIKE' / 'FOMC → FOMC_BLOCK' / '호출 site ≥11' / diagnostic-only marker 4건
    //  사유: 런타임에서 삭제된 동작을 assert 하는 stale 가드 → behavioral 의미 없음.
    //  잔존 *진짜 hard-block early-return* 5개 reason 만 동작 가드로 보존한다.

    it('genuine hard-block reason 만 preflight 가 직접 wiring (always-on 잔존 차단 사유)', () => {
      const reasons = new Set(shadowLearningReasonsFromPreflight());
      // 잔존 hard-block early-return — KIS 설정/워치리스트/데이터/포지션/R3-latch 만 스캔 차단.
      expect(reasons).toEqual(
        new Set([
          'KIS_CONFIG_MISSING',
          'WATCHLIST_EMPTY',
          'DATA_STARVED',
          'POSITION_FULL',
          'R3_SANITY_BLOCK',
        ]),
      );
      // always-on 으로 폐지된 매크로 reason 은 더 이상 preflight direct-wiring 되지 않음.
      for (const removed of ['MANUAL_BLOCK', 'RISK_OFF_REGIME', 'VIX_SPIKE', 'FOMC_BLOCK']) {
        expect(reasons.has(removed)).toBe(false);
      }
    });

    it('hard-block reason 은 ShadowLearningOnlyScanReason union 에 모두 등재 (타입 정합)', () => {
      const shadowSrc = fs.readFileSync(
        path.resolve(__dirname, 'shadowLearningOnlyScan.ts'),
        'utf-8',
      );
      for (const reason of shadowLearningReasonsFromPreflight()) {
        expect(shadowSrc).toContain(`'${reason}'`);
      }
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

  describe('LIVE 매매 본체 — hard-block early-return shadow 영속 정합', () => {
    it('POSITION_FULL hard-block early-return 직전 updateShadowResults + saveShadowTrades 보존', () => {
      // 잔존 hard-block(POSITION_FULL) 은 자체 early-return 으로 스캔 종료 전 shadow 결과 영속.
      // ABORT variant(POSITION_FULL_PREFLIGHT_ABORT='true') 의 early-return 직전 영속 보존.
      const block = src.split("recordBlockedDayShadowScan('POSITION_FULL')").pop();
      expect(block).toBeDefined();
      const next1400 = block!.slice(0, 1400);
      expect(next1400).toContain('await updateShadowResults(shadows, regime)');
      expect(next1400).toContain('saveShadowTrades(shadows)');
      // early-return 이 shouldAbort + skipPersist + diagnosticContext 로 스캔 종료 (shadow 학습 미차단).
      expect(next1400).toContain('shouldAbort: true');
      expect(next1400).toContain('skipPersist: true');
      expect(next1400).toContain('context: diagnosticContext(');
      // ADR-0183 P3/P4: shadow learning early-return 으로 차단되지 않음 (false).
      expect(next1400).toContain('shouldAbortShadowLearning: false');
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
