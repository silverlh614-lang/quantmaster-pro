/**
 * @responsibility check_ssot_single_funnel 회귀 테스트 (ADR-0555 P1)
 *
 * 검증:
 *   (i)   현 코드베이스 EXIT 0 (baseline allowlist grandfather 증명)
 *   (ii)  Gate evaluator import type → 위반 아님 (R1 오탐 방지)
 *   (iii) Gate evaluator 의 runtime provider import → 위반 (R1)
 *   (iv)  telegram renderer provider import → 위반 (R2)
 *   (v)   주석 내 provider 토큰 → 위반 아님 (false positive 차단)
 *   (vi)  동적 await import provider → 위반 탐지
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { checkFile } from './check_ssot_single_funnel.js';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';

const __filename = fileURLToPath(import.meta.url);
const ROOT = join(dirname(__filename), '..');

const R1 = {
  id: 'R1',
  name: 'Gate-evaluator-isolation',
  allowedFunnel: 'SourceSnapshot.featuresBySymbol',
  invariant: '불변식 #9',
};
const R2 = {
  id: 'R2',
  name: 'Telegram-projection-isolation',
  allowedFunnel: 'snapshotBundle projection',
  invariant: '불변식 #3',
};

/** 임시 파일에 src 를 써서 checkFile 로 검사. */
function checkSrc(src, rule, name = 'fixture.ts') {
  const dir = mkdtempSync(join(tmpdir(), 'ssot-guard-'));
  const abs = join(dir, name);
  writeFileSync(abs, src, 'utf-8');
  try {
    return checkFile(abs, `server/quant/conditions/${name}`, rule);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('check_ssot_single_funnel guard rules', () => {
  it('(i) current repo passes (baseline allowlist grandfather)', () => {
    let exitCode = 0;
    try {
      execSync('node scripts/check_ssot_single_funnel.js', {
        cwd: ROOT,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      exitCode = err.status ?? 1;
    }
    expect(exitCode).toBe(0);
  });

  it('(ii) import type from provider client is NOT a violation (R1 false-positive guard)', () => {
    const src = [
      "import type { KisInvestorFlow } from '../../clients/kisClient.js';",
      "import { type DartFinancials } from '../../clients/dartFinancialClient.js';",
    ].join('\n');
    expect(checkSrc(src, R1)).toHaveLength(0);
  });

  it('(iii) runtime provider import in a Gate evaluator IS a violation (R1)', () => {
    const src = "import { fetchCurrentPrice } from '../../clients/kisClient.js';";
    const v = checkSrc(src, R1);
    expect(v).toHaveLength(1);
    expect(v[0].ruleId).toBe('R1');
  });

  it('(iv) provider import in a telegram renderer IS a violation (R2)', () => {
    const src = "import { getKrxBldFailureStates } from '../../clients/krxClient.js';";
    const v = checkSrc(src, R2);
    expect(v).toHaveLength(1);
    expect(v[0].ruleId).toBe('R2');
  });

  it('(v) provider token inside a comment is NOT a violation (false-positive guard)', () => {
    const src = [
      "// import { fetchCurrentPrice } from '../../clients/kisClient.js';",
      "/* see ../../clients/krxClient.js for details */",
    ].join('\n');
    expect(checkSrc(src, R1)).toHaveLength(0);
  });

  it('(vi) dynamic await import of provider client IS detected', () => {
    const src = "const { kisPost } = await import('../../clients/kisClient.js');";
    const v = checkSrc(src, R1);
    expect(v).toHaveLength(1);
    expect(v[0].spec).toContain('kisClient');
  });
});
