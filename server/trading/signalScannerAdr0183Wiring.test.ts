/**
 * @responsibility ADR-0183 Phase 3 Stage A — signalScanner 4 early-return Shadow learning wiring 회귀 테스트
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SCANNER_PATH = path.resolve(__dirname, 'signalScanner.ts');
const src = fs.readFileSync(SCANNER_PATH, 'utf-8');

describe('ADR-0183 Phase 3 Stage A — Shadow learning wiring 정적 가드', () => {
  describe('SSOT 헬퍼 import + 정의', () => {
    it('isShadowLearningOnBlockedDaysEnabled / runShadowLearningOnlyScan import', () => {
      expect(src).toContain("from './shadowLearningOnlyScan.js'");
      expect(src).toMatch(/isShadowLearningOnBlockedDaysEnabled[\s,]/);
      expect(src).toMatch(/runShadowLearningOnlyScan[\s,]/);
    });

    it('ShadowLearningOnlyScanReason type-only import', () => {
      expect(src).toContain('type ShadowLearningOnlyScanReason');
    });

    it('recordBlockedDayShadowScan SSOT 헬퍼 정의', () => {
      expect(src).toContain('async function recordBlockedDayShadowScan(');
      expect(src).toContain('reason: ShadowLearningOnlyScanReason');
    });

    it('ADR-0183 주석 명시 (helper 헤더)', () => {
      expect(src).toContain('ADR-0183');
    });
  });

  describe('SSOT 헬퍼 안전 invariant', () => {
    it('ENV gate default OFF (isShadowLearningOnBlockedDaysEnabled 호출)', () => {
      // helper 본체 안에서 ENV 검사 (호출자 인라인 ENV 검사 금지 — drift 차단)
      const helperBody = src.split('async function recordBlockedDayShadowScan')[1];
      expect(helperBody).toBeDefined();
      const headBody = helperBody!.slice(0, 600);
      expect(headBody).toContain('isShadowLearningOnBlockedDaysEnabled()');
      expect(headBody).toContain('return;');  // ENV OFF 시 즉시 return
    });

    it('try/catch 격리 (scan throw → 매매 흐름 차단 차단)', () => {
      const helperBody = src.split('async function recordBlockedDayShadowScan')[1];
      const headBody = helperBody!.slice(0, 1000);
      expect(headBody).toContain('try {');
      expect(headBody).toContain('catch (e)');
      expect(headBody).toContain('console.warn');
    });

    it('runShadowLearningOnlyScan 호출 — allowRealOrder=false literal', () => {
      const helperBody = src.split('async function recordBlockedDayShadowScan')[1];
      const headBody = helperBody!.slice(0, 1000);
      expect(headBody).toContain('runShadowLearningOnlyScan({');
      expect(headBody).toContain('allowRealOrder: false');
    });

    it('bypassMacroEntryBlock=true 명시 (의도 명문화)', () => {
      const helperBody = src.split('async function recordBlockedDayShadowScan')[1];
      const headBody = helperBody!.slice(0, 1000);
      expect(headBody).toContain('bypassMacroEntryBlock: true');
    });

    it('KST scanDate 산출 (UTC+9 offset)', () => {
      const helperBody = src.split('async function recordBlockedDayShadowScan')[1];
      const headBody = helperBody!.slice(0, 1000);
      expect(headBody).toContain('9 * 60 * 60 * 1000');
      expect(headBody).toContain('.toISOString().slice(0, 10)');
    });
  });

  describe('4 early-return site wiring 정합', () => {
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

    it('정확 4 호출 site (호출 수 정확)', () => {
      const matches = src.match(/recordBlockedDayShadowScan\(['"]/g);
      expect(matches).toBeDefined();
      expect(matches!.length).toBe(4);
    });

    it('데이터 빈곤 site 제외 (DATA_*, LIQUIDITY_BLOCK 미사용)', () => {
      // ADR-0183 §2.1 — 데이터 빈곤 site 는 신뢰성 부재 라 제외
      // signalScanner 파일 안의 recordBlockedDayShadowScan 호출에 DATA/LIQUIDITY 사용 차단
      const callMatches = src.match(/recordBlockedDayShadowScan\(['"]([^'"]+)['"]\)/g);
      expect(callMatches).toBeDefined();
      const reasons = callMatches!.map((m) => m.match(/['"]([^'"]+)['"]/)![1]);
      expect(reasons).toEqual(
        expect.arrayContaining(['MANUAL_BLOCK', 'RISK_OFF_REGIME', 'VIX_SPIKE', 'FOMC_BLOCK']),
      );
      expect(reasons).not.toContain('LIQUIDITY_BLOCK');
      expect(reasons).not.toContain('KRX_HOLIDAY_REPLAY');
    });
  });

  describe('LIVE 매매 본체 0줄 변경 (early-return 구조 보존)', () => {
    it('SELL_ONLY early-return 직전 호출 (await updateShadowResults 위에)', () => {
      // wiring 위치 정합 — recordBlockedDayShadowScan 직후 await updateShadowResults
      const sellOnlyBlock = src.split("recordBlockedDayShadowScan('MANUAL_BLOCK')")[1];
      expect(sellOnlyBlock).toBeDefined();
      const next200 = sellOnlyBlock!.slice(0, 200);
      expect(next200).toContain('await updateShadowResults(shadows, regime)');
      expect(next200).toContain('saveShadowTrades(shadows)');
      expect(next200).toContain('return {}');
    });

    it('R6_DEFENSE early-return 직전 호출', () => {
      const r6Block = src.split("recordBlockedDayShadowScan('RISK_OFF_REGIME')")[1];
      const next200 = r6Block!.slice(0, 200);
      expect(next200).toContain('await updateShadowResults(shadows, regime)');
      expect(next200).toContain('return {}');
    });

    it('VIX early-return 직전 호출', () => {
      const vixBlock = src.split("recordBlockedDayShadowScan('VIX_SPIKE')")[1];
      const next200 = vixBlock!.slice(0, 200);
      expect(next200).toContain('await updateShadowResults(shadows, regime)');
      expect(next200).toContain('return {}');
    });

    it('FOMC early-return 직전 호출', () => {
      const fomcBlock = src.split("recordBlockedDayShadowScan('FOMC_BLOCK')")[1];
      const next200 = fomcBlock!.slice(0, 200);
      expect(next200).toContain('await updateShadowResults(shadows, regime)');
      expect(next200).toContain('return {}');
    });
  });

  describe('회귀 가드 — 호출자 측 ENV 검사 부재 (SSOT 단일 위치 보장)', () => {
    it('호출자 (early-return 위치) 에 isShadowLearningOnBlockedDaysEnabled 직접 호출 0건', () => {
      // helper 본체에만 ENV 검사 — 호출자 인라인 검사 차단 (drift 차단)
      const callMatches = src.match(/recordBlockedDayShadowScan\(['"][^'"]+['"]\)/g);
      expect(callMatches).toBeDefined();
      // 각 호출 위치 직전 200 char 안에 isShadowLearningOnBlockedDaysEnabled 호출 부재
      for (const call of callMatches!) {
        const idx = src.indexOf(call);
        const before = src.slice(Math.max(0, idx - 200), idx);
        // ADR 주석에는 "isShadowLearningOnBlockedDaysEnabled" 단어가 *없어야* 함
        expect(before).not.toContain('isShadowLearningOnBlockedDaysEnabled()');
      }
    });

    it('호출자 측 try/catch 부재 (SSOT 헬퍼 안 격리)', () => {
      // wiring 패턴은 단순 `await recordBlockedDayShadowScan(...)` — 호출자 try/catch 부재
      const callMatches = src.match(/recordBlockedDayShadowScan\(['"][^'"]+['"]\)/g);
      for (const call of callMatches!) {
        const idx = src.indexOf(call);
        const before = src.slice(Math.max(0, idx - 100), idx);
        expect(before.trim().endsWith('await')).toBe(true);
      }
    });
  });

  describe('KIS 주문 함수 import 0건 (절대 규칙 #2 준수)', () => {
    it('runShadowLearningOnlyScan 본체가 KIS 주문 함수 import 0건 (Phase 1 SSOT 안전 invariant 자동 상속)', () => {
      const shadowSrc = fs.readFileSync(
        path.resolve(__dirname, 'shadowLearningOnlyScan.ts'),
        'utf-8',
      );
      // 주석/문자열 안 occurrence 는 허용 (ADR 설명용) — 실제 *import statement* 만 차단
      // import 줄 패턴: `import {...} from '...'` 또는 `from '../clients/kisClient*'`
      const importLines = shadowSrc
        .split('\n')
        .filter((line) => /^\s*import\b/.test(line) || /\bfrom\s+['"]/.test(line));
      const importBlock = importLines.join('\n');
      const KIS_ORDER_FNS = [
        'placeKisMarketOrder',
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
