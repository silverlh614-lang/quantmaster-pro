// @responsibility ADR-0343 sectorEnergy macroState 캐시 fallback 회귀
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildSectorEnergyInputsWithMetaWithFallback,
  isSectorEnergyFallbackDisabled,
  SECTOR_ENERGY_FALLBACK_MAX_AGE_HOURS,
} from './sectorEnergyProvider.js';

vi.mock('./sectorEnergyProvider.js', async () => {
  const actual = await vi.importActual<typeof import('./sectorEnergyProvider.js')>(
    './sectorEnergyProvider.js',
  );
  return {
    ...actual,
    buildSectorEnergyInputsWithMeta: vi.fn(),
  };
});

vi.mock('../persistence/macroStateRepo.js', () => ({
  loadMacroState: vi.fn(),
}));

const ORIGINAL_DISABLED = process.env.SECTOR_ENERGY_FALLBACK_DISABLED;

beforeEach(() => {
  delete process.env.SECTOR_ENERGY_FALLBACK_DISABLED;
  vi.clearAllMocks();
});

afterEach(() => {
  if (ORIGINAL_DISABLED === undefined) delete process.env.SECTOR_ENERGY_FALLBACK_DISABLED;
  else process.env.SECTOR_ENERGY_FALLBACK_DISABLED = ORIGINAL_DISABLED;
});

describe('SSOT 상수 (ADR-0343)', () => {
  it('SECTOR_ENERGY_FALLBACK_MAX_AGE_HOURS = 48', () => {
    expect(SECTOR_ENERGY_FALLBACK_MAX_AGE_HOURS).toBe(48);
  });
});

describe('isSectorEnergyFallbackDisabled — ENV 정확 비교 (ADR-0157)', () => {
  it('미설정 → false (default 활성)', () => {
    expect(isSectorEnergyFallbackDisabled()).toBe(false);
  });
  it('"true" → true (fallback 비활성)', () => {
    process.env.SECTOR_ENERGY_FALLBACK_DISABLED = 'true';
    expect(isSectorEnergyFallbackDisabled()).toBe(true);
  });
  it('"1" / "TRUE" → false (정확 비교)', () => {
    process.env.SECTOR_ENERGY_FALLBACK_DISABLED = '1';
    expect(isSectorEnergyFallbackDisabled()).toBe(false);
    process.env.SECTOR_ENERGY_FALLBACK_DISABLED = 'TRUE';
    expect(isSectorEnergyFallbackDisabled()).toBe(false);
  });
});

// 정적 grep 가드 — 기존 buildSectorEnergyInputsWithMeta 본체 무수정 검증
describe('buildSectorEnergyInputsWithMetaWithFallback 정적 가드', () => {
  it('export 가능 — wrapper 함수 정의 존재', () => {
    expect(buildSectorEnergyInputsWithMetaWithFallback).toBeTypeOf('function');
  });
  it('isSectorEnergyFallbackDisabled export 가능', () => {
    expect(isSectorEnergyFallbackDisabled).toBeTypeOf('function');
  });
});

// 소스 정적 grep 가드
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SOURCE = readFileSync(
  resolve(__dirname, 'sectorEnergyProvider.ts'),
  'utf-8',
);

describe('sectorEnergyProvider.ts 정적 가드 (ADR-0343)', () => {
  it('SECTOR_ENERGY_FALLBACK_MAX_AGE_HOURS = 48 SSOT', () => {
    expect(SOURCE).toMatch(/SECTOR_ENERGY_FALLBACK_MAX_AGE_HOURS\s*=\s*48/);
  });

  it('FAILED 분기 → STALE 마커 부여', () => {
    expect(SOURCE).toMatch(/dataQuality:\s*'STALE'/);
  });

  it('48h 이내 ageHours 검증', () => {
    expect(SOURCE).toMatch(/ageHours\s*<\s*SECTOR_ENERGY_FALLBACK_MAX_AGE_HOURS/);
  });

  it('macroStateRepo dynamic import (절대 규칙 #3 정합)', () => {
    expect(SOURCE).toMatch(/await\s+import\(\s*'\.\.\/persistence\/macroStateRepo/);
  });

  it('FAILED 외 모든 결과 그대로 반환', () => {
    expect(SOURCE).toMatch(/result\.dataQuality\s*!==\s*'FAILED'/);
  });

  it('ENV DISABLED 우회 — 원본 결과 그대로 (ADR-0399 attachDiagnostics 적용 후 정합 정정)', () => {
    // ADR-0399: 본 PR 머지 후 `if (isSectorEnergyFallbackDisabled()) return result;` 패턴이
    // `return attachDiagnostics(result, ...)` 로 격상. 진단 메타 영속 의도 보존.
    expect(SOURCE).toMatch(
      /if\s*\(isSectorEnergyFallbackDisabled\(\)\)\s*return\s+attachDiagnostics\(/,
    );
  });

  it('진단 로그 ADR-0343 마커', () => {
    expect(SOURCE).toMatch(/ADR-0343/);
  });

  it('NaN/Infinity 안전 fallback (Number.isFinite)', () => {
    expect(SOURCE).toMatch(/Number\.isFinite\(updatedAtMs\)/);
  });

  it('inputs 부재 또는 updatedAt 부재 시 원본 반환 (ADR-0397 wiring 후 chain 패턴 정합)', () => {
    // ADR-0397 (PR-2) 가 L4 Yahoo ETF wiring 추가 시 분기 패턴을 if-early-return 에서
    // chain (`if (cached?.X && cached.Y) { ... }`) 로 변경. 둘 다 정합 — 의미 동일.
    const negCheck = /!cached\.sectorEnergyInputs\s*\|\|\s*!cached\.sectorEnergyInputsUpdatedAt/;
    const posCheck = /cached\?\.sectorEnergyInputs\s+&&\s+cached\.sectorEnergyInputsUpdatedAt/;
    expect(SOURCE.match(negCheck) || SOURCE.match(posCheck)).toBeTruthy();
  });

  it('호출자 0건 (Phase 1 dead code) — 본 PR scope', () => {
    // wrapper 가 다른 모듈에서 import 되지 않음을 외부 grep 으로 확인 가능.
    // 본 테스트는 함수 export 되어 있음만 검증.
    expect(SOURCE).toMatch(/export\s+async\s+function\s+buildSectorEnergyInputsWithMetaWithFallback/);
  });
});
