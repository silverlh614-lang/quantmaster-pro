/**
 * @responsibility check_pr_pace_audit.js 회귀 테스트 (PR-Governance 후속 자동화 #3)
 *
 * 검증:
 *   - 상수 SSOT (BOUNDARY_INTERVAL=10 / MIN_PR_THRESHOLD=30)
 *   - parseCommitLog: `(#NNN)` 패턴 + audit prefix 분류
 *   - extractMaxPrNumber: 최대 PR 번호
 *   - findLastAuditPr: 가장 최근 audit-only PR
 *   - scanAuditFolders: `_workspace/audit-pr-N0/` 매칭
 *   - isAuditExempt: PR<30 면제
 *   - computeAuditStatus: boundary 도달 + lastAuditN0 비교
 *   - JSON 모드 출력 정합
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  PR_PACE_CONSTANTS,
  parseCommitLog,
  extractMaxPrNumber,
  findLastAuditPr,
  scanAuditFolders,
  isAuditExempt,
  computeAuditStatus,
} from './check_pr_pace_audit.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

function runLint(args = '') {
  try {
    // stderr 도 stdout 으로 합쳐서 console.warn 출력도 캡처
    const out = execSync(
      `node scripts/check_pr_pace_audit.js ${args} 2>&1`.trim(),
      {
        cwd: ROOT,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    return { exitCode: 0, output: out };
  } catch (err) {
    return {
      exitCode: err.status ?? 1,
      output: (err.stdout?.toString() ?? '') + (err.stderr?.toString() ?? ''),
    };
  }
}

describe('상수 SSOT', () => {
  it('BOUNDARY_INTERVAL=10', () => {
    expect(PR_PACE_CONSTANTS.BOUNDARY_INTERVAL).toBe(10);
  });

  it('MIN_PR_THRESHOLD=30', () => {
    expect(PR_PACE_CONSTANTS.MIN_PR_THRESHOLD).toBe(30);
  });

  it('WARN_HOURS=24, ERROR_HOURS=48', () => {
    expect(PR_PACE_CONSTANTS.WARN_HOURS).toBe(24);
    expect(PR_PACE_CONSTANTS.ERROR_HOURS).toBe(48);
  });
});

describe('parseCommitLog', () => {
  it('정상 git oneline 출력 파싱', () => {
    const log = [
      'd4653a6 docs(governance): PR-Governance-3 ADR-0146 (#502)',
      '868edf1 fix(kis-token): ADR-0147 디스크 영속 (#504)',
      '9c564d5 chore(governance): PR-Governance-2 silent degradation (#501) (#503)',
    ].join('\n');
    const commits = parseCommitLog(log);
    expect(commits).toHaveLength(3);
    expect(commits[0].sha).toBe('d4653a6');
    expect(commits[0].prNumber).toBe(502);
    expect(commits[1].prNumber).toBe(504);
    // (#501) (#503) — 첫 번째 매칭만
    expect(commits[2].prNumber).toBe(501);
  });

  it('PR 번호 부재 시 prNumber=null', () => {
    const log = 'abc1234 wip: random commit message';
    const commits = parseCommitLog(log);
    expect(commits).toHaveLength(1);
    expect(commits[0].prNumber).toBeNull();
  });

  it('audit prefix 인식 — `audit:` `chore(audit):` `docs(audit):`', () => {
    const log = [
      'aaa audit: PR-50 review (#51)',
      'bbb chore(audit): PR-60 review (#61)',
      'ccc docs(audit): PR-70 (#71)',
      'ddd feat(audit): PR-80 (#81)',
      'eee fix(audit): PR-90 (#91)',
    ].join('\n');
    const commits = parseCommitLog(log);
    expect(commits.every((c) => c.isAudit)).toBe(true);
  });

  it('audit 키워드 인식 — "audit-only" / "audit PR" / "N0 audit"', () => {
    const log = [
      'aaa fix: 무언가 audit-only review (#51)',
      'bbb feat: routine audit PR work (#52)',
      'ccc chore: PR-50 N0 audit (#53)',
    ].join('\n');
    const commits = parseCommitLog(log);
    expect(commits.every((c) => c.isAudit)).toBe(true);
  });

  it('non-audit 일반 commit', () => {
    const log = 'abc fix(kis): KIS endpoint 정정 (#504)';
    const commits = parseCommitLog(log);
    expect(commits[0].isAudit).toBe(false);
  });

  it('빈 입력 빈 배열', () => {
    expect(parseCommitLog('')).toEqual([]);
    expect(parseCommitLog(null)).toEqual([]);
  });
});

describe('extractMaxPrNumber', () => {
  it('가장 큰 번호 반환', () => {
    const commits = [
      { prNumber: 100 },
      { prNumber: 50 },
      { prNumber: 200 },
      { prNumber: null },
    ];
    expect(extractMaxPrNumber(commits)).toBe(200);
  });

  it('빈 입력 0', () => {
    expect(extractMaxPrNumber([])).toBe(0);
  });

  it('모두 null 인 경우 0', () => {
    expect(extractMaxPrNumber([{ prNumber: null }, { prNumber: null }])).toBe(0);
  });
});

describe('findLastAuditPr', () => {
  it('가장 최근 audit (commits 순서 = 내림차순) 반환', () => {
    const commits = [
      { prNumber: 100, isAudit: false },
      { prNumber: 90, isAudit: true, message: 'audit: PR-80 review' },
      { prNumber: 80, isAudit: false },
      { prNumber: 50, isAudit: true, message: 'audit: PR-40 review' },
    ];
    const result = findLastAuditPr(commits);
    expect(result.prNumber).toBe(90);
  });

  it('audit 없으면 null', () => {
    const commits = [
      { prNumber: 100, isAudit: false },
      { prNumber: 90, isAudit: false },
    ];
    expect(findLastAuditPr(commits)).toBeNull();
  });
});

describe('scanAuditFolders', () => {
  function makeWorkspace(folders) {
    const dir = mkdtempSync(join(tmpdir(), 'audit-test-'));
    for (const f of folders) {
      mkdirSync(join(dir, f), { recursive: true });
    }
    return dir;
  }

  it('audit-pr-N0 매칭', () => {
    const dir = makeWorkspace(['audit-pr-50', 'audit-pr-60', '2026-04-30_other']);
    try {
      const set = scanAuditFolders(dir);
      expect(set.has(50)).toBe(true);
      expect(set.has(60)).toBe(true);
      expect(set.size).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('빈 디렉토리 빈 set', () => {
    const dir = makeWorkspace([]);
    try {
      expect(scanAuditFolders(dir).size).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('미존재 디렉토리 빈 set', () => {
    expect(scanAuditFolders('/nonexistent/path/xyz').size).toBe(0);
  });
});

describe('isAuditExempt', () => {
  it('PR<30 면제', () => {
    expect(isAuditExempt(0)).toBe(true);
    expect(isAuditExempt(29)).toBe(true);
  });

  it('PR>=30 비면제', () => {
    expect(isAuditExempt(30)).toBe(false);
    expect(isAuditExempt(100)).toBe(false);
    expect(isAuditExempt(500)).toBe(false);
  });
});

describe('computeAuditStatus', () => {
  it('PR<30 면제 → exempt=true', () => {
    const status = computeAuditStatus({ currentPr: 25, lastAuditPr: null });
    expect(status.exempt).toBe(true);
    expect(status.auditNeeded).toBe(false);
    expect(status.reason).toContain('INITIAL_PR_THRESHOLD');
  });

  it('PR=0 면제', () => {
    const status = computeAuditStatus({ currentPr: 0, lastAuditPr: null });
    expect(status.exempt).toBe(true);
    expect(status.reason).toBe('INSUFFICIENT_PR_HISTORY');
  });

  it('boundary 미도달 (currentN0 = lastAuditN0)', () => {
    // 현재 PR=55 → currentN0=5. 마지막 audit PR=50 → lastAuditN0=5. 같음.
    const status = computeAuditStatus({
      currentPr: 55,
      lastAuditPr: { prNumber: 50, isAudit: true, message: 'audit' },
    });
    expect(status.boundaryReached).toBe(false);
    expect(status.auditNeeded).toBe(false);
    expect(status.currentN0).toBe(5);
    expect(status.lastAuditN0).toBe(5);
    expect(status.prsSinceLastAudit).toBe(5);
  });

  it('boundary 도달 (currentN0 > lastAuditN0)', () => {
    // 현재 PR=65 → currentN0=6. 마지막 audit PR=51 → lastAuditN0=5. 크다.
    const status = computeAuditStatus({
      currentPr: 65,
      lastAuditPr: { prNumber: 51, isAudit: true, message: 'audit' },
    });
    expect(status.boundaryReached).toBe(true);
    expect(status.auditNeeded).toBe(true);
    expect(status.currentN0).toBe(6);
    expect(status.lastAuditN0).toBe(5);
    expect(status.reason).toContain('BOUNDARY_CROSSED');
  });

  it('audit 이력 없음 → 항상 boundary 도달', () => {
    const status = computeAuditStatus({ currentPr: 100, lastAuditPr: null });
    expect(status.boundaryReached).toBe(true);
    expect(status.lastAuditN0).toBeNull();
    expect(status.reason).toBe('NO_PRIOR_AUDIT');
  });

  it('_workspace/audit-pr-N0 폴더 fallback', () => {
    const status = computeAuditStatus({
      currentPr: 100,
      lastAuditPr: null,
      auditFolders: new Set([5, 7]),
    });
    expect(status.lastAuditN0).toBe(7);
    expect(status.boundaryReached).toBe(true); // currentN0=10 > 7
    expect(status.prsSinceLastAudit).toBe(100 - 70);
  });

  it('commit log audit 우선 (audit folder fallback 무시)', () => {
    const status = computeAuditStatus({
      currentPr: 100,
      lastAuditPr: { prNumber: 95, isAudit: true, message: 'audit' },
      auditFolders: new Set([2, 3]),
    });
    expect(status.lastAuditN0).toBe(9); // 95/10 = 9 (commit log)
    expect(status.boundaryReached).toBe(true); // currentN0=10 > 9
    expect(status.prsSinceLastAudit).toBe(5);
  });

  it('500+ PR 시나리오 (현재 코드베이스)', () => {
    const status = computeAuditStatus({
      currentPr: 504,
      lastAuditPr: null,
      auditFolders: new Set(),
    });
    expect(status.exempt).toBe(false);
    expect(status.boundaryReached).toBe(true);
    expect(status.currentN0).toBe(50);
    expect(status.auditNeeded).toBe(true);
  });
});

describe('CLI 통합', () => {
  it('--json 출력 구조', () => {
    const result = runLint('--json');
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.output);
    if (parsed.skipped) {
      expect(parsed.reason).toBeDefined();
    } else {
      expect(parsed.status).toBeDefined();
      expect(parsed.currentPr).toBeGreaterThanOrEqual(0);
      expect(parsed.commitsScanned).toBeGreaterThanOrEqual(0);
    }
  });

  it('정상 실행 EXIT=0 (WARN 모드, ERROR 기능 후속 PR)', () => {
    const result = runLint();
    expect(result.exitCode).toBe(0);
    expect(result.output).toMatch(/\[PR Pace Audit\]/);
  });
});
