/**
 * @responsibility check_ssot_drift_registry 회귀 테스트 (ADR-0560)
 *
 * 검증:
 *   (a) 현 코드베이스 EXIT 0 (grandfather 통과 증명)
 *   (b) 가짜 신규 중복(3번째 isKrxHoliday 정의)이면 위반 탐지
 *   (c) LEGITIMATE_PAIRS owner / allowed 정의는 통과 (false positive 0)
 *   (d) call site · 주석 · import · bare re-export 는 위반 아님 (false positive 0)
 *   (e) GUARDED_SYMBOLS / LEGITIMATE_PAIRS 레지스트리 표 ↔ 코드 입력 일치 단언
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import {
  checkFile,
  GUARDED_SYMBOLS,
  LEGITIMATE_PAIRS,
  isDefinitionLine,
} from './check_ssot_drift_registry.js';

const __filename = fileURLToPath(import.meta.url);
const ROOT = join(dirname(__filename), '..');

/** 임시 파일에 src 를 써서 checkFile 로 검사. */
function checkSrc(src, relPath = 'server/foo/fixture.ts') {
  const dir = mkdtempSync(join(tmpdir(), 'ssot-drift-'));
  const abs = join(dir, 'fixture.ts');
  writeFileSync(abs, src, 'utf-8');
  try {
    return checkFile(abs, relPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('check_ssot_drift_registry guard', () => {
  it('(a) current repo passes (grandfather EXIT 0)', () => {
    let exitCode = 0;
    try {
      execSync('node scripts/check_ssot_drift_registry.js', {
        cwd: ROOT,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      exitCode = err.status ?? 1;
    }
    expect(exitCode).toBe(0);
  });

  it('(b) a fake 3rd isKrxHoliday definition IS detected as a violation', () => {
    const src = 'export function isKrxHoliday(d: string): boolean { return false; }';
    const hits = checkSrc(src, 'server/rogue/fakeHolidays.ts');
    expect(hits).toHaveLength(1);
    expect(hits[0].symbol).toBe('isKrxHoliday');
  });

  it('(c) owner + allowed definitions pass (LEGITIMATE, no false positive)', () => {
    // owner krxHolidays.ts 의 정의 라인 자체는 checkFile 이 hit 으로 잡되,
    // main() 의 owner∪allowed 부분집합 판정에서 위반이 아님. 여기서는 hit 형태만 단언.
    const ownerHit = checkSrc(
      'export function isKrxHoliday(d: string): boolean { return false; }',
      'server/trading/krxHolidays.ts',
    );
    expect(ownerHit[0].symbol).toBe('isKrxHoliday');
    // allowed projection 동명이인 (ssotPipeline UnifiedSourceSnapshot)
    const allowedHit = checkSrc(
      'export interface UnifiedSourceSnapshot { snapshotId: string; }',
      'src/services/autoTrading/ssotPipeline.ts',
    );
    expect(allowedHit[0].symbol).toBe('UnifiedSourceSnapshot');
  });

  it('(d) call site / comment / import / bare re-export are NOT violations', () => {
    const callSite = [
      'const blocked = isKrxHoliday(today);',
      "if (loadOpenPositions().length > 0) doThing();",
    ].join('\n');
    expect(checkSrc(callSite)).toHaveLength(0);

    const comments = [
      '// export function isKrxHoliday(d) {}',
      ' * MarketSession 어휘 설명',
      '/* export const collectUnifiedSnapshot */',
    ].join('\n');
    expect(checkSrc(comments)).toHaveLength(0);

    const imports = [
      "import { isKrxHoliday } from '../trading/krxHolidays.js';",
      "import type { MarketSession } from '../ssotSnapshot.js';",
    ].join('\n');
    expect(checkSrc(imports)).toHaveLength(0);

    // bare re-export (소스 없음) = owner 위임, 신규 정의 아님
    const bareReexport = 'export { addBusinessDaysFromKstDate };';
    expect(checkSrc(bareReexport)).toHaveLength(0);
  });

  it('(d2) re-export-with-source IS a definition-surface (introduces symbol from elsewhere)', () => {
    const reexportFrom =
      "export { getOpenPositions } from '../somewhere/clone.js';";
    const hits = checkSrc(reexportFrom, 'server/rogue/reexport.ts');
    expect(hits).toHaveLength(1);
    expect(hits[0].symbol).toBe('getOpenPositions');
  });

  it('(e) GUARDED_SYMBOLS matches registry §3.1 (8 symbols)', () => {
    expect([...GUARDED_SYMBOLS].sort()).toEqual(
      [
        'addBusinessDaysFromKstDate',
        'addWeekdaysApprox',
        'collectUnifiedSnapshot',
        'getOpenPositions',
        'isKrxHoliday',
        'loadOpenPositions',
        'MarketSession',
        'UnifiedSourceSnapshot',
      ].sort(),
    );
  });

  it('(e2) LEGITIMATE_PAIRS owners match registry §3.2', () => {
    expect(LEGITIMATE_PAIRS.get('isKrxHoliday').owner).toBe('server/trading/krxHolidays.ts');
    expect(LEGITIMATE_PAIRS.get('isKrxHoliday').allowed).toContain(
      'server/calendar/krxTradingCalendar.ts',
    );
    expect(LEGITIMATE_PAIRS.get('UnifiedSourceSnapshot').allowed).toContain(
      'src/services/autoTrading/ssotPipeline.ts',
    );
    expect(LEGITIMATE_PAIRS.get('collectUnifiedSnapshot').owner).toBe(
      'server/trading/symbolDataCollector.ts',
    );
    expect(LEGITIMATE_PAIRS.get('getOpenPositions').owner).toBe(
      'server/persistence/shadowPositionLedger.ts',
    );
    expect(LEGITIMATE_PAIRS.get('loadOpenPositions').owner).toBe(
      'server/persistence/positionTruth.ts',
    );
  });

  it('(f) isDefinitionLine word-boundary: similarly-named symbol is not a false hit', () => {
    expect(isDefinitionLine('export function isKrxHolidayCached(d) {}', 'isKrxHoliday')).toBe(false);
    expect(isDefinitionLine('export function isKrxHoliday(d) {}', 'isKrxHoliday')).toBe(true);
  });
});
