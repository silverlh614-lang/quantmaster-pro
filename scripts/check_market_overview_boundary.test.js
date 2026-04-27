/**
 * @responsibility check_market_overview_boundary 회귀 테스트 (ADR-0067)
 *
 * 본 lint script 가:
 *   1) 현재 baseline (server/ 0건 위반) 통과
 *   2) FORBIDDEN_PREFIXES 의 fixture 파일에서 marketOverview import 발견 시 FAIL
 *   3) FORBIDDEN_EXACT (aiUniverseService) 의 fixture 에서 import 발견 시 FAIL
 *   4) 주석 안 import 는 무시 (false positive 차단)
 *   5) UI 화이트리스트 (src/components/**) 의 import 는 검사 대상 아님 (server/ 만 walk)
 */
import { describe, it, expect, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { writeFileSync, unlinkSync, mkdirSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const FIXTURE_DIR = join(ROOT, 'server', 'trading', '__lint_fixtures__');

function runLint() {
  try {
    const out = execSync('node scripts/check_market_overview_boundary.js', {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { exitCode: 0, output: out };
  } catch (err) {
    return {
      exitCode: err.status ?? 1,
      output: (err.stdout?.toString() ?? '') + (err.stderr?.toString() ?? ''),
    };
  }
}

afterEach(() => {
  if (existsSync(FIXTURE_DIR)) {
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  }
});

describe('check_market_overview_boundary lint script', () => {
  it('현재 baseline (fixture 없을 때) 통과 EXIT=0', () => {
    const result = runLint();
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('OK');
    expect(result.output).toContain('marketOverview 누출 없음');
  });

  it('server/trading/ fixture 에서 marketOverview import 시 FAIL', () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'badImport.ts'),
      "import { getMarketOverview } from '../../src/services/stock/marketOverview';\nexport const x = getMarketOverview;\n",
    );
    const result = runLint();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('badImport.ts');
    expect(result.output).toContain('marketOverview');
  });

  it('useMarketData hook import 시도도 차단', () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'badHook.ts'),
      "import { useMarketData } from '../../src/hooks/useMarketData';\nexport const y = useMarketData;\n",
    );
    const result = runLint();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('badHook.ts');
    expect(result.output).toContain('useMarketData');
  });

  it('useMarketStore import 시도도 차단', () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'badStore.ts'),
      "import { useMarketStore } from '../../src/stores/useMarketStore';\nexport const z = useMarketStore;\n",
    );
    const result = runLint();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('badStore.ts');
    expect(result.output).toContain('useMarketStore');
  });

  it('주석 안 import 는 무시 (false positive 차단)', () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'commentOnly.ts'),
      "// 과거에는 import { getMarketOverview } from '../../src/services/stock/marketOverview';\n// 였지만 ADR-0067 로 차단\nexport const safe = true;\n",
    );
    const result = runLint();
    expect(result.exitCode).toBe(0);
  });

  it('marketOverviewCache import 도 차단 (ADR-0066 SWR 캐시)', () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'badCache.ts'),
      "import { getOrFetchAiResponse } from '../../src/services/stock/marketOverviewCache';\nexport const w = getOrFetchAiResponse;\n",
    );
    const result = runLint();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('marketOverviewCache');
  });

  it('marketOverviewIndicators import 도 차단 (ADR-0064 prefill)', () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'badIndicators.ts'),
      "import { fetchPrefilledMarketData } from '../../src/services/stock/marketOverviewIndicators';\nexport const v = fetchPrefilledMarketData;\n",
    );
    const result = runLint();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('marketOverviewIndicators');
  });

  it('dynamic import (await import()) 도 차단', () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'badDynamic.ts'),
      "export async function loadIt() {\n  const mod = await import('../../src/services/stock/marketOverview');\n  return mod;\n}\n",
    );
    const result = runLint();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('badDynamic.ts');
  });

  it('다중 위반 시 모두 보고 + 총 카운트 표시', () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURE_DIR, 'multi1.ts'),
      "import { getMarketOverview } from '../../src/services/stock/marketOverview';\n",
    );
    writeFileSync(
      join(FIXTURE_DIR, 'multi2.ts'),
      "import { useMarketData } from '../../src/hooks/useMarketData';\n",
    );
    const result = runLint();
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('multi1.ts');
    expect(result.output).toContain('multi2.ts');
    expect(result.output).toContain('총 2건 위반');
  });
});
