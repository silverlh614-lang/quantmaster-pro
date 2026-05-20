/**
 * buyListLoopAdr0162Wiring.test.ts
 *
 * ADR-0162 Phase 2-D wiring 정적 가드 — drift 차단 회귀 테스트.
 * `buyListLoop.ts` 의 메인 buyList 분기에 본 모듈이 정확히 wiring 되어 있는지 검증.
 * LIVE 매매 본체 변경 회귀 차단 + 후속 PR 에서 동일 패턴 확장 시 drift 검증 기준.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SOURCE_PATH = join(process.cwd(), 'server/trading/signalScanner/perSymbol/buyListLoop.ts');
const MAIN_SOURCE = readFileSync(SOURCE_PATH, 'utf-8');
const SOURCE =
  MAIN_SOURCE + '\n' +
  readFileSync(join(process.cwd(), 'server/trading/signalScanner/perSymbol/steps/exposureBudgetCap.ts'), 'utf-8') + '\n' +
  readFileSync(join(process.cwd(), 'server/trading/signalScanner/perSymbol/steps/preBreakoutFollowthroughBudget.ts'), 'utf-8') + '\n' +
  readFileSync(join(process.cwd(), 'server/trading/signalScanner/perSymbol/steps/preBreakoutEntry.ts'), 'utf-8');

describe('ADR-0162 Phase 2-D wiring 정적 가드 — buyListLoop.ts', () => {
  it('applyPositionSizingEngine import 정확 1건', () => {
    const matches = MAIN_SOURCE.match(/import\s*\{[^}]*applyPositionSizingEngine[^}]*\}\s*from\s*['"][^'"]*positionSizingEngineWiring/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(1);
  });

  it('applyPositionSizingEngine 호출 정확 3건 (ADR-0163 Phase 2-D Extension — 메인 buyList + PRE_BREAKOUT_FOLLOWTHROUGH + PRE_BREAKOUT 30%)', () => {
    // `applyPositionSizingEngine(...)` 호출 패턴 (import 제외, 함수 호출만)
    const calls = SOURCE.match(/applyPositionSizingEngine\s*\(/g);
    expect(calls).not.toBeNull();
    // ADR-0162 (메인 buyList 1건) + ADR-0163 (PRE_BREAKOUT_FOLLOWTHROUGH 1건 + PRE_BREAKOUT 30% 1건) = 3건
    expect(calls!.length).toBe(3);
  });

  it('legacyQuantity rename — calculateOrderQuantity 결과 변수', () => {
    expect(SOURCE).toMatch(/const\s*\{\s*quantity:\s*legacyQuantity[^}]*\}\s*=\s*calculateOrderQuantity/);
  });

  it('baseQuantity 변수 — sizingApply.applied 분기 결정 (ADR-0166: finalQuantity → baseQuantity rename + exposure cap 추가)', () => {
    expect(SOURCE).toMatch(/const\s+baseQuantity\s*=\s*sizingApply\.applied\s*\?\s*sizingApply\.quantity\s*:\s*legacyQuantity/);
    // ADR-0166 — finalQuantity 는 exposure cap 적용 후 변수
    expect(SOURCE).toMatch(/const\s+finalQuantity\s*=\s*exposureCapMain\.applied\s*\?\s*exposureCapMain\.finalQuantity\s*:\s*baseQuantity/);
  });

  it('execQty 산출 — finalQuantity 기반 (legacyQuantity 직접 사용 안 함)', () => {
    // execQty 가 finalQuantity 기반인지 검증
    expect(SOURCE).toMatch(/const\s+execQty\s*=\s*isStrongBuy\s*\?\s*Math\.max\(1,\s*Math\.floor\(finalQuantity\s*\*\s*0\.5\)\)\s*:\s*finalQuantity/);
  });

  it('quantity 변수 단독 참조 0건 (legacyQuantity / finalQuantity 만 사용)', () => {
    // `quantity` 단독 (단어 경계) 참조가 변수 정의/구조분해/속성 외에서 발생하면 fail.
    // 허용 패턴: `quantity:` (객체 키) / `: quantity` 없음 / `originalQuantity` / `legacyQuantity` / `finalQuantity` / `quantity_xxx`
    const lines = SOURCE.split('\n');
    const violations: string[] = [];
    lines.forEach((line, idx) => {
      // 주석/문자열 제외 (단순 휴리스틱)
      if (line.trim().startsWith('//') || line.trim().startsWith('*')) return;
      // `quantity` 단어 경계 참조 추출
      const matches = line.match(/\bquantity\b/g);
      if (!matches) return;
      // 허용 패턴 (sed 후 잔존 가능)
      // ADR-0163 추가 — legacyFullQty/legacyFullPbQty + sizingApplyFollow/sizingApplyPb.quantity 패턴 허용.
      const allowed = /(originalQuantity|legacyQuantity|legacyFullQty|legacyFullPbQty|legacyIntradayQty|finalQuantity|fullQty|fullPbQty|quantity:|p\.quantity|trade\.quantity|sized\.quantity|firstQuantity|totalQuantity|sizingApply\w*\.quantity|: number|: quantity)/;
      if (!allowed.test(line)) {
        violations.push(`${idx + 1}: ${line.trim().slice(0, 100)}`);
      }
    });
    expect(violations).toEqual([]);
  });

  it('buildBuyTrade 호출에 sizingSource + sizingEngineSnapshot 전달', () => {
    // buildBuyTrade({ ... sizingSource, sizingEngineSnapshot, ... }) 패턴
    const buildCall = SOURCE.split('buildBuyTrade(')[3] || SOURCE.split('buildBuyTrade(')[2]; // 메인 buyList = 3번째 호출 (index 2)
    expect(buildCall).toBeDefined();
    // sizingSource 와 sizingEngineSnapshot 모두 메인 buyList buildBuyTrade 호출 안에 등장
    const mainSection = SOURCE.slice(SOURCE.indexOf('applyPositionSizingEngine'));
    expect(mainSection).toMatch(/sizingSource\s*,/);
    expect(mainSection).toMatch(/sizingEngineSnapshot\s*,/);
  });

  it('sizingSource 변수 — sizingApply.sizingSource 직접 할당', () => {
    expect(SOURCE).toMatch(/const\s+sizingSource\s*=\s*sizingApply\.sizingSource/);
  });

  it('sizingEngineSnapshot 11 필드 + snapshotAt 합성', () => {
    const snapshotSection = SOURCE.match(/const\s+sizingEngineSnapshot\s*=[\s\S]*?snapshotAt:[^,}]+[,}]/);
    expect(snapshotSection).not.toBeNull();
    const text = snapshotSection![0];
    // 11 필드 모두 존재
    ['tierName', 'basePct', 'finalPositionPct', 'finalPositionKrw', 'drawdownMultiplier',
     'lossStreakMultiplier', 'liquidityMultiplier', 'sectorExposureMultiplier',
     'expectedStopLossDamagePct', 'signalPriorityApplied', 'adjustmentReasons', 'snapshotAt'].forEach((field) => {
      expect(text).toMatch(new RegExp(`${field}\\s*:`));
    });
  });

  it('진단 로그 — applied=true 시 [Sizing-NewEngine] tier=... 형식', () => {
    expect(SOURCE).toMatch(/\[Sizing-NewEngine\][^`]*tier=/);
  });

  it('ENV_DISABLED / LIVE_MODE 정상 운영 경로 — 진단 로그 노이즈 차단', () => {
    expect(SOURCE).toMatch(/ENV_DISABLED.*LIVE_MODE|LIVE_MODE.*ENV_DISABLED/);
  });

  it('isNormalRegime 매핑 — R1_TURBO / R2_BULL / R3_EARLY 만', () => {
    const mappingSection = SOURCE.match(/isNormalRegime:[^,]+/);
    expect(mappingSection).not.toBeNull();
    expect(mappingSection![0]).toMatch(/R1_TURBO/);
    expect(mappingSection![0]).toMatch(/R2_BULL/);
    expect(mappingSection![0]).toMatch(/R3_EARLY/);
  });

  it('notInDowntrend 매핑 — R6_DEFENSE / R5_CAUTION 제외', () => {
    const mappingSection = SOURCE.match(/notInDowntrend:[^,]+/);
    expect(mappingSection).not.toBeNull();
    expect(mappingSection![0]).toMatch(/R6_DEFENSE/);
    expect(mappingSection![0]).toMatch(/R5_CAUTION/);
  });

  it('signalGrade 매핑 — isStrongBuy 분기 (CONFIRMED_STRONG_BUY 매핑은 후속 PR)', () => {
    expect(SOURCE).toMatch(/signalGrade:\s*isStrongBuy\s*\?\s*['"]STRONG_BUY['"]\s*:\s*['"]BUY['"]/);
  });

  it('LIVE 회귀 격리 — stockShadowMode 첫 인자 전달 (shadowMode=false 시 자동 skip)', () => {
    expect(SOURCE).toMatch(/applyPositionSizingEngine\s*\(\s*stockShadowMode/);
  });
});
