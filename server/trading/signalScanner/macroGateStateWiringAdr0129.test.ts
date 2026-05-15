/**
 * macroGateStateWiringAdr0129.test.ts — ADR-0129 macroGateState propagate wiring 회귀
 *
 * preflight.ts 의 persistScanResults 호출에 buildMacroGateState 결과를
 * propagate 하는 wiring 검증. ADR-0118 의 후속 PR scope 였던 거시 게이트 상태
 * 전달이 ADR-0129 PR-Z19 에서 활성화 — /scan_blockers 텔레그램 메시지의 거시
 * 게이트 섹션 노출 보장.
 *
 * Audit-fix (2026-05-05): ADR-0147b (signalScanner Phase 3 6단계 오케스트레이터
 * 승격, PR #523) 머지 시 grep 대상 경로 갱신 누락. wiring 코드는 분해 후
 * `signalScanner/preflight.ts` 로 이주. 본 회귀 테스트 grep 경로를 새 위치로 정합.
 *
 * 정적 grep 가드 — wiring 코드 누락 시 자동 fail.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const PREFLIGHT_PATH = join(process.cwd(), 'server/trading/signalScanner/preflight.ts');
const SCAN_INDEX_PATH = join(process.cwd(), 'server/trading/signalScanner/index.ts');
const SCAN_DIAGNOSTICS_PATH = join(process.cwd(), 'server/trading/signalScanner/scanDiagnostics.ts');

describe('ADR-0129 macroGateState propagate wiring', () => {
  const signalScanner = readFileSync(PREFLIGHT_PATH, 'utf-8');
  const scanIndex = readFileSync(SCAN_INDEX_PATH, 'utf-8');
  const scanDiagnostics = readFileSync(SCAN_DIAGNOSTICS_PATH, 'utf-8');

  it('signalScanner 가 buildMacroGateState 를 import', () => {
    expect(signalScanner).toMatch(/buildMacroGateState[,\s]/);
  });

  it('signalScanner 가 getEmergencyStop 을 import (state.js)', () => {
    expect(signalScanner).toMatch(/import[\s\S]*getEmergencyStop[\s\S]*from.*state/);
  });

  it('persistScanResults 호출에 macroGateState 인자 전달 (signalScanner/index.ts 가 호출자)', () => {
    // ADR-0147b 분해 후 persistScanResults 호출자는 signalScanner/index.ts.
    // 두 호출 site (라인 46 abort 분기, 라인 82 정상 분기) 중 정상 분기만
    // macroGateState 전달 (abort 분기는 preflight 단계에서 종료라 의미 없음).
    expect(scanIndex).toMatch(/macroGateState:\s*preflightResult\.macroGateState/);
  });

  it('macroGateState 11 필드 모두 합성 (emergencyStop / autoTradeEnabled / regime / regimeKelly / fomcPhase / fomcKelly / finalKelly / vixGatingActive / bearDefenseMode / mhsBelow30 / watchlistEmpty / sellOnlyMode)', () => {
    const expectedFields = [
      'emergencyStop:',
      'autoTradeEnabled:',
      'regime:',
      'regimeKelly:',
      'fomcPhase:',
      'fomcKelly:',
      'finalKelly:',
      'vixGatingActive:',
      'bearDefenseMode:',
      'mhsBelow30:',
      'watchlistEmpty:',
      'sellOnlyMode:',
    ];
    for (const field of expectedFields) {
      expect(signalScanner).toContain(field);
    }
  });

  it('emergencyStop 은 getEmergencyStop() 호출 결과 사용', () => {
    expect(signalScanner).toMatch(/emergencyStop:\s*getEmergencyStop\(\)/);
  });

  it('autoTradeEnabled 는 process.env.AUTO_TRADE_ENABLED 비교', () => {
    expect(signalScanner).toMatch(
      /autoTradeEnabled:\s*process\.env\.AUTO_TRADE_ENABLED\s*===\s*['"]true['"]/,
    );
  });

  it('bearDefenseMode 는 R6_DEFENSE 진단 스캔에서도 macroGateState 로 전달', () => {
    expect(signalScanner).toMatch(/bearDefenseMode:\s*regime\s*===\s*['"]R6_DEFENSE['"]/);
  });

  it('mhsBelow30 은 macroState.mhs < 30 비교', () => {
    expect(signalScanner).toMatch(/mhsBelow30:\s*\(macroState\?\.mhs/);
    expect(signalScanner).toContain('< 30');
  });

  it('finalKelly 는 결합 후 capping 결과 (kellyMultiplier)', () => {
    expect(signalScanner).toMatch(/finalKelly:\s*kellyMultiplier/);
  });

  it('ADR-0129 주석 명시 — signalScanner.ts 또는 preflight.ts 또는 index.ts (PR-Z19 marker)', () => {
    // ADR-0147b 분해 시 추적 주석이 어느 위치에 있어도 통과 — 본 가드는
    // 주석 자체의 *존재* 만 검증 (drift 추적성 보존).
    const monolith = readFileSync(join(process.cwd(), 'server/trading/signalScanner.ts'), 'utf-8');
    const found = /ADR-0129/.test(monolith) || /ADR-0129/.test(signalScanner) || /ADR-0129/.test(scanIndex);
    expect(found).toBe(true);
  });

  it('buildMacroGateState SSOT 가 scanDiagnostics 에서 export 되어 있음', () => {
    expect(scanDiagnostics).toMatch(/export function buildMacroGateState/);
  });

  it('MacroGateState 인터페이스 11 필드 정합', () => {
    const interfaceMatch = scanDiagnostics.match(/export interface MacroGateState\s*\{[\s\S]*?\}/);
    expect(interfaceMatch).toBeTruthy();
    const fields = [
      'emergencyStop',
      'autoTradeEnabled',
      'regime',
      'kellyMultiplierFromRegime',
      'fomcPhase',
      'fomcKellyMultiplier',
      'finalKellyMultiplier',
      'vixGatingActive',
      'bearDefenseMode',
      'mhsBelow30',
      'watchlistEmpty',
      'sellOnlyMode',
    ];
    for (const field of fields) {
      expect(interfaceMatch![0]).toContain(field);
    }
  });
});
