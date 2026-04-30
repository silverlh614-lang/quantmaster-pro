/**
 * @responsibility PR-3+ 6 청산 규칙 emitFullCloseAttributionForExit wiring 정적 가드
 *
 * PR-3 4 규칙 (hardStopLoss / legacyTakeProfit / cascadeFinal / ma60DeathForceExit)
 * + PR-Fix-Attribution-FullClose 추가 2 규칙 (trailingStop / trancheTakeProfitLimit).
 *
 * r6EmergencyExit 는 30% 부분매도 로 PARTIAL 경로만, FullClose wiring 생략.
 * cascadeHalf / entryCircuitBreaker 도 부분매도 (50%) 라 wiring 생략.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const RULES_DIR = path.resolve(__dirname, '..');

function readRule(name: string): string {
  return fs.readFileSync(path.join(RULES_DIR, name), 'utf-8');
}

describe('PR-3+ 6 청산 규칙 emitFullCloseAttributionForExit wiring (정적 가드)', () => {
  // PR-3 (4 규칙) + PR-Fix-Attribution-FullClose (2 규칙)
  const wiredRules = [
    'hardStopLoss.ts',
    'legacyTakeProfit.ts',
    'cascadeFinal.ts',
    'ma60DeathForceExit.ts',
    'trailingStop.ts',
    'trancheTakeProfitLimit.ts',
  ];

  describe.each(wiredRules)('%s', (ruleFile) => {
    const source = readRule(ruleFile);

    it('emitFullCloseAttributionForExit import 존재', () => {
      expect(source).toMatch(
        /import\s*\{\s*emitFullCloseAttributionForExit\s*\}\s*from\s*['"]\.\.\/helpers\/attribution\.js['"]/,
      );
    });

    it('emitFullCloseAttributionForExit 호출 정확히 1건', () => {
      const matches = source.match(/emitFullCloseAttributionForExit\s*\(/g) ?? [];
      // import line 도 매치 — 호출만 카운트하기 위해 import 제거 후 검색.
      const noImport = source.replace(/import\s*\{[^}]*emitFullCloseAttributionForExit[^}]*\}[^;]*;/g, '');
      const callMatches = noImport.match(/emitFullCloseAttributionForExit\s*\(/g) ?? [];
      expect(callMatches.length).toBe(1);
    });

    it('try/catch 격리 wiring (매매 흐름 무중단 보장)', () => {
      // try { emitFullCloseAttributionForExit(...) } catch (e) { console.warn(...) }
      expect(source).toMatch(/try\s*\{[\s\S]*?emitFullCloseAttributionForExit\s*\(/);
      expect(source).toMatch(/catch\s*\([^)]*\)\s*\{[\s\S]*?console\.warn/);
    });

    it('ADR-0006 주석 마커 존재 (PR-3 또는 PR-Fix-Attribution-FullClose)', () => {
      expect(source).toMatch(
        /(PR-3\s*\(ADR-0006\))|(PR-Fix-Attribution-FullClose\s*\(ADR-0006\))/,
      );
    });

    it('updateShadow 후 try { emitFullCloseAttributionForExit 위치 정합', () => {
      // 모든 wired 규칙은 updateShadow 호출 직후 (또는 가까이) emitFullClose 호출.
      expect(source).toMatch(
        /updateShadow\([\s\S]*?\}\)\s*;[\s\S]{0,800}?try\s*\{[\s\S]*?emitFullCloseAttributionForExit/,
      );
    });

    it('호출 인자 — shadow / exitPrice / returnPct / closedAt / exitRuleTag 5종 모두', () => {
      const callMatch = source.match(/emitFullCloseAttributionForExit\s*\(\s*\{([\s\S]*?)\}\s*\)/);
      expect(callMatch).not.toBeNull();
      const args = callMatch![1];
      expect(args).toMatch(/shadow/);
      expect(args).toMatch(/exitPrice:\s*currentPrice/);
      expect(args).toMatch(/returnPct/);
      expect(args).toMatch(/closedAt:/);
      expect(args).toMatch(/exitRuleTag:/);
    });
  });

  describe('exitRuleTag 정합', () => {
    it('hardStopLoss → "HARD_STOP"', () => {
      expect(readRule('hardStopLoss.ts')).toMatch(/exitRuleTag:\s*['"]HARD_STOP['"]/);
    });
    it('legacyTakeProfit → "TARGET_EXIT"', () => {
      expect(readRule('legacyTakeProfit.ts')).toMatch(/exitRuleTag:\s*['"]TARGET_EXIT['"]/);
    });
    it('cascadeFinal → "CASCADE_FINAL"', () => {
      expect(readRule('cascadeFinal.ts')).toMatch(/exitRuleTag:\s*['"]CASCADE_FINAL['"]/);
    });
    it('ma60DeathForceExit → "MA60_DEATH_FORCE_EXIT"', () => {
      expect(readRule('ma60DeathForceExit.ts')).toMatch(/exitRuleTag:\s*['"]MA60_DEATH_FORCE_EXIT['"]/);
    });
    it('trailingStop → "TRAILING_PROTECTIVE_STOP"', () => {
      expect(readRule('trailingStop.ts')).toMatch(/exitRuleTag:\s*['"]TRAILING_PROTECTIVE_STOP['"]/);
    });
    it('trancheTakeProfitLimit → "LIMIT_TRANCHE_TAKE_PROFIT"', () => {
      expect(readRule('trancheTakeProfitLimit.ts')).toMatch(/exitRuleTag:\s*['"]LIMIT_TRANCHE_TAKE_PROFIT['"]/);
    });
  });

  describe('회귀 차단', () => {
    it('r6EmergencyExit 는 wiring 미적용 (PARTIAL 200% 과대 계상 차단)', () => {
      const r6 = readRule('r6EmergencyExit.ts');
      expect(r6).not.toMatch(/emitFullCloseAttributionForExit/);
    });

    it('cascadeHalf 는 부분매도 (50%) 라 FullClose wiring 미적용', () => {
      const cascHalf = readRule('cascadeHalf.ts');
      expect(cascHalf).not.toMatch(/emitFullCloseAttributionForExit/);
    });

    it('entryCircuitBreaker 도 부분매도 (50%) 라 wiring 미적용', () => {
      const ecb = readRule('entryCircuitBreaker.ts');
      expect(ecb).not.toMatch(/emitFullCloseAttributionForExit/);
    });

    it('rrrCollapseExit 는 부분매도 (50%) 라 wiring 미적용', () => {
      const rrr = readRule('rrrCollapseExit.ts');
      expect(rrr).not.toMatch(/emitFullCloseAttributionForExit/);
    });

    it('bearishDivergenceExit 는 부분매도 (30%) 라 wiring 미적용', () => {
      const bd = readRule('bearishDivergenceExit.ts');
      expect(bd).not.toMatch(/emitFullCloseAttributionForExit/);
    });

    it('euphoriaPartialExit 는 부분매도 라 wiring 미적용', () => {
      const ep = readRule('euphoriaPartialExit.ts');
      expect(ep).not.toMatch(/emitFullCloseAttributionForExit/);
    });

    it('6 wired rules 외 청산 규칙은 wiring 부재 (의도된 보수적 범위)', () => {
      const allRuleFiles = fs.readdirSync(RULES_DIR).filter(f => f.endsWith('.ts'));
      const wiredCount = allRuleFiles.filter(f => {
        const src = fs.readFileSync(path.join(RULES_DIR, f), 'utf-8');
        return /emitFullCloseAttributionForExit\s*\(/.test(src.replace(/import[^;]*;/g, ''));
      }).length;
      expect(wiredCount).toBe(6); // hardStopLoss / legacyTakeProfit / cascadeFinal / ma60DeathForceExit / trailingStop / trancheTakeProfitLimit
    });
  });

  describe('PR-Fix-Attribution-FullClose 추가 wiring 시나리오 (정적 가드)', () => {
    it('trailingStop 은 trailReturnPct 변수 사용 (사용자 분기에서 재계산된 returnPct)', () => {
      const ts = readRule('trailingStop.ts');
      // trailReturnPct 가 emitFullCloseAttributionForExit 호출 인자에 사용됨
      expect(ts).toMatch(
        /emitFullCloseAttributionForExit\([\s\S]*?returnPct:\s*trailReturnPct/,
      );
    });

    it('trancheTakeProfitLimit 은 if (shadow.quantity <= 0) 분기 안에 wiring', () => {
      const tt = readRule('trancheTakeProfitLimit.ts');
      // if (shadow.quantity <= 0) { ... try { emitFullClose... } }
      expect(tt).toMatch(
        /if\s*\(\s*shadow\.quantity\s*<=\s*0\s*\)[\s\S]*?try\s*\{[\s\S]*?emitFullCloseAttributionForExit/,
      );
    });
  });
});
