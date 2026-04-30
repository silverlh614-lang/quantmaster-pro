/**
 * macroGateStateWiringAdr0129.test.ts — ADR-0129 macroGateState propagate wiring 회귀
 *
 * signalScanner.ts:639 의 persistScanResults 호출에 buildMacroGateState 결과를
 * propagate 하는 wiring 검증. ADR-0118 의 후속 PR scope 였던 거시 게이트 상태
 * 전달이 본 PR 에서 활성화 — /scan_blockers 텔레그램 메시지의 거시 게이트 섹션
 * 노출 보장.
 *
 * 정적 grep 가드 — wiring 코드 누락 시 자동 fail.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SIGNAL_SCANNER_PATH = join(process.cwd(), 'server/trading/signalScanner.ts');
const SCAN_DIAGNOSTICS_PATH = join(process.cwd(), 'server/trading/signalScanner/scanDiagnostics.ts');

describe('ADR-0129 macroGateState propagate wiring', () => {
  const signalScanner = readFileSync(SIGNAL_SCANNER_PATH, 'utf-8');
  const scanDiagnostics = readFileSync(SCAN_DIAGNOSTICS_PATH, 'utf-8');

  it('signalScanner 가 buildMacroGateState 를 import', () => {
    expect(signalScanner).toMatch(/buildMacroGateState[,\s]/);
  });

  it('signalScanner 가 getEmergencyStop 을 import (state.js)', () => {
    expect(signalScanner).toMatch(/import.*getEmergencyStop.*from.*state/);
  });

  it('persistScanResults 호출에 macroGateState 인자 전달', () => {
    // persistScanResults({ ... macroGateState: ... }) 형식
    const persistCall = signalScanner.match(
      /await persistScanResults\([\s\S]*?\}\);/,
    );
    expect(persistCall).toBeTruthy();
    expect(persistCall![0]).toMatch(/macroGateState:\s*\w+/);
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

  it('bearDefenseMode 는 false (R6_DEFENSE 는 line 311 에서 early return)', () => {
    // ADR-0129 wiring: R6_DEFENSE 는 신규 진입 차단으로 이미 early return.
    // persistScanResults 가 호출되는 시점에는 항상 R6_DEFENSE 가 아님.
    expect(signalScanner).toMatch(/bearDefenseMode:\s*false/);
  });

  it('mhsBelow30 은 macroState.mhs < 30 비교', () => {
    expect(signalScanner).toMatch(/mhsBelow30:\s*\(macroState\?\.mhs/);
    expect(signalScanner).toContain('< 30');
  });

  it('finalKelly 는 결합 후 capping 결과 (kellyMultiplier)', () => {
    expect(signalScanner).toMatch(/finalKelly:\s*kellyMultiplier/);
  });

  it('ADR-0129 주석 명시 (PR-Z19 marker)', () => {
    expect(signalScanner).toMatch(/ADR-0129/);
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
