/**
 * @responsibility ADR-0436 Gate Eligibility Split — ScanCounters 6 신규 카운터 회귀.
 *
 * 검증:
 *   - createScanCounters() default 0 (6 카운터)
 *   - accumulateGateEligibility 누적 정확 (5 결과 시나리오)
 *   - persistScanResults → ScanSummary propagate (6 카운터 모두)
 *   - R3 Sanity wiring: shadowObservableCount > 0 시 streak 누적 차단 가시화
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  createScanCounters,
  accumulateGateEligibility,
} from './scanDiagnostics.js';

const SCAN_DIAGNOSTICS_PATH = 'server/trading/signalScanner/scanDiagnostics.ts';

function stripComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('ADR-0436 — ScanCounters 6 신규 카운터', () => {
  it('createScanCounters() — 6 신규 카운터 default 0', () => {
    const c = createScanCounters();
    expect(c.liveEligibleCount).toBe(0);
    expect(c.shadowObservableCount).toBe(0);
    expect(c.dataUnavailableBlockedCount).toBe(0);
    expect(c.providerDegradedObservableCount).toBe(0);
    expect(c.trueGateFailCount).toBe(0);
    expect(c.hardRiskBlockedCount).toBe(0);
  });

  describe('accumulateGateEligibility — 시나리오 매트릭스', () => {
    it('liveEligible=true → liveEligibleCount++', () => {
      const c = createScanCounters();
      accumulateGateEligibility(c, {
        liveEligible: true,
        shadowObservable: false,
        liveBlockReasons: [],
        dataUnavailableReasons: [],
        degradedProviderReasons: [],
      });
      expect(c.liveEligibleCount).toBe(1);
      expect(c.shadowObservableCount).toBe(0);
    });

    it('shadowObservable=true → shadowObservableCount++', () => {
      const c = createScanCounters();
      accumulateGateEligibility(c, {
        liveEligible: false,
        shadowObservable: true,
        liveBlockReasons: ['SUPPLY_DATA_UNAVAILABLE'],
        dataUnavailableReasons: ['SUPPLY_DATA_UNAVAILABLE'],
        degradedProviderReasons: [],
      });
      expect(c.liveEligibleCount).toBe(0);
      expect(c.shadowObservableCount).toBe(1);
      expect(c.dataUnavailableBlockedCount).toBe(1);
    });

    it('SECTOR_DATA_DEGRADED → providerDegradedObservableCount++', () => {
      const c = createScanCounters();
      accumulateGateEligibility(c, {
        liveEligible: false,
        shadowObservable: true,
        liveBlockReasons: ['SECTOR_DATA_DEGRADED'],
        dataUnavailableReasons: [],
        degradedProviderReasons: ['SECTOR_DATA_DEGRADED'],
      });
      expect(c.providerDegradedObservableCount).toBe(1);
      expect(c.dataUnavailableBlockedCount).toBe(0);
    });

    it('MACRO_BLOCK + RISK_BLOCK → hardRiskBlockedCount++ (한 번만)', () => {
      const c = createScanCounters();
      accumulateGateEligibility(c, {
        liveEligible: false,
        shadowObservable: false,
        liveBlockReasons: ['MACRO_BLOCK', 'RISK_BLOCK'],
        dataUnavailableReasons: [],
        degradedProviderReasons: [],
      });
      expect(c.hardRiskBlockedCount).toBe(1);
    });

    it('TRUE_GATE_FAIL → trueGateFailCount++', () => {
      const c = createScanCounters();
      accumulateGateEligibility(c, {
        liveEligible: false,
        shadowObservable: false,
        liveBlockReasons: ['TRUE_GATE_FAIL'],
        dataUnavailableReasons: [],
        degradedProviderReasons: [],
      });
      expect(c.trueGateFailCount).toBe(1);
    });

    it('INSUFFICIENT_SCORE 도 trueGateFailCount++ 포함', () => {
      const c = createScanCounters();
      accumulateGateEligibility(c, {
        liveEligible: false,
        shadowObservable: false,
        liveBlockReasons: ['INSUFFICIENT_SCORE'],
        dataUnavailableReasons: [],
        degradedProviderReasons: [],
      });
      expect(c.trueGateFailCount).toBe(1);
    });

    it('다중 종목 누적 — 10개 시나리오 후 카운터 정합', () => {
      const c = createScanCounters();
      // 5 live, 3 shadow (data unavail), 1 sector degraded, 1 hard block
      for (let i = 0; i < 5; i++) {
        accumulateGateEligibility(c, {
          liveEligible: true,
          shadowObservable: false,
          liveBlockReasons: [],
          dataUnavailableReasons: [],
          degradedProviderReasons: [],
        });
      }
      for (let i = 0; i < 3; i++) {
        accumulateGateEligibility(c, {
          liveEligible: false,
          shadowObservable: true,
          liveBlockReasons: ['SUPPLY_DATA_UNAVAILABLE'],
          dataUnavailableReasons: ['SUPPLY_DATA_UNAVAILABLE'],
          degradedProviderReasons: [],
        });
      }
      accumulateGateEligibility(c, {
        liveEligible: false,
        shadowObservable: true,
        liveBlockReasons: ['SECTOR_DATA_DEGRADED'],
        dataUnavailableReasons: [],
        degradedProviderReasons: ['SECTOR_DATA_DEGRADED'],
      });
      accumulateGateEligibility(c, {
        liveEligible: false,
        shadowObservable: false,
        liveBlockReasons: ['MACRO_BLOCK'],
        dataUnavailableReasons: [],
        degradedProviderReasons: [],
      });
      expect(c.liveEligibleCount).toBe(5);
      expect(c.shadowObservableCount).toBe(4);
      expect(c.dataUnavailableBlockedCount).toBe(3);
      expect(c.providerDegradedObservableCount).toBe(1);
      expect(c.hardRiskBlockedCount).toBe(1);
      expect(c.trueGateFailCount).toBe(0);
    });
  });

  describe('정적 grep 가드 — scanDiagnostics.ts ADR-0436 wiring', () => {
    let src = '';
    it('[setup]', () => {
      src = readFileSync(SCAN_DIAGNOSTICS_PATH, 'utf-8');
      expect(src.length).toBeGreaterThan(0);
    });

    it('ScanCounters 인터페이스 6 카운터 정의', () => {
      const stripped = stripComments(src);
      expect(stripped).toMatch(/liveEligibleCount:\s*number/);
      expect(stripped).toMatch(/shadowObservableCount:\s*number/);
      expect(stripped).toMatch(/dataUnavailableBlockedCount:\s*number/);
      expect(stripped).toMatch(/providerDegradedObservableCount:\s*number/);
      expect(stripped).toMatch(/trueGateFailCount:\s*number/);
      expect(stripped).toMatch(/hardRiskBlockedCount:\s*number/);
    });

    it('ScanSummary 6 옵셔널 카운터 (후방호환)', () => {
      const stripped = stripComments(src);
      expect(stripped).toMatch(/liveEligibleCount\?:\s*number/);
      expect(stripped).toMatch(/shadowObservableCount\?:\s*number/);
      expect(stripped).toMatch(/dataUnavailableBlockedCount\?:\s*number/);
      expect(stripped).toMatch(/providerDegradedObservableCount\?:\s*number/);
      expect(stripped).toMatch(/trueGateFailCount\?:\s*number/);
      expect(stripped).toMatch(/hardRiskBlockedCount\?:\s*number/);
    });

    it('persistScanResults → counters.ADR-0436 카운터 propagate', () => {
      const stripped = stripComments(src);
      // summary 으로 영속하는 6 카운터 모두 등장
      expect(stripped).toMatch(/liveEligibleCount: counters\.liveEligibleCount/);
      expect(stripped).toMatch(/shadowObservableCount: counters\.shadowObservableCount/);
    });

    it('accumulateGateEligibility SSOT export', () => {
      const stripped = stripComments(src);
      expect(stripped).toMatch(/export function accumulateGateEligibility/);
    });

    it('R3 Sanity skip wiring — shadowObservableCount > 0 시 streak 누적 차단', () => {
      const stripped = stripComments(src);
      // dataUnavailableDominant guard
      expect(stripped).toMatch(/shadowObservablePresent/);
      // isGate1Zero — sanity.violation 직접 분기 대신 ScanSummary 검사로 도출
      // (ADR-0401 절대 원칙 #8 — state machine 캡슐화 보존, sanity.violation === 'GATE1_PASS_ZERO' 직접 분기 부재)
      expect(stripped).toMatch(/isGate1Zero/);
      expect(stripped).toMatch(/gate1Pass < 1/);
      // skip 분기에 shadowObservable 검사 포함
      expect(stripped).toMatch(/!dataUnavailableDominant/);
    });

    it('formatGateEligibilitySplitSection SSOT export — 별도 파일 분리 (ADR-0133)', () => {
      // ADR-0133 1500줄 한계 회피 위해 별도 파일 (gateEligibilitySection.ts) 로 분리.
      // scanDiagnostics.ts 는 re-export (export { ... } from './gateEligibilitySection.js')
      const stripped = stripComments(src);
      expect(stripped).toMatch(/formatGateEligibilitySplitSection/);
      expect(stripped).toMatch(/export.*formatGateEligibilitySplitSection.*from.*gateEligibilitySection/);
      // 별도 파일 존재 확인
      const sectionSrc = readFileSync(
        'server/trading/signalScanner/gateEligibilitySection.ts',
        'utf-8',
      );
      expect(sectionSrc).toMatch(/export function formatGateEligibilitySplitSection/);
    });

    it('ADR-0436 추적 주석 본문 명시', () => {
      expect(src).toContain('ADR-0436');
    });

    it('LOOSEN_GATE / "Gate threshold 완화" 위험 권고 메시지 부재 (회귀 차단)', () => {
      const stripped = stripComments(src);
      expect(stripped).not.toMatch(/LOOSEN_GATE/);
    });
  });
});
