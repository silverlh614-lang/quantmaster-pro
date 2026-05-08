/**
 * @responsibility ADR-0448 Phase 0 — /scan_blockers wiring 정적 가드.
 *
 * scanBlockers.cmd 에 SectorEnergy execution impact compact line + R3 Noise Governor
 * compact line wiring 정합 검증. 정적 grep 가드 — KIS 주문 함수 import 0 / autoTradeEngine
 * import 0 / 외부 API 신규 호출 0 / try/catch 격리.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SCAN_BLOCKERS_PATH = resolve(__dirname, 'scanBlockers.cmd.ts');
const SCAN_DIAGNOSTICS_PATH = resolve(
  __dirname,
  '../../../trading/signalScanner/scanDiagnostics.ts',
);

const scanBlockersSrc = readFileSync(SCAN_BLOCKERS_PATH, 'utf8');
const scanDiagnosticsSrc = readFileSync(SCAN_DIAGNOSTICS_PATH, 'utf8');

describe('ADR-0448 Phase 0 — scanBlockers wiring 정적 가드', () => {
  describe('Group A — SectorEnergy execution impact wiring', () => {
    it('scanBlockers.cmd 가 deriveSectorEnergyExecutionImpact import', () => {
      expect(scanBlockersSrc).toContain('deriveSectorEnergyExecutionImpact');
      expect(scanBlockersSrc).toContain(
        "from '../../../clients/sectorEnergyExecutionImpact.js'",
      );
    });

    it('formatSectorEnergyExecutionImpactCompactLine 호출', () => {
      expect(scanBlockersSrc).toContain('formatSectorEnergyExecutionImpactCompactLine');
    });

    it('isSectorEnergyExecutionDecouplingDisabled ENV 우회 사용', () => {
      expect(scanBlockersSrc).toContain('isSectorEnergyExecutionDecouplingDisabled');
    });

    it('try/catch 격리 — 진단 throw 가 base 메시지 차단 안 함', () => {
      // execution impact 섹션 빌드 try/catch 가 ADR-0448 마커와 함께 존재
      const adr0448Region = scanBlockersSrc.match(
        /ADR-0448[\s\S]*?try\s*\{[\s\S]*?catch[\s\S]*?\}/,
      );
      expect(adr0448Region).toBeTruthy();
    });

    it('parts.push(executionImpactLine) — base 메시지 뒤에 append', () => {
      expect(scanBlockersSrc).toContain('parts.push(executionImpactLine)');
    });
  });

  describe('Group B — R3 Noise Governor wiring (scanDiagnostics)', () => {
    it('scanDiagnostics 가 r3NoiseGovernor compact line + wiring helper import', () => {
      // ADR-0448 Phase 0 — wiring 본체는 r3NoiseGovernorWiring.ts 로 분리 (SRP / 1500줄 임계 보호).
      // scanDiagnostics 는 compact line + buildR3NoiseDecision 위임만 import.
      expect(scanDiagnosticsSrc).toContain('formatR3NoiseGovernorCompactLine');
      expect(scanDiagnosticsSrc).toContain('buildR3NoiseDecision');
      expect(scanDiagnosticsSrc).toContain("from './r3NoiseGovernor.js'");
      expect(scanDiagnosticsSrc).toContain("from './r3NoiseGovernorWiring.js'");
    });

    it('formatScanBlockersMessage 가 r3NoiseDecision compact line 추가', () => {
      expect(scanDiagnosticsSrc).toContain('summary.r3NoiseDecision');
      expect(scanDiagnosticsSrc).toContain('formatR3NoiseGovernorCompactLine(summary.r3NoiseDecision)');
    });

    it('persistScanResults 가 r3NoiseDecision 영속 (ScanSummary.r3NoiseDecision)', () => {
      expect(scanDiagnosticsSrc).toContain('_lastScanSummary.r3NoiseDecision = r3NoiseDecision');
    });

    it('persistScanResults 가 streakImpact===0 시 streak 갱신 skip', () => {
      expect(scanDiagnosticsSrc).toContain('noiseGovernorSkip');
      expect(scanDiagnosticsSrc).toContain("r3NoiseDecision?.streakImpact === 0");
    });

    it('ScanSummary 에 r3NoiseDecision 옵셔널 필드 추가 + R3NoiseGovernorDecision 타입 import', () => {
      expect(scanDiagnosticsSrc).toContain('r3NoiseDecision?: R3NoiseGovernorDecision');
      // type 본체는 r3NoiseGovernor.ts 에 정의 — `liveBlockPreserved: true` literal type 강제.
      const r3NoiseGovernorPath = resolve(
        __dirname,
        '../../../trading/signalScanner/r3NoiseGovernor.ts',
      );
      const r3NoiseGovernorSrc = readFileSync(r3NoiseGovernorPath, 'utf8');
      expect(r3NoiseGovernorSrc).toContain('liveBlockPreserved: true');
    });
  });

  describe('Group C — 절대 불변식 (LIVE 매매 차단 전파 부재)', () => {
    const FORBIDDEN_KIS_ORDER = [
      'placeKisMarketBuyOrder',
      'placeKisSellOrder',
      'placeKisStopLossOrder',
      'placeKisTakeProfitOrder',
      'cancelKisOrder',
    ];

    it.each(FORBIDDEN_KIS_ORDER)('scanBlockers.cmd KIS 주문 함수 %s import 0건', (fn) => {
      // 코드 내 실제 호출/import 만 검사 (주석/문자열 안에 단어가 등장해도 무관)
      const lines = scanBlockersSrc.split('\n');
      const hits = lines.filter((line) => {
        if (line.trim().startsWith('//')) return false;
        if (line.trim().startsWith('*')) return false;
        return line.includes(fn);
      });
      expect(hits).toHaveLength(0);
    });

    it('scanBlockers.cmd autoTradeEngine import 0건', () => {
      expect(scanBlockersSrc).not.toMatch(/from ['"][^'"]*autoTradeEngine[^'"]*['"]/);
    });

    it('scanBlockers.cmd orderExecutor import 0건', () => {
      expect(scanBlockersSrc).not.toMatch(/from ['"][^'"]*orderExecutor[^'"]*['"]/);
    });

    it('scanBlockers.cmd trancheExecutor import 0건', () => {
      expect(scanBlockersSrc).not.toMatch(/from ['"][^'"]*trancheExecutor[^'"]*['"]/);
    });

    it('scanBlockers.cmd setGateThreshold / GATE_RELAX / STRONG_BUY_OVERRIDE 신규 사용 0건', () => {
      expect(scanBlockersSrc).not.toContain('setGateThreshold');
      expect(scanBlockersSrc).not.toContain('GATE_RELAX');
      expect(scanBlockersSrc).not.toContain('STRONG_BUY_OVERRIDE');
    });

    it('scanBlockers.cmd 신규 fetch/axios/node-fetch import 0건', () => {
      // ADR-0448 wiring 영역 (Phase 0 추가) 안에 외부 호출 0
      expect(scanBlockersSrc).not.toMatch(/import .* from ['"]axios['"]/);
      expect(scanBlockersSrc).not.toMatch(/import .* from ['"]node-fetch['"]/);
    });
  });

  describe('Group D — Telegram HTML 안전성', () => {
    it('compact line raw <b> 태그 부재 (HTML parse failure 방지)', () => {
      // formatSectorEnergyExecutionImpactCompactLine + formatR3NoiseGovernorCompactLine
      // 모두 plain text — 호출자 측에서 부분 escape 의무 없음.
      expect(scanBlockersSrc).not.toContain('<b>SectorEnergy:');
      expect(scanBlockersSrc).not.toContain('<b>R3 Noise:');
    });
  });
});
