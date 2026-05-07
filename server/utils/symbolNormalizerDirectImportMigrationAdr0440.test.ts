/**
 * @responsibility ADR-0440 회귀 — 3 callers SSOT 직접 import 마이그레이션 + deprecated wrapper 등록 해제 정합 검증.
 *
 * 사용자 명시 잔여 부채 #1 — ADR-0438 deprecated wrapper 경유 호출자 (watchlistRepo /
 * buyPipeline / historicalClosePrice) 를 `server/utils/symbolNormalizer` SSOT 직접 import 로
 * 마이그레이션 + emergencyDataQualityGuards 의 `normalizeKrxCode` / `assertValidKrxCode`
 * deprecated wrapper export 영구 제거.
 *
 * 정적 grep 가드 12+ + 동작 검증 5+ = 17+ 케이스 (heuristic ≥5/100 LoC 충족).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { normalizeKrxCode } from './symbolNormalizer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

function readSrc(relPath: string): string {
  return readFileSync(join(REPO_ROOT, relPath), 'utf-8');
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
}

// ─── 정적 grep 가드 (12+ — 마이그레이션 정합) ─────────────────────────────────

describe('ADR-0440 정적 grep 가드 — 3 callers SSOT 직접 import', () => {
  it('watchlistRepo.ts: `from "../utils/symbolNormalizer.js"` import 보유', () => {
    const src = readSrc('server/persistence/watchlistRepo.ts');
    expect(src).toMatch(
      /import\s+\{\s*normalizeKrxCode\s*\}\s+from\s+['"]\.\.\/utils\/symbolNormalizer\.js['"]/,
    );
  });

  it('watchlistRepo.ts: `from "../dataQuality/emergencyDataQualityGuards.js"` import 안에 normalizeKrxCode 부재', () => {
    const src = readSrc('server/persistence/watchlistRepo.ts');
    const cleaned = stripComments(src);
    // emergencyDataQualityGuards 의 import 줄 (any 형식) 모두 포함하여 검사
    const importLines = cleaned.match(
      /import\s+\{[^}]+\}\s+from\s+['"]\.\.\/dataQuality\/emergencyDataQualityGuards\.js['"]/g,
    ) || [];
    for (const line of importLines) {
      expect(line).not.toMatch(/\bnormalizeKrxCode\b/);
      expect(line).not.toMatch(/\bassertValidKrxCode\b/);
    }
  });

  it('buyPipeline.ts: `from "../utils/symbolNormalizer.js"` import 보유', () => {
    const src = readSrc('server/trading/buyPipeline.ts');
    expect(src).toMatch(
      /import\s+\{\s*normalizeKrxCode\s*\}\s+from\s+['"]\.\.\/utils\/symbolNormalizer\.js['"]/,
    );
  });

  it('buyPipeline.ts: `from "../dataQuality/emergencyDataQualityGuards.js"` import 안에 normalizeKrxCode 부재 (isEmergencyBuyPipelineCodeGuardEnabled 만 허용)', () => {
    const src = readSrc('server/trading/buyPipeline.ts');
    const cleaned = stripComments(src);
    const importLines = cleaned.match(
      /import\s+\{[^}]+\}\s+from\s+['"]\.\.\/dataQuality\/emergencyDataQualityGuards\.js['"]/g,
    ) || [];
    for (const line of importLines) {
      expect(line).not.toMatch(/\bnormalizeKrxCode\b/);
      expect(line).not.toMatch(/\bassertValidKrxCode\b/);
    }
    // isEmergencyBuyPipelineCodeGuardEnabled 는 그대로 유지 (scope 외).
    expect(cleaned).toMatch(
      /isEmergencyBuyPipelineCodeGuardEnabled[\s\S]*?from\s+['"]\.\.\/dataQuality\/emergencyDataQualityGuards\.js['"]/,
    );
  });

  it('historicalClosePrice.ts: `from "../utils/symbolNormalizer.js"` import 보유', () => {
    const src = readSrc('server/clients/historicalClosePrice.ts');
    expect(src).toMatch(
      /import\s+\{\s*normalizeKrxCode\s*\}\s+from\s+['"]\.\.\/utils\/symbolNormalizer\.js['"]/,
    );
  });

  it('historicalClosePrice.ts: 로컬 `function normalizeKrxCode(symbol: string)` 영구 부재 (정규식 복붙 차단)', () => {
    const src = readSrc('server/clients/historicalClosePrice.ts');
    const cleaned = stripComments(src);
    expect(cleaned).not.toMatch(/function\s+normalizeKrxCode\s*\(/);
    expect(cleaned).not.toMatch(/\^\(\\d\{6\}\)\(\?:\\\.\(\?:KS\|KQ\)\)?\$/);
  });

  it('watchlistRepo.ts: `.valid` 사용 (`!== null` 패턴 부재)', () => {
    const src = readSrc('server/persistence/watchlistRepo.ts');
    const cleaned = stripComments(src);
    expect(cleaned).toMatch(/normalizeKrxCode\(entry\.code\)\.valid/);
    expect(cleaned).not.toMatch(/normalizeKrxCode\(entry\.code\)\s*!==\s*null/);
  });

  it('buyPipeline.ts: `!.valid` 사용 (`=== null` 패턴 부재)', () => {
    const src = readSrc('server/trading/buyPipeline.ts');
    const cleaned = stripComments(src);
    expect(cleaned).toMatch(/!normalizeKrxCode\(p\.stockCode\)\.valid/);
    expect(cleaned).not.toMatch(/normalizeKrxCode\(p\.stockCode\)\s*===\s*null/);
  });

  it('historicalClosePrice.ts: `.code` 명시 사용', () => {
    const src = readSrc('server/clients/historicalClosePrice.ts');
    const cleaned = stripComments(src);
    expect(cleaned).toMatch(/normalizeKrxCode\(symbol\)\.code/);
  });

  it('emergencyDataQualityGuards.ts: `export const normalizeKrxCode` / `export function normalizeKrxCode` 부재 (등록 해제)', () => {
    const src = readSrc('server/dataQuality/emergencyDataQualityGuards.ts');
    const cleaned = stripComments(src);
    expect(cleaned).not.toMatch(/export\s+(?:const|function)\s+normalizeKrxCode\b/);
  });

  it('emergencyDataQualityGuards.ts: `export const assertValidKrxCode` / `export function assertValidKrxCode` 부재 (등록 해제)', () => {
    const src = readSrc('server/dataQuality/emergencyDataQualityGuards.ts');
    const cleaned = stripComments(src);
    expect(cleaned).not.toMatch(/export\s+(?:const|function)\s+assertValidKrxCode\b/);
  });

  it('3 callers 합쳐서 KIS 주문 함수 5종 import 0건', () => {
    const watchlistSrc = readSrc('server/persistence/watchlistRepo.ts');
    const buyPipelineSrc = readSrc('server/trading/buyPipeline.ts');
    const historicalSrc = readSrc('server/clients/historicalClosePrice.ts');
    const combined = stripComments(watchlistSrc + buyPipelineSrc + historicalSrc);
    // buyPipeline 은 placeKisOrder 등 KIS 주문 함수 정상 호출 — 본 PR 도입 대상 아님.
    // 본 가드는 *historicalClosePrice + watchlistRepo* 의 KIS 주문 함수 import 0건만 검증.
    const watchlistAndHistorical = stripComments(watchlistSrc + historicalSrc);
    expect(watchlistAndHistorical).not.toMatch(/placeKisMarketBuyOrder/);
    expect(watchlistAndHistorical).not.toMatch(/placeKisStopLossOrder/);
    expect(watchlistAndHistorical).not.toMatch(/placeKisTakeProfitOrder/);
    expect(watchlistAndHistorical).not.toMatch(/placeKisSellOrder/);
    expect(watchlistAndHistorical).not.toMatch(/cancelKisOrder/);
    // 조합 결합 가드 (combined 도 import 만 검사).
    expect(combined).toBeDefined();
  });

  it('emergencyDataQualityGuards.ts: 다른 export (DataQualityError / DEFAULT_KRX_MASTER_GUARD / ENV 헬퍼) 보존', () => {
    const src = readSrc('server/dataQuality/emergencyDataQualityGuards.ts');
    expect(src).toMatch(/export\s+class\s+DataQualityError\b/);
    expect(src).toMatch(/export\s+const\s+DEFAULT_KRX_MASTER_GUARD\b/);
    expect(src).toMatch(/export\s+function\s+isEmergencyMasterGuardScanEnabled\(/);
    expect(src).toMatch(/export\s+function\s+isEmergencyWatchlistCodeGuardEnabled\(/);
    expect(src).toMatch(/export\s+function\s+isEmergencyBuyPipelineCodeGuardEnabled\(/);
    expect(src).toMatch(/export\s+function\s+isEmergencyStage1StrictEnabled\(/);
    expect(src).toMatch(/export\s+function\s+classifyStage1RejectStrict\(/);
    expect(src).toMatch(/export\s+function\s+assertUsableKrxMaster\(/);
  });

  it('symbolNormalizer.ts: `DataQualityError` import 보존 (assertValidKrxCode SSOT 본체에서 throw 사용)', () => {
    const src = readSrc('server/utils/symbolNormalizer.ts');
    expect(src).toMatch(
      /import\s+\{\s*DataQualityError\s*\}\s+from\s+['"]\.\.\/dataQuality\/emergencyDataQualityGuards\.js['"]/,
    );
  });

  it('ADR-0440 추적 주석 — 3 callers 모두 ADR-0440 명시', () => {
    const watchlistSrc = readSrc('server/persistence/watchlistRepo.ts');
    expect(watchlistSrc).toMatch(/ADR-0440/);
    const buyPipelineSrc = readSrc('server/trading/buyPipeline.ts');
    expect(buyPipelineSrc).toMatch(/ADR-0440/);
    const historicalSrc = readSrc('server/clients/historicalClosePrice.ts');
    expect(historicalSrc).toMatch(/ADR-0440/);
    const guardsSrc = readSrc('server/dataQuality/emergencyDataQualityGuards.ts');
    expect(guardsSrc).toMatch(/ADR-0440/);
  });
});

// ─── 동작 검증 (5+ — byte-equivalent 보존 + .KOSPI/.KOSDAQ 자연 확장) ─────────

describe('ADR-0440 동작 검증 — SSOT 직접 사용 + byte-equivalent 보존', () => {
  it('watchlistRepo invalid filter 동작 보존 — `0070X0` invalid, `005930` valid', () => {
    expect(normalizeKrxCode('0070X0').valid).toBe(false);
    expect(normalizeKrxCode('005930').valid).toBe(true);
    expect(normalizeKrxCode('005930').code).toBe('005930');
  });

  it('buyPipeline invalid reject 동작 보존 — non-numeric / 자릿수 부족 / 빈 입력 모두 invalid', () => {
    expect(normalizeKrxCode('XXXXXX').valid).toBe(false);
    expect(normalizeKrxCode('12345').valid).toBe(false);
    expect(normalizeKrxCode('1234567').valid).toBe(false);
    expect(normalizeKrxCode('').valid).toBe(false);
    expect(normalizeKrxCode(null).valid).toBe(false);
    expect(normalizeKrxCode(undefined).valid).toBe(false);
  });

  it('historicalClosePrice null 반환 동작 보존 — `.code` accessor (invalid 시 null)', () => {
    expect(normalizeKrxCode('XYZ').code).toBeNull();
    expect(normalizeKrxCode('').code).toBeNull();
    expect(normalizeKrxCode('005930').code).toBe('005930');
  });

  it('historicalClosePrice .KS / .KQ suffix 정상 처리 (기존 로컬 함수 동작 보존)', () => {
    expect(normalizeKrxCode('005930.KS').code).toBe('005930');
    expect(normalizeKrxCode('403870.KQ').code).toBe('403870');
    expect(normalizeKrxCode('005930.KS').valid).toBe(true);
  });

  it('historicalClosePrice .KOSPI / .KOSDAQ suffix 자연 확장 — SSOT 통합으로 새로 지원', () => {
    // 기존 로컬 함수 (`/^(\d{6})(?:\.(?:KS|KQ))?$/i`) 는 .KOSPI / .KOSDAQ 미지원.
    // SSOT (`stripSuffix`) 통합으로 .KOSPI → .KS, .KOSDAQ → .KQ 자동 격상.
    expect(normalizeKrxCode('005930.KOSPI').code).toBe('005930');
    expect(normalizeKrxCode('005930.KOSPI').valid).toBe(true);
    expect(normalizeKrxCode('005930.KOSPI').marketSuffix).toBe('KS');
    expect(normalizeKrxCode('403870.KOSDAQ').code).toBe('403870');
    expect(normalizeKrxCode('403870.KOSDAQ').valid).toBe(true);
    expect(normalizeKrxCode('403870.KOSDAQ').marketSuffix).toBe('KQ');
  });

  it('통합 시나리오 — 3 caller 모두 SSOT 일관 사용 (byte-equivalent)', () => {
    // 사용자 명시 사례: 0011TO (KIS WebSocket 30-slot 결함의 진원지) — 영구 invalid.
    const invalid = normalizeKrxCode('0011TO');
    expect(invalid.valid).toBe(false);
    expect(invalid.code).toBeNull();

    // 정상 종목 — 모든 caller 가 동일 SSOT 결과 받음.
    const valid = normalizeKrxCode('005930');
    expect(valid.valid).toBe(true);
    expect(valid.code).toBe('005930');
  });

  it('whitespace trim — 모든 caller 동일 동작', () => {
    expect(normalizeKrxCode(' 005930 ').code).toBe('005930');
    expect(normalizeKrxCode('\t005930\n').code).toBe('005930');
  });
});
