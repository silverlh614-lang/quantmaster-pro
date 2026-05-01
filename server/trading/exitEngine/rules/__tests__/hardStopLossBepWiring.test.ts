// @responsibility ADR-0085 PR-B1-1 hardStopLoss.ts BEP_PROTECTION wiring 정적 가드 회귀
/**
 * hardStopLossBepWiring.test.ts — Two-Bar Confirmation Gate wiring 회귀 차단 정적
 * grep 가드. 본 PR 의 hardStopLoss 본체 변경이 *byte-equivalent* 보장하는지
 * 검증 (실제 동작 검증은 `helpers/twoBarBepGate.test.ts` 단위 테스트 + 통합
 * 시나리오는 SHADOW 1주 검증 후 PR-B1-Audit 으로 분리).
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const HARDSTOP_PATH = path.resolve(__dirname, '../hardStopLoss.ts');
const HARDSTOP_SRC = fs.readFileSync(HARDSTOP_PATH, 'utf8');

describe('hardStopLoss BEP_PROTECTION wiring (ADR-0085 PR-B1-1, 정적 가드)', () => {
  it('applyTwoBarBepGate import 존재', () => {
    expect(HARDSTOP_SRC).toMatch(
      /import\s*\{\s*applyTwoBarBepGate\s*\}\s*from\s*['"]\.\.\/helpers\/twoBarBepGate\.js['"]/,
    );
  });

  it('applyTwoBarBepGate 호출 정확히 1건', () => {
    const noImport = HARDSTOP_SRC.replace(
      /import\s*\{[^}]*applyTwoBarBepGate[^}]*\}[^;]*;/g,
      '',
    );
    const callMatches = noImport.match(/applyTwoBarBepGate\s*\(/g) ?? [];
    expect(callMatches.length).toBe(1);
  });

  it('호출 위치 — stopLossExitType 분기 *후*, soldQty 정의 *전*', () => {
    // stopLossExitType 분기 (else { ... }) 다음에 applyTwoBarBepGate 호출 + soldQty 정의 순서.
    const stopLossAssignIdx = HARDSTOP_SRC.search(/stopLossExitType\s*=\s*['"]PROFIT_PROTECTION['"]/);
    const bepGateIdx = HARDSTOP_SRC.search(/applyTwoBarBepGate\s*\(/);
    const soldQtyIdx = HARDSTOP_SRC.search(/const\s+soldQty\s*=\s*shadow\.quantity/);
    expect(stopLossAssignIdx).toBeGreaterThan(0);
    expect(bepGateIdx).toBeGreaterThan(stopLossAssignIdx);
    expect(soldQtyIdx).toBeGreaterThan(bepGateIdx);
  });

  it('isBepProtection 인자 — stopLossExitType === PROFIT_PROTECTION 동치', () => {
    expect(HARDSTOP_SRC).toMatch(
      /applyTwoBarBepGate\s*\(\s*\{[^}]*isBepProtection:\s*stopLossExitType\s*===\s*['"]PROFIT_PROTECTION['"]/,
    );
  });

  it('WAIT 분기 — updateShadow 호출 + return NO_OP', () => {
    expect(HARDSTOP_SRC).toMatch(
      /bepGate\.action\s*===\s*['"]WAIT['"][\s\S]*?updateShadow\s*\(\s*shadow\s*,\s*bepGate\.shadowUpdate\s*\)[\s\S]*?return\s+NO_OP/,
    );
  });

  it('RESET 분기 — updateShadow 호출 + return NO_OP', () => {
    expect(HARDSTOP_SRC).toMatch(
      /bepGate\.action\s*===\s*['"]RESET['"][\s\S]*?updateShadow\s*\(\s*shadow\s*,\s*bepGate\.shadowUpdate\s*\)[\s\S]*?return\s+NO_OP/,
    );
  });

  it('CONTINUE_EXIT 분기 — fallthrough (return 없음, 진단 로그만)', () => {
    // CONTINUE_EXIT 블록 내부에서 return 호출 없는지 검증.
    const continueBlock = HARDSTOP_SRC.match(
      /if\s*\(\s*bepGate\.action\s*===\s*['"]CONTINUE_EXIT['"]\s*\)\s*\{([\s\S]*?)\n\s*\}/,
    );
    expect(continueBlock).not.toBeNull();
    expect(continueBlock?.[1]).toMatch(/console\.log/);
    expect(continueBlock?.[1]).not.toMatch(/return\s+(NO_OP|null|undefined|\{)/);
  });

  it('SKIP 분기 — 명시 처리 없이 fallthrough (주석으로 의도 명시)', () => {
    expect(HARDSTOP_SRC).toMatch(/SKIP\s*→\s*fallthrough|fallthrough.*SKIP|기존 청산 진행/);
  });

  it('ADR-0085 PR-B1-1 주석 명시', () => {
    expect(HARDSTOP_SRC).toMatch(/ADR-0085.*PR-B1-1|PR-B1-1.*ADR-0085|Two-Bar Confirmation/);
  });

  it('ENV 롤백 안내 주석 (BEP_PROTECTION_DISABLED + BEP_TWO_BAR_LIVE_ENABLED)', () => {
    expect(HARDSTOP_SRC).toMatch(/BEP_PROTECTION_DISABLED/);
    expect(HARDSTOP_SRC).toMatch(/BEP_TWO_BAR_LIVE_ENABLED/);
  });

  it('기존 청산 본체 보존 — placeKisSellOrder + reserveSell + emitFullCloseAttributionForExit', () => {
    expect(HARDSTOP_SRC).toMatch(/placeKisSellOrder\s*\(/);
    expect(HARDSTOP_SRC).toMatch(/reserveSell\s*\(/);
    expect(HARDSTOP_SRC).toMatch(/emitFullCloseAttributionForExit\s*\(/);
  });

  it('stopLossExitType 4-way union 보존 (INITIAL/REGIME/INITIAL_AND_REGIME/PROFIT_PROTECTION)', () => {
    expect(HARDSTOP_SRC).toMatch(
      /['"]INITIAL['"][\s\S]*?['"]REGIME['"][\s\S]*?['"]INITIAL_AND_REGIME['"][\s\S]*?['"]PROFIT_PROTECTION['"]/,
    );
  });

  it('classifyExitOutcome 호출 보존 (ADR-0112 BE 분류 SSOT)', () => {
    expect(HARDSTOP_SRC).toMatch(/classifyExitOutcome\s*\(/);
  });

  it('회귀 차단 — applyTwoBarBepGate 가 stopLossExitType 결정 *전* 호출되는 패턴 차단', () => {
    // 잘못된 패턴: bepGate 가 stopLossExitType 결정 전에 호출되면 isBepProtection 판정 불가능
    const beforeStopLoss = HARDSTOP_SRC.match(
      /applyTwoBarBepGate[\s\S]{0,500}?stopLossExitType\s*=\s*['"]/,
    );
    expect(beforeStopLoss).toBeNull();
  });
});
