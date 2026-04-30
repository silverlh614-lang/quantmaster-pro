// @responsibility ADR-0115 perSymbolEvaluation wiring 회귀 가드 (정적 grep 검증)
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TARGET_FILE = path.resolve(__dirname, 'perSymbolEvaluation.ts');

function readSource(): string {
  return fs.readFileSync(TARGET_FILE, 'utf-8');
}

describe('ADR-0115 perSymbolEvaluation wiring — 정적 회귀 가드', () => {
  describe('failureClassifier import 정착', () => {
    it('shouldIncrementFailCount import', () => {
      const src = readSource();
      expect(src).toMatch(/import\s*\{[^}]*shouldIncrementFailCount[^}]*\}\s*from\s*['"]\.\/failureClassifier\.js['"]/);
    });

    it('isEntryPriceAutoCorrectDisabled import', () => {
      const src = readSource();
      expect(src).toMatch(/isEntryPriceAutoCorrectDisabled/);
    });

    it('isPreBreakoutFailCountDisabled import (또는 shouldIncrementFailCount 단독 사용 OK)', () => {
      const src = readSource();
      // shouldIncrementFailCount 가 내부에서 isPreBreakoutFailCountDisabled 사용하므로 둘 중 하나 import 충분
      expect(src).toMatch(/(isPreBreakoutFailCountDisabled|shouldIncrementFailCount)/);
    });
  });

  describe('CORPORATE_ACTION 분기 — entryPrice 자동 재설정 *제거* (ADR-0115 P0 #1)', () => {
    it('isEntryPriceAutoCorrectDisabled 분기 사용', () => {
      const src = readSource();
      expect(src).toMatch(/isEntryPriceAutoCorrectDisabled\(\)/);
    });

    it('CORPORATE_ACTION_REMOVE stageLog 신규 사용 (universe 제외)', () => {
      const src = readSource();
      expect(src).toContain("'CORPORATE_ACTION_REMOVE'");
    });

    it('RAW immutable 정책 명문화 주석 존재', () => {
      const src = readSource();
      expect(src).toMatch(/RAW immutable/);
      expect(src).toMatch(/ADR-0115/);
    });

    it('정책 활성 (default) 분기에서 stock.entryPrice = currentPrice 미사용', () => {
      const src = readSource();
      // 본 정책 분기 (isEntryPriceAutoCorrectDisabled 안) 에서는 entryPrice 자동 재설정 없어야 함.
      // 레거시 분기 (else) 에서는 그대로 보존.
      // 정책 분기 위치 추출 후 그 안에 entryPrice 재설정 패턴 부재 검증.
      const policyMatch = src.match(/if \(isEntryPriceAutoCorrectDisabled\(\)\) \{([\s\S]*?)\} else \{/);
      expect(policyMatch).not.toBeNull();
      const policyBlock = policyMatch![1];
      // 정책 분기에 stock.entryPrice = ... 할당 없어야 함
      expect(policyBlock).not.toMatch(/stock\.entryPrice\s*=\s*currentPrice/);
      expect(policyBlock).not.toMatch(/stock\.corporateActionAdjusted\s*=\s*true/);
    });

    it('레거시 분기 (else) 에는 ADR-0113 동작 보존 (호환성)', () => {
      const src = readSource();
      const elseMatch = src.match(/\} else \{[\s\S]*?stock\.entryPrice\s*=\s*currentPrice/);
      expect(elseMatch).not.toBeNull();
    });

    it('진단 텔레그램 dedupeKey 정합성 (corp_action_immutable / corp_action 모두 사용)', () => {
      const src = readSource();
      expect(src).toMatch(/corp_action_immutable:/);
      expect(src).toMatch(/corp_action:/);
    });

    it('정책 분기에서 universe 제외 동작 (watchlist splice)', () => {
      const src = readSource();
      const policyBlock = src.match(/if \(isEntryPriceAutoCorrectDisabled\(\)\) \{([\s\S]*?)\} else \{/)![1];
      expect(policyBlock).toMatch(/ctx\.watchlist\.splice/);
    });
  });

  describe('pre-breakout WAIT 분기 — failCount Critical-only (ADR-0115 P1 #4)', () => {
    it('shouldIncrementFailCount 호출이 PRE_BREAKOUT_MISS 분기에 적용', () => {
      const src = readSource();
      expect(src).toMatch(/shouldIncrementFailCount\(['"]PRE_BREAKOUT_MISS['"]\)/);
    });

    it('shouldIncrementFailCount 호출이 ENTRY_PRICE_DEVIATION 분기에 적용', () => {
      const src = readSource();
      expect(src).toMatch(/shouldIncrementFailCount\(['"]ENTRY_PRICE_DEVIATION['"]\)/);
    });

    it('shouldIncrementFailCount 호출이 GATE_REVALIDATION_FAIL 분기에 적용', () => {
      const src = readSource();
      expect(src).toMatch(/shouldIncrementFailCount\(['"]GATE_REVALIDATION_FAIL['"]\)/);
    });

    it('"WAIT" 메시지 출력 — pre-breakout 분기', () => {
      const src = readSource();
      expect(src).toMatch(/WAIT.*ADR-0115|ADR-0115.*WAIT/);
    });

    it('레거시 분기 (else) 보존 — failCount 증가 가능', () => {
      const src = readSource();
      // shouldIncrementFailCount 가 false 일 때 (정책 적용) 단순 console.log 만 있고 entryFailCount 증가 없어야 함
      // 정책+레거시 둘 다 가능하도록 if/else 분기 검증
      const preBreakoutCount = (src.match(/shouldIncrementFailCount\(/g) ?? []).length;
      expect(preBreakoutCount).toBeGreaterThanOrEqual(3);
    });
  });
});

describe('ADR-0115 1차 로그 시뮬 가드 — 098460 / 336260 시나리오', () => {
  it('정책 적용 default — entryPrice 자동 재설정 없음 (RAW immutable)', () => {
    // 사용자 절대 원칙 검증 — default 정책 분기에는 stock.entryPrice 할당 없어야 함.
    // 위 정책 분기 검증과 중복이지만 명시적으로 1차 로그 시나리오에 매핑.
    const src = readSource();
    const policyMatch = src.match(/if \(isEntryPriceAutoCorrectDisabled\(\)\) \{([\s\S]*?)\} else \{/);
    expect(policyMatch).not.toBeNull();
    const block = policyMatch![1];

    // 098460 고영 (entryPrice=12,610 → currentPrice=40,500) 시나리오:
    //   ADR-0113: entryPrice = 40,500 자동 보정
    //   ADR-0115: entryPrice = 12,610 보존 + universe 제외
    expect(block).not.toMatch(/stock\.entryPrice\s*=/);
  });
});
