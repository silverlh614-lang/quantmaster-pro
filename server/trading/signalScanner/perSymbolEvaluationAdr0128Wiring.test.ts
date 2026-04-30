// @responsibility ADR-0128 perSymbolEvaluation verifyStockIncremental + resolveDataHoldAction wiring 정적 회귀 가드
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

describe('ADR-0128 §Wiring 1A — verifyStockIncremental BUY_CANDIDATE 4 site wiring', () => {
  it('verifyStockIncremental import 존재', () => {
    const src = readSource();
    expect(src).toMatch(/import\s*\{\s*verifyStockIncremental\s*\}\s*from\s*['"]\.\.\/\.\.\/data\/dataVerificationIncremental\.js['"]/);
  });

  it('site 1 — _signalTimeFollow 직전 verifyStockIncremental("...", "BUY_CANDIDATE") 호출', () => {
    const src = readSource();
    // _verifyResultFollow 변수명 + BUY_CANDIDATE role + _signalTimeFollow 변수 인접
    expect(src).toMatch(/verifyStockIncremental\(stock\.code,\s*['"]BUY_CANDIDATE['"]\)[\s\S]*?_signalTimeFollow/);
  });

  it('site 2 — _signalTimePb 직전 verifyStockIncremental("...", "BUY_CANDIDATE") 호출', () => {
    const src = readSource();
    expect(src).toMatch(/verifyStockIncremental\(stock\.code,\s*['"]BUY_CANDIDATE['"]\)[\s\S]*?_signalTimePb/);
  });

  it('site 3 — _signalTimeMain 직전 verifyStockIncremental("...", "BUY_CANDIDATE") 호출', () => {
    const src = readSource();
    expect(src).toMatch(/verifyStockIncremental\(stock\.code,\s*['"]BUY_CANDIDATE['"]\)[\s\S]*?_signalTimeMain/);
  });

  it('site 4 — _signalTimeIntra 직전 verifyStockIncremental("...", "BUY_CANDIDATE") 호출', () => {
    const src = readSource();
    expect(src).toMatch(/verifyStockIncremental\(stock\.code,\s*['"]BUY_CANDIDATE['"]\)[\s\S]*?_signalTimeIntra/);
  });

  it('verify 호출 4건 모두 try/catch 격리 패턴 적용 (안전 통과 메시지 포함)', () => {
    const src = readSource();
    const safePassMatches = src.match(/verifyStockIncremental error \(안전 통과\)/g) ?? [];
    expect(safePassMatches.length).toBeGreaterThanOrEqual(4);
  });

  it('verify 실패 시 → DATA_HOLD console.log + continue 분기 적용', () => {
    const src = readSource();
    expect(src).toMatch(/→ DATA_HOLD \/ \$\{[^}]+\.reason\} \/ \$\{[^}]+\.source\}/);
    // _verifyOk* 변수명 + continue 패턴
    expect(src).toMatch(/if\s*\(!_verifyOk[A-Z][a-zA-Z]*\)\s*continue/);
  });

  it('action.blockBuy 분기 검사 — verified=false + blockBuy=true 시에만 차단', () => {
    const src = readSource();
    // .verified 와 .action?.blockBuy 두 조건 AND
    const blockBuyMatches = src.match(/!\w+\.verified && \w+\.action\?\.blockBuy/g) ?? [];
    expect(blockBuyMatches.length).toBeGreaterThanOrEqual(4);
  });
});

describe('ADR-0128 §Wiring 2 — DATA_HOLD 분기 resolveDataHoldAction(BUY_CANDIDATE) 위임', () => {
  it('resolveDataHoldAction import 존재', () => {
    const src = readSource();
    expect(src).toMatch(/import\s*\{\s*resolveDataHoldAction\s*\}\s*from\s*['"]\.\.\/\.\.\/data\/dataHoldRolePolicy\.js['"]/);
  });

  it("driftAction === 'DATA_HOLD' 분기에서 resolveDataHoldAction('BUY_CANDIDATE') 호출", () => {
    const src = readSource();
    expect(src).toMatch(/if\s*\(\s*driftAction\s*===\s*['"]DATA_HOLD['"]/);
    expect(src).toMatch(/resolveDataHoldAction\(['"]BUY_CANDIDATE['"]\)/);
  });

  it('action.reason 메시지 SSOT 정합 — WAIT / DATA_HOLD / ${action.reason}', () => {
    const src = readSource();
    expect(src).toMatch(/→ WAIT \/ DATA_HOLD \/ \$\{action\.reason\}/);
  });

  it('action.blockBuy 분기 — true 시에만 isDataQuarantined+dataQuality 영속', () => {
    const src = readSource();
    // if (action.blockBuy) { ... isDataQuarantined ... } 패턴
    expect(src).toMatch(/if\s*\(action\.blockBuy\)\s*\{[\s\S]*?stock\.isDataQuarantined\s*=\s*true/);
  });
});

describe('ADR-0128 회귀 가드 — HELD_POSITION 미사용 + exit 본체 보존', () => {
  it('perSymbolEvaluation 본체에 HELD_POSITION role 호출 0건 (매수 평가 영역, exitEngine 책임 분리)', () => {
    const src = readSource();
    expect(src).not.toMatch(/HELD_POSITION/);
  });

  it("verifyStockIncremental 호출은 모두 'BUY_CANDIDATE' role — 다른 role 사용 0건", () => {
    const src = readSource();
    const allRoleMatches = src.match(/verifyStockIncremental\([^,]+,\s*['"]([^'"]+)['"]/g) ?? [];
    for (const m of allRoleMatches) {
      expect(m).toMatch(/BUY_CANDIDATE/);
    }
  });

  it('try/catch 격리 — verify error 가 매매 흐름 차단 안 함 (console.warn 만)', () => {
    const src = readSource();
    expect(src).toMatch(/console\.warn\(`\[AutoTrade\] verifyStockIncremental error \(안전 통과\)/);
  });
});

describe('ADR-0128 ENV 회로 — VERIFICATION_QUEUE_DISABLED safe default', () => {
  it("verifyStockIncremental 호출자가 process.env 직접 접근 안 함 — SSOT (verifyStockIncremental 본체) 책임", () => {
    // 호출자(perSymbolEvaluation)는 process.env.VERIFICATION_QUEUE_DISABLED 직접 검사 안 함 — SSOT 위임 보장.
    const src = readSource();
    expect(src).not.toMatch(/process\.env\.VERIFICATION_QUEUE_DISABLED/);
  });

  it("DATA_HOLD_ROLE_POLICY_DISABLED process.env 직접 접근 0건 — resolveDataHoldAction 본체 책임", () => {
    const src = readSource();
    expect(src).not.toMatch(/process\.env\.DATA_HOLD_ROLE_POLICY_DISABLED/);
  });
});
