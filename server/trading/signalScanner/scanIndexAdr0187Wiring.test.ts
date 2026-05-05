// @responsibility ADR-0187 — runAutoSignalScan 의 sectorEnergy macroState carry-over 정적 가드.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const indexSrc = readFileSync(path.join(here, 'index.ts'), 'utf-8');

describe('ADR-0187 — runAutoSignalScan sectorEnergy carry-over 정적 가드', () => {
  it('정상 경로 persistScanResults 호출 (라인 67~) 가 sectorEnergyDataQuality carry-over', () => {
    // macroState.sectorEnergyDataQuality → ScanSummary.sectorEnergyQuality 매핑.
    // 이전엔 영속만 되고 read 호출자 0건 (silent dead-read) → /scan_blockers 메시지에서 미노출.
    expect(indexSrc).toMatch(/sectorEnergyDataQuality/);
    expect(indexSrc).toMatch(/sectorEnergyQuality:\s*macro\.sectorEnergyDataQuality/);
  });

  it('validSectorCount + sectorEnergyReasons 동시 carry-over (3 필드 묶음)', () => {
    expect(indexSrc).toMatch(/validSectorCount:\s*macro\.sectorEnergyValidSectorCount/);
    expect(indexSrc).toMatch(/sectorEnergyReasons:\s*macro\.sectorEnergyReasons/);
  });

  it('preflight abort 경로도 sectorEnergy carry-over (정상 경로와 정합)', () => {
    // L42 sellOnly skip / R6 / VIX / FOMC 차단 등 abort 경로도 동일 carry-over.
    // abortMacro 식별자로 확인 — 정상 경로의 macro 와 별개.
    expect(indexSrc).toMatch(/abortMacro\?\.sectorEnergyDataQuality/);
    expect(indexSrc).toMatch(/abortMacro\.sectorEnergyValidSectorCount/);
    expect(indexSrc).toMatch(/abortMacro\.sectorEnergyReasons/);
  });

  it('macroState 부재 시 carry-over skip (옵셔널 spread 패턴)', () => {
    // sectorEnergyDataQuality !== undefined 가드로 macroState 부재 시 자연 skip.
    // 후방호환 — 기존 호출자 무영향.
    expect(indexSrc).toMatch(/sectorEnergyDataQuality\s*!==\s*undefined/);
  });

  it('ADR-0187 추적 주석 명시 (drift 차단)', () => {
    expect(indexSrc).toMatch(/ADR-0187/);
  });

  it('persistScanResults 호출 수 정확 (정상 1 + abort 1 = 2회)', () => {
    const matches = indexSrc.match(/await persistScanResults\(/g) ?? [];
    expect(matches.length).toBe(2);
  });

  it('macroState SSOT 단일 read — buildMacroGateState 외 추가 인자 spread 패턴', () => {
    // preflightResult.context.macroState 단일 출처 — 다른 macroState 영속 read 0건.
    expect(indexSrc).toMatch(/preflightResult\.context\?\.macroState/);
  });
});
