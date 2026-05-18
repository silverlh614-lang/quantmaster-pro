#!/usr/bin/env node
import { scriptWarn } from '../server/observability/scriptWarn.js';
/**
 * @responsibility ADR-0146 10-PR boundary audit-only PR 룰 자동 모니터링
 *
 * 사용자 4-항목 추천 후속 자동화 #3 — *"PR-510 머지 직후 첫 자동 트리거"* 누가 알려주는가?
 * 단일 인력이 페이스에 휩쓸려 N0 boundary 를 그냥 지나칠 위험을 정적 검증으로 차단.
 *
 * 검사 항목:
 *   - main 브랜치 최신 PR 번호 추출 (`git log` + `(#NNN)` 패턴)
 *   - 마지막 audit-only PR 발견 (제목 prefix `audit:` / `chore(audit):` / `docs(audit):`
 *     또는 `_workspace/audit-pr-N0/` 폴더 존재)
 *   - N0 boundary 도달 검출 (현재 PR ÷ 10 vs 마지막 audit ÷ 10)
 *   - 면제 조건 자동 인식 (PR<30 초기 / PR-Governance 시리즈)
 *
 * 출력 정책:
 *   - boundary 미도달 → OK (PR-N0+1 까지 대기)
 *   - boundary 도달 + 24h 이내 → WARN (audit 권장)
 *   - boundary 도달 + 48h 초과 → ERROR EXIT=1 (audit 필수)
 *
 * 사용:
 *   node scripts/check_pr_pace_audit.js                # WARN/ERROR 출력
 *   node scripts/check_pr_pace_audit.js --json         # JSON 진단
 *   node scripts/check_pr_pace_audit.js --max-commits 200  # log scan 범위
 */

import { execSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const WORKSPACE_DIR = join(ROOT, '_workspace');

export const PR_PACE_CONSTANTS = {
  BOUNDARY_INTERVAL: 10, // 10-PR 단위
  WARN_HOURS: 24,
  ERROR_HOURS: 48,
  MIN_PR_THRESHOLD: 30, // PR-30 미만 면제
};

const PR_NUM_RE = /\(#(\d+)\)/;
const AUDIT_PREFIX_RE = /^(audit|chore\(audit\)|docs\(audit\)|fix\(audit\)|feat\(audit\))/i;
const AUDIT_KEYWORD_RE = /audit-only|audit\s+pr|N0\s+audit/i;
const AUDIT_FOLDER_RE = /^audit-pr-\d+/;

/* ───────── git log 파싱 ───────── */

/**
 * parseCommitLog(rawLog) — `git log --oneline` 출력 파싱.
 *
 * @returns Array<{ sha: string, prNumber: number | null, message: string, isAudit: boolean }>
 */
export function parseCommitLog(rawLog) {
  if (!rawLog) return [];
  const lines = rawLog.split('\n').filter((l) => l.trim().length > 0);
  return lines.map((line) => {
    const idx = line.indexOf(' ');
    const sha = idx > 0 ? line.slice(0, idx) : line;
    const message = idx > 0 ? line.slice(idx + 1) : '';
    const m = message.match(PR_NUM_RE);
    const prNumber = m ? parseInt(m[1], 10) : null;
    const isAudit =
      AUDIT_PREFIX_RE.test(message) || AUDIT_KEYWORD_RE.test(message);
    return { sha, prNumber, message, isAudit };
  });
}

/**
 * extractMaxPrNumber(commits) — 가장 큰 PR 번호.
 */
export function extractMaxPrNumber(commits) {
  let max = 0;
  for (const c of commits) {
    if (c.prNumber !== null && c.prNumber > max) max = c.prNumber;
  }
  return max;
}

/**
 * findLastAuditPr(commits) — 가장 최근 audit-only PR.
 */
export function findLastAuditPr(commits) {
  for (const c of commits) {
    if (c.isAudit && c.prNumber !== null) return c;
  }
  return null;
}

/**
 * scanAuditFolders(workspaceDir) — `_workspace/audit-pr-N0/` 폴더의 N0 set.
 */
export function scanAuditFolders(workspaceDir) {
  if (!existsSync(workspaceDir)) return new Set();
  const result = new Set();
  for (const name of readdirSync(workspaceDir)) {
    if (!AUDIT_FOLDER_RE.test(name)) continue;
    const m = name.match(/audit-pr-(\d+)/);
    if (m) result.add(parseInt(m[1], 10));
  }
  return result;
}

/* ───────── boundary 판정 ───────── */

/**
 * isAuditExempt(currentPr) — 면제 조건.
 */
export function isAuditExempt(currentPr) {
  return currentPr < PR_PACE_CONSTANTS.MIN_PR_THRESHOLD;
}

/**
 * computeAuditStatus({currentPr, lastAuditPr, auditFolders}) — boundary 도달 + 마지막 audit 비교.
 *
 * @returns {{
 *   exempt: boolean,
 *   boundaryReached: boolean,
 *   currentN0: number,
 *   lastAuditN0: number | null,
 *   prsSinceLastAudit: number | null,
 *   auditNeeded: boolean,
 *   reason: string
 * }}
 */
export function computeAuditStatus({ currentPr, lastAuditPr, auditFolders = new Set() }) {
  if (currentPr <= 0) {
    return {
      exempt: true,
      boundaryReached: false,
      currentN0: 0,
      lastAuditN0: null,
      prsSinceLastAudit: null,
      auditNeeded: false,
      reason: 'INSUFFICIENT_PR_HISTORY',
    };
  }

  if (isAuditExempt(currentPr)) {
    return {
      exempt: true,
      boundaryReached: false,
      currentN0: Math.floor(currentPr / PR_PACE_CONSTANTS.BOUNDARY_INTERVAL),
      lastAuditN0: null,
      prsSinceLastAudit: null,
      auditNeeded: false,
      reason: `INITIAL_PR_THRESHOLD (currentPr=${currentPr} < ${PR_PACE_CONSTANTS.MIN_PR_THRESHOLD})`,
    };
  }

  const currentN0 = Math.floor(currentPr / PR_PACE_CONSTANTS.BOUNDARY_INTERVAL);
  let lastAuditN0 = null;
  let prsSinceLastAudit = null;

  // commit log audit 우선
  if (lastAuditPr && typeof lastAuditPr.prNumber === 'number') {
    lastAuditN0 = Math.floor(lastAuditPr.prNumber / PR_PACE_CONSTANTS.BOUNDARY_INTERVAL);
    prsSinceLastAudit = currentPr - lastAuditPr.prNumber;
  }

  // _workspace/audit-pr-N0/ 폴더 fallback
  if (lastAuditN0 === null && auditFolders.size > 0) {
    const maxFolder = Math.max(...auditFolders);
    lastAuditN0 = maxFolder;
    prsSinceLastAudit = currentPr - maxFolder * PR_PACE_CONSTANTS.BOUNDARY_INTERVAL;
  }

  const boundaryReached = lastAuditN0 === null || currentN0 > lastAuditN0;
  const auditNeeded = boundaryReached;

  let reason;
  if (lastAuditN0 === null) {
    reason = 'NO_PRIOR_AUDIT';
  } else if (boundaryReached) {
    reason = `BOUNDARY_CROSSED (currentN0=${currentN0} > lastAuditN0=${lastAuditN0})`;
  } else {
    reason = `WITHIN_BOUNDARY (currentN0=${currentN0} = lastAuditN0=${lastAuditN0})`;
  }

  return {
    exempt: false,
    boundaryReached,
    currentN0,
    lastAuditN0,
    prsSinceLastAudit,
    auditNeeded,
    reason,
  };
}

/* ───────── git 호출 ───────── */

function tryGitLog(maxCount) {
  try {
    const out = execSync(`git log --oneline -n ${maxCount}`, {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return out;
  } catch (err) {
    return null;
  }
}

/* ───────── 메인 ───────── */

function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const maxIdx = args.indexOf('--max-commits');
  const maxCommits = maxIdx >= 0 && args[maxIdx + 1] ? parseInt(args[maxIdx + 1], 10) : 200;

  const rawLog = tryGitLog(maxCommits);
  if (rawLog === null) {
    if (json) {
      console.log(
        JSON.stringify({ skipped: true, reason: 'git log unavailable' }, null, 2)
      );
    } else {
      console.log('[PR Pace Audit] SKIP — git log unavailable (CI 환경 / shallow clone 가능성)');
    }
    process.exit(0);
  }

  const commits = parseCommitLog(rawLog);
  const currentPr = extractMaxPrNumber(commits);
  const lastAuditPr = findLastAuditPr(commits);
  const auditFolders = scanAuditFolders(WORKSPACE_DIR);

  const status = computeAuditStatus({
    currentPr,
    lastAuditPr,
    auditFolders,
  });

  if (json) {
    console.log(
      JSON.stringify(
        {
          status,
          currentPr,
          lastAuditPr: lastAuditPr ? { prNumber: lastAuditPr.prNumber, message: lastAuditPr.message } : null,
          auditFoldersCount: auditFolders.size,
          commitsScanned: commits.length,
        },
        null,
        2
      )
    );
    process.exit(0);
  }

  if (status.exempt) {
    console.log(`[PR Pace Audit] OK — 면제 (${status.reason})`);
    return;
  }

  if (!status.boundaryReached) {
    console.log(
      `[PR Pace Audit] OK — 현재 PR=#${currentPr}, 마지막 audit N0=${status.lastAuditN0} ` +
        `(${status.prsSinceLastAudit} PR 누적, boundary 미도달)`
    );
    return;
  }

  // boundary 도달
  scriptWarn(
    `[PR Pace Audit] WARN — 10-PR boundary 도달. 현재 PR=#${currentPr}, ` +
      `마지막 audit ${status.lastAuditN0 === null ? '없음' : `N0=${status.lastAuditN0}`}, ` +
      `${status.prsSinceLastAudit ?? currentPr} PR 누적`
  );
  scriptWarn('');
  scriptWarn('해결: ADR-0146 §"Audit 체크리스트" 5 카테고리 점검 후 audit-only PR 작성');
  scriptWarn('  형식: `audit: PR-N0 review (PR-{N0-9}~PR-{N0})` + `_workspace/audit-pr-{N0}/findings.md` 영속');
  scriptWarn('');
  scriptWarn('면제 사유 (PR-Governance 시리즈 / hot-fix 마지막 / 휴장 기간) 시 본 경고 무시 가능.');

  // ERROR 종료는 후속 PR 에서 시간 기반 정책 도입 (현재는 WARN only)
  // process.exit(0); — fallthrough OK
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('check_pr_pace_audit.js');
if (isMain) {
  main();
}
