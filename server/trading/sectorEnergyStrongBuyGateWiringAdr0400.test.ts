// @responsibility ADR-0400 STRONG_BUY 4 조건 OR confidence gate wiring 회귀
/**
 * sectorEnergyStrongBuyGateWiringAdr0400.test.ts
 *
 * ADR-0400 wiring 정적 가드 + 동작 매트릭스.
 * - ADR-0398 (`evaluateSectorEnergyStrongBuyGate`) dead code → buyListLoop 단일
 *   STRONG_BUY 결정 지점 (line 1130 `isStrongBuy = gateScore >= 9`) 에 wiring.
 * - 일반 BUY 차단 금지 / sectorBoost=0 ≠ 매수 차단 / 4 조건 OR (confidence/DEGRADED/FAILED/YAHOO_ETF).
 * - LIVE 매매 본체 0줄 변경 / KIS 주문 함수 import 0건 / ENV 1줄 즉시 롤백.
 *
 * 테스트 카테고리:
 *   1) 정적 grep 가드 (drift 차단) — wiring 정확 위치 + ENV 헬퍼 / inline ENV 검사 0건 / KIS import 0건
 *   2) 동작 매트릭스 (evaluateSectorEnergyStrongBuyGate 분기) — 4 조건 OR 차단 + 정상 통과 + macroState 부재 보수 fallback
 *   3) 회귀 격리 — 일반 BUY 강등 0건 / NaN/Infinity 안전 fallback / ENV DISABLED 시 강등 안 함
 */

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  evaluateSectorEnergyStrongBuyGate,
  isSectorEnergyStrongBuyGateDisabled,
  isSectorEnergyStrongBuyGateWiringDisabled,
} from './sectorEnergyStrongBuyGate.js';

const BUY_LIST_LOOP_PATH = join(
  process.cwd(),
  'server/trading/signalScanner/perSymbol/buyListLoop.ts',
);
const BUY_LIST_LOOP_SOURCE = readFileSync(BUY_LIST_LOOP_PATH, 'utf-8');

const ORIGINAL_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('ADR-0400 wiring — buyListLoop.ts 정적 가드 (drift 차단)', () => {
  it('evaluateSectorEnergyStrongBuyGate import 정확 1건', () => {
    const matches = BUY_LIST_LOOP_SOURCE.match(
      /import\s*\{[^}]*evaluateSectorEnergyStrongBuyGate[^}]*\}\s*from\s*['"][^'"]*sectorEnergyStrongBuyGate/g,
    );
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(1);
  });

  it('isSectorEnergyStrongBuyGateWiringDisabled import 정확 1건', () => {
    const matches = BUY_LIST_LOOP_SOURCE.match(
      /import\s*\{[^}]*isSectorEnergyStrongBuyGateWiringDisabled[^}]*\}\s*from\s*['"][^'"]*sectorEnergyStrongBuyGate/g,
    );
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(1);
  });

  it('evaluateSectorEnergyStrongBuyGate 호출 정확 1건 (메인 buyList 단일 STRONG_BUY 결정 지점)', () => {
    const calls = BUY_LIST_LOOP_SOURCE.match(/evaluateSectorEnergyStrongBuyGate\s*\(/g);
    expect(calls).not.toBeNull();
    expect(calls!.length).toBe(1);
  });

  it('isSectorEnergyStrongBuyGateWiringDisabled 호출 정확 1건 (단일 wiring 진입점)', () => {
    const calls = BUY_LIST_LOOP_SOURCE.match(/isSectorEnergyStrongBuyGateWiringDisabled\s*\(/g);
    expect(calls).not.toBeNull();
    expect(calls!.length).toBe(1);
  });

  it('isStrongBuy 변수가 let (강등 가능)으로 선언', () => {
    // const isStrongBuy → let isStrongBuy 격상 (ADR-0400 강등 wiring 의무)
    expect(BUY_LIST_LOOP_SOURCE).toMatch(/let\s+isStrongBuy\s*=\s*gateScore\s*>=\s*9/);
    // const 패턴 회귀 차단
    expect(BUY_LIST_LOOP_SOURCE).not.toMatch(/const\s+isStrongBuy\s*=\s*gateScore/);
  });

  it('inline ENV 검사 0건 (호출자 측에서 process.env 직접 참조 0건 — SSOT 위임)', () => {
    // SECTOR_ENERGY_STRONG_BUY_GATE_WIRING_DISABLED 가 호출자 측에서 직접 참조되면 fail.
    expect(BUY_LIST_LOOP_SOURCE).not.toMatch(/process\.env\.SECTOR_ENERGY_STRONG_BUY_GATE_WIRING_DISABLED/);
  });

  it('KIS 주문 함수 5종 import 0건 (회귀 차단 가드 — sectorEnergyStrongBuyGate 본체 무관)', () => {
    // gate 모듈 본체에 KIS 주문 함수 import 가 들어가면 절대 규칙 #2 위반.
    const gateModule = readFileSync(
      join(process.cwd(), 'server/trading/sectorEnergyStrongBuyGate.ts'),
      'utf-8',
    );
    expect(gateModule).not.toMatch(/placeKisMarketOrder/);
    expect(gateModule).not.toMatch(/placeKisSellOrder/);
    expect(gateModule).not.toMatch(/cancelKisOrder/);
    expect(gateModule).not.toMatch(/placeKisStopLossOrder/);
    expect(gateModule).not.toMatch(/placeKisTakeProfitOrder/);
  });

  it('ADR-0400 추적 주석 본문 등장 (wiring 의무 명시)', () => {
    // import 주석 + wiring 분기 주석 모두 ADR-0400 식별자 포함.
    expect(BUY_LIST_LOOP_SOURCE).toMatch(/ADR-0400/);
    // 사용자 명시 절대 원칙 #2 — STRONG_BUY → BUY 강등 패턴 (downgrade)
    expect(BUY_LIST_LOOP_SOURCE).toMatch(/STRONG_BUY → BUY 강등/);
  });

  it('isStrongBuy = false 강등 (호출자 측 절대 원칙 #2 — STRONG_BUY → BUY 강등만 허용)', () => {
    // forbidStrongBuy=true 시 isStrongBuy = false 패턴 (강등 정책 정합)
    expect(BUY_LIST_LOOP_SOURCE).toMatch(/isStrongBuy\s*=\s*false/);
  });

  it('continue / return 문 0건 (절대 원칙 #1 — 일반 BUY 차단 금지)', () => {
    // wiring 분기 안 (forbidStrongBuy=true) 에서 continue 또는 return 으로 매수 자체 차단하면 fail.
    // wiring 시작 ('if (isStrongBuy && !isSectorEnergyStrongBuyGateWiringDisabled())') 부터
    // wiring 종료 (다음 빈 라인 또는 mtasGateStep) 까지 영역에서 continue 검사.
    const wiringStart = BUY_LIST_LOOP_SOURCE.indexOf('if (isStrongBuy && !isSectorEnergyStrongBuyGateWiringDisabled()');
    expect(wiringStart).toBeGreaterThan(0);
    const wiringEnd = BUY_LIST_LOOP_SOURCE.indexOf('mtasGateStep', wiringStart);
    expect(wiringEnd).toBeGreaterThan(wiringStart);
    const wiringSection = BUY_LIST_LOOP_SOURCE.slice(wiringStart, wiringEnd);
    // 'continue' / 'return' 키워드 검사 — wiring 안에 매수 차단 문 존재 시 즉시 fail.
    expect(wiringSection).not.toMatch(/\bcontinue\b/);
    expect(wiringSection).not.toMatch(/\breturn\b/);
  });
});

describe('ADR-0400 동작 매트릭스 — evaluateSectorEnergyStrongBuyGate (단위 회귀)', () => {
  it('정상 입력 (KRX_CODE + OK + confidence=0.8) → forbidStrongBuy=false (STRONG_BUY 통과)', () => {
    const result = evaluateSectorEnergyStrongBuyGate({
      confidence: 0.8,
      dataQuality: 'OK',
      sourceTier: 'KRX_CODE',
    });
    expect(result.forbidStrongBuy).toBe(false);
    expect(result.reasons).toEqual([]);
  });

  it('confidence=0 + DEGRADED + FAILED 보수 fallback 입력 → 차단 (macroState 부재 정합)', () => {
    // ADR-0400 wiring 의 보수 fallback 패턴: macroState 부재 시 사용
    const result = evaluateSectorEnergyStrongBuyGate({
      confidence: 0,
      dataQuality: 'FAILED',
      sourceTier: 'FAILED',
    });
    expect(result.forbidStrongBuy).toBe(true);
    // 다중 사유 동시 노출 (4 조건 중 3 충족)
    expect(result.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it('YAHOO_ETF 단독 차단 (조건 4) — confidence + dataQuality 모두 통과여도 STRONG_BUY 금지', () => {
    const result = evaluateSectorEnergyStrongBuyGate({
      confidence: 0.9,
      dataQuality: 'OK',
      sourceTier: 'YAHOO_ETF',
    });
    expect(result.forbidStrongBuy).toBe(true);
    expect(result.reasons.some((r) => r.includes('YAHOO_ETF'))).toBe(true);
  });

  it('NaN confidence 보수 fallback (forbidStrongBuy=true)', () => {
    const result = evaluateSectorEnergyStrongBuyGate({
      confidence: Number.NaN,
      dataQuality: 'OK',
      sourceTier: 'KRX_CODE',
    });
    expect(result.forbidStrongBuy).toBe(true);
    expect(result.reasons.some((r) => r.includes('NaN'))).toBe(true);
  });

  it('Infinity confidence 보수 fallback', () => {
    const result = evaluateSectorEnergyStrongBuyGate({
      confidence: Number.POSITIVE_INFINITY,
      dataQuality: 'OK',
      sourceTier: 'KRX_CODE',
    });
    expect(result.forbidStrongBuy).toBe(true);
  });

  it('ENV DISABLED 활성 시 forbidStrongBuy=false (게이트 비활성)', () => {
    process.env.SECTOR_ENERGY_STRONG_BUY_GATE_DISABLED = 'true';
    const result = evaluateSectorEnergyStrongBuyGate({
      confidence: 0,
      dataQuality: 'FAILED',
      sourceTier: 'YAHOO_ETF',
    });
    expect(result.forbidStrongBuy).toBe(false);
    expect(result.reasons).toEqual([]);
    expect(isSectorEnergyStrongBuyGateDisabled()).toBe(true);
  });
});

describe('ADR-0400 ENV gate (isSectorEnergyStrongBuyGateWiringDisabled) — 정확 비교 ADR-0157', () => {
  it('default OFF — ENV 미설정 시 false (wiring 활성)', () => {
    delete process.env.SECTOR_ENERGY_STRONG_BUY_GATE_WIRING_DISABLED;
    expect(isSectorEnergyStrongBuyGateWiringDisabled()).toBe(false);
  });

  it("'true' 정확 비교 — wiring 비활성 (ADR-0398 dead code 동작 100% 복원)", () => {
    process.env.SECTOR_ENERGY_STRONG_BUY_GATE_WIRING_DISABLED = 'true';
    expect(isSectorEnergyStrongBuyGateWiringDisabled()).toBe(true);
  });

  it("'1' / 'TRUE' / 'yes' 모두 거부 (ADR-0157 정확 비교 의무)", () => {
    process.env.SECTOR_ENERGY_STRONG_BUY_GATE_WIRING_DISABLED = '1';
    expect(isSectorEnergyStrongBuyGateWiringDisabled()).toBe(false);
    process.env.SECTOR_ENERGY_STRONG_BUY_GATE_WIRING_DISABLED = 'TRUE';
    expect(isSectorEnergyStrongBuyGateWiringDisabled()).toBe(false);
    process.env.SECTOR_ENERGY_STRONG_BUY_GATE_WIRING_DISABLED = 'yes';
    expect(isSectorEnergyStrongBuyGateWiringDisabled()).toBe(false);
  });

  it("'false' / 빈 문자열 → false (default OFF 동작)", () => {
    process.env.SECTOR_ENERGY_STRONG_BUY_GATE_WIRING_DISABLED = 'false';
    expect(isSectorEnergyStrongBuyGateWiringDisabled()).toBe(false);
    process.env.SECTOR_ENERGY_STRONG_BUY_GATE_WIRING_DISABLED = '';
    expect(isSectorEnergyStrongBuyGateWiringDisabled()).toBe(false);
  });
});

describe('ADR-0400 회귀 격리 — 일반 BUY 차단 0건 (절대 원칙 #1) + sectorBoost=0 무관 (절대 원칙 #3)', () => {
  it('함수 시그니처에 forbidBuy 필드 부재 (절대 원칙 #1 — 일반 BUY 차단 금지)', () => {
    // StrongBuyGateResult 에 forbidBuy 같은 일반 BUY 차단 필드 없음 — 절대 원칙 정적 가드.
    const sample = evaluateSectorEnergyStrongBuyGate({
      confidence: 0.8,
      dataQuality: 'OK',
      sourceTier: 'KRX_CODE',
    });
    const sampleRecord = sample as unknown as Record<string, unknown>;
    expect(sampleRecord.forbidBuy).toBeUndefined();
    expect(sampleRecord.blockBuy).toBeUndefined();
    expect(sampleRecord.rejectBuy).toBeUndefined();
  });

  it('호출자 측 wiring 분기 안에 매수 차단 문 부재 — 강등 (let isStrongBuy = false) 패턴만 허용', () => {
    // 정적 grep 으로 강등 패턴 명시 검증 (continue/return 부재는 별도 케이스에서 검증).
    const wiringStart = BUY_LIST_LOOP_SOURCE.indexOf('if (isStrongBuy && !isSectorEnergyStrongBuyGateWiringDisabled()');
    expect(wiringStart).toBeGreaterThan(0);
    // wiring 분기 안에 isStrongBuy = false 강등 정확 1건
    const sectionEnd = BUY_LIST_LOOP_SOURCE.indexOf('mtasGateStep', wiringStart);
    expect(sectionEnd).toBeGreaterThan(wiringStart);
    const section = BUY_LIST_LOOP_SOURCE.slice(wiringStart, sectionEnd);
    const downgradeMatches = section.match(/isStrongBuy\s*=\s*false/g);
    expect(downgradeMatches).not.toBeNull();
    expect(downgradeMatches!.length).toBe(1);
  });

  it('진단 로그에 STRONG_BUY 강등 사유 + 종목코드 + 종목명 노출 (운영자 추적성)', () => {
    // [SectorEnergyGate] STRONG_BUY → BUY 강등 (사유: ...) 종목=<code> <name>
    const wiringStart = BUY_LIST_LOOP_SOURCE.indexOf('if (isStrongBuy && !isSectorEnergyStrongBuyGateWiringDisabled()');
    const sectionEnd = BUY_LIST_LOOP_SOURCE.indexOf('mtasGateStep', wiringStart);
    const section = BUY_LIST_LOOP_SOURCE.slice(wiringStart, sectionEnd);
    expect(section).toMatch(/\[SectorEnergyGate\]/);
    expect(section).toMatch(/사유:/);
    expect(section).toMatch(/종목=/);
  });

  it('macroState 부재 보수 fallback 진단 로그 별도 노출 (운영자 인지)', () => {
    // [SectorEnergyGate] macroState.sectorEnergy* 부재 — 보수 fallback 적용 (STRONG_BUY 차단)
    const wiringStart = BUY_LIST_LOOP_SOURCE.indexOf('if (isStrongBuy && !isSectorEnergyStrongBuyGateWiringDisabled()');
    const sectionEnd = BUY_LIST_LOOP_SOURCE.indexOf('mtasGateStep', wiringStart);
    const section = BUY_LIST_LOOP_SOURCE.slice(wiringStart, sectionEnd);
    expect(section).toMatch(/macroState/);
    expect(section).toMatch(/보수 fallback/);
  });

  it('NaN/Infinity confidence 안전 — typeof === number 가드 (보수 fallback 0)', () => {
    // wiring 의 입력 매핑에서 typeof m?.sectorEnergyConfidence === 'number' 가드
    const wiringStart = BUY_LIST_LOOP_SOURCE.indexOf('if (isStrongBuy && !isSectorEnergyStrongBuyGateWiringDisabled()');
    const sectionEnd = BUY_LIST_LOOP_SOURCE.indexOf('mtasGateStep', wiringStart);
    const section = BUY_LIST_LOOP_SOURCE.slice(wiringStart, sectionEnd);
    // typeof guard 또는 fallback 0 패턴 (보수 정합)
    expect(section).toMatch(/typeof\s+\w+\?\.\s*sectorEnergyConfidence\s*===\s*['"]number['"]/);
  });

  it('ADR-0398 SSOT 본체 무수정 — 4 조건 OR 결정 + ENV gate 분기 보존', () => {
    // gate 본체 (evaluateSectorEnergyStrongBuyGate) 가 4 분기 + ENV gate 그대로 보존되는지 정적 가드.
    const gateModule = readFileSync(
      join(process.cwd(), 'server/trading/sectorEnergyStrongBuyGate.ts'),
      'utf-8',
    );
    // 4 조건 분기 패턴 존재
    expect(gateModule).toMatch(/CONFIDENCE_GATE_THRESHOLD/);
    expect(gateModule).toMatch(/dataQuality\s*===\s*['"]DEGRADED['"]/);
    expect(gateModule).toMatch(/dataQuality\s*===\s*['"]FAILED['"]/);
    expect(gateModule).toMatch(/sourceTier\s*===\s*['"]YAHOO_ETF['"]/);
    expect(gateModule).toMatch(/isSectorEnergyStrongBuyGateDisabled\s*\(\s*\)/);
  });
});
