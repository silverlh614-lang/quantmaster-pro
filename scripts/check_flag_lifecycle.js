#!/usr/bin/env node
/**
 * @responsibility Gate flag 수명주기 정적 검사 — default-OFF 플래그가 reviewBy 만료 후 방치되는 안티패턴 차단.
 *
 * 배경: Gate1 default-OFF (SHADOW_OFF) 플래그가 영원히 안 켜지고 쌓이는 거버넌스 부채를 막는다.
 *       scripts/gate_flag_lifecycle.json 레지스트리를 읽어, 만료 경과한 OFF 플래그를 하드 실패시킨다.
 *       운영자는 (1) 플래그를 flip(ON) 하거나 (2) sunset(SUNSET) 하거나 (3) reviewBy 를 사유와 함께
 *       갱신해야 빌드를 통과한다.
 *
 * 검사 항목:
 *   A) 스키마 — 필수 필드(envFlag/adr/title/introduced/reviewBy/status/activationCriteria/nextAction) 존재
 *   B) status enum — SHADOW_OFF / ON / SUNSET 외 차단
 *   C) 날짜 형식 — introduced / reviewBy 가 `YYYY-MM-DD`
 *   D) 중복 envFlag 검출
 *   E) 만료 — status === 'SHADOW_OFF' 이고 오늘(UTC) > reviewBy 면 past-due FAIL
 *
 * 레지스트리 부재 시: graceful skip (EXIT=0) — architect 산출물 병렬 작성 상황 대비.
 * 외부 호출/네트워크/provider 접근 0. 순수 파일 읽기.
 *
 * 사용:
 *   node scripts/check_flag_lifecycle.js                       # 기본 레지스트리
 *   node scripts/check_flag_lifecycle.js path/to/fixture.json  # 픽스처 주입 (테스트)
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_REGISTRY_PATH = join(__dirname, 'gate_flag_lifecycle.json');

export const VALID_STATUSES = new Set(['SHADOW_OFF', 'ON', 'SUNSET']);

export const REQUIRED_FIELDS = [
  'envFlag',
  'adr',
  'title',
  'introduced',
  'reviewBy',
  'status',
  'activationCriteria',
  'nextAction',
];

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** todayIsoUtc() — 오늘 날짜 UTC `YYYY-MM-DD`. */
export function todayIsoUtc() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * validateRegistry(registry, todayIso) — 레지스트리 객체를 검증.
 * @returns {{ violations: Array<{category:string,message:string}>, summary: object }}
 */
export function validateRegistry(registry, todayIso = todayIsoUtc()) {
  const violations = [];

  if (!registry || typeof registry !== 'object') {
    violations.push({
      category: 'SCHEMA',
      message: '레지스트리 루트가 객체가 아님',
    });
    return { violations, summary: { flagCount: 0, byStatus: {}, pastDue: [] } };
  }

  const flags = Array.isArray(registry.flags) ? registry.flags : null;
  if (flags === null) {
    violations.push({
      category: 'SCHEMA',
      message: '`flags` 배열 부재 — 레지스트리에 flags: [] 필요',
    });
    return { violations, summary: { flagCount: 0, byStatus: {}, pastDue: [] } };
  }

  const byStatus = {};
  const seenEnvFlags = new Map();
  const pastDue = [];

  flags.forEach((flag, idx) => {
    const label =
      flag && typeof flag === 'object' && typeof flag.envFlag === 'string'
        ? flag.envFlag
        : `#${idx}`;

    if (!flag || typeof flag !== 'object') {
      violations.push({
        category: 'SCHEMA',
        message: `flags[${idx}]: 객체가 아님`,
      });
      return;
    }

    // A) 필수 필드
    for (const field of REQUIRED_FIELDS) {
      const v = flag[field];
      if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
        violations.push({
          category: 'SCHEMA',
          message: `${label}: 필수 필드 "${field}" 누락/빈 값`,
        });
      }
    }

    // B) status enum
    if (typeof flag.status === 'string' && !VALID_STATUSES.has(flag.status)) {
      violations.push({
        category: 'STATUS_ENUM',
        message: `${label}: status "${flag.status}" 무효 (허용: ${[...VALID_STATUSES].join('/')})`,
      });
    }
    if (typeof flag.status === 'string' && VALID_STATUSES.has(flag.status)) {
      byStatus[flag.status] = (byStatus[flag.status] || 0) + 1;
    }

    // C) 날짜 형식
    for (const dateField of ['introduced', 'reviewBy']) {
      const dv = flag[dateField];
      if (typeof dv === 'string' && dv.trim() !== '' && !ISO_DATE_RE.test(dv)) {
        violations.push({
          category: 'DATE_FORMAT',
          message: `${label}: ${dateField} "${dv}" 형식 오류 — YYYY-MM-DD 필요`,
        });
      }
    }

    // D) 중복 envFlag
    if (typeof flag.envFlag === 'string' && flag.envFlag.trim() !== '') {
      if (seenEnvFlags.has(flag.envFlag)) {
        violations.push({
          category: 'DUPLICATE',
          message: `${label}: envFlag 중복 (이전 위치 flags[${seenEnvFlags.get(flag.envFlag)}])`,
        });
      } else {
        seenEnvFlags.set(flag.envFlag, idx);
      }
    }

    // E) 만료 — SHADOW_OFF + 오늘 > reviewBy → past-due
    if (
      flag.status === 'SHADOW_OFF' &&
      typeof flag.reviewBy === 'string' &&
      ISO_DATE_RE.test(flag.reviewBy) &&
      todayIso > flag.reviewBy
    ) {
      const detail = {
        envFlag: flag.envFlag,
        adr: flag.adr,
        reviewBy: flag.reviewBy,
        activationCriteria: flag.activationCriteria,
        nextAction: flag.nextAction,
      };
      pastDue.push(detail);
      violations.push({
        category: 'PAST_DUE',
        message:
          `${label} (ADR-${flag.adr}): SHADOW_OFF 만료 — reviewBy ${flag.reviewBy} 경과 (오늘 ${todayIso}). ` +
          `활성화 기준: ${flag.activationCriteria || '(미기재)'}. 다음 액션: ${flag.nextAction || '(미기재)'}. ` +
          `해결: 플래그를 flip(status: ON) 하거나 sunset(status: SUNSET) 하거나 reviewBy 를 사유와 함께 갱신하라.`,
      });
    }
  });

  return {
    violations,
    summary: {
      flagCount: flags.length,
      byStatus,
      pastDue,
      reviewWindowDays:
        typeof registry.reviewWindowDays === 'number' ? registry.reviewWindowDays : null,
    },
  };
}

/* ───────── 메인 ───────── */

function main() {
  const argPath = process.argv[2];
  const registryPath = argPath ? resolve(argPath) : DEFAULT_REGISTRY_PATH;

  if (!existsSync(registryPath)) {
    console.warn(
      `[FlagLifecycle] WARN — 레지스트리 미발견, skip: ${registryPath} ` +
        `(architect 산출물 병렬 작성 상황일 수 있음)`
    );
    process.exit(0);
  }

  let registry;
  try {
    registry = JSON.parse(readFileSync(registryPath, 'utf-8'));
  } catch (err) {
    console.error(
      `[FlagLifecycle] FAIL — 레지스트리 JSON 파싱 오류: ${registryPath}\n  ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    process.exit(1);
  }

  const todayIso = todayIsoUtc();
  const { violations, summary } = validateRegistry(registry, todayIso);

  // status별 카운트 문자열
  const statusStr =
    Object.keys(summary.byStatus).length > 0
      ? Object.entries(summary.byStatus)
          .map(([k, v]) => `${k}=${v}`)
          .join(', ')
      : '(없음)';

  if (violations.length === 0) {
    console.log(
      `[FlagLifecycle] OK — ${summary.flagCount} flags registered, past-due 0 ` +
        `(status: ${statusStr})`
    );
    process.exit(0);
  }

  console.error(
    `[FlagLifecycle] FAIL — ${violations.length}건 위반 ` +
      `(등재 ${summary.flagCount}개, status: ${statusStr})`
  );

  const byCategory = new Map();
  for (const v of violations) {
    if (!byCategory.has(v.category)) byCategory.set(v.category, []);
    byCategory.get(v.category).push(v.message);
  }
  for (const [cat, msgs] of byCategory) {
    console.error(`  [${cat}] ${msgs.length}건:`);
    for (const m of msgs) console.error(`    - ${m}`);
  }

  if (summary.pastDue.length > 0) {
    console.error('');
    console.error(`  past-due 목록 (${summary.pastDue.length}건):`);
    console.error('    envFlag                          | adr  | reviewBy   | nextAction');
    console.error('    ---------------------------------|------|------------|-----------');
    for (const p of summary.pastDue) {
      const ef = String(p.envFlag || '').padEnd(32).slice(0, 32);
      const adr = String(p.adr || '').padEnd(4).slice(0, 4);
      const rb = String(p.reviewBy || '').padEnd(10).slice(0, 10);
      console.error(`    ${ef} | ${adr} | ${rb} | ${p.nextAction || ''}`);
    }
  }

  console.error('');
  console.error(
    '해결: SHADOW_OFF 플래그를 flip(status: ON) / sunset(status: SUNSET) / reviewBy 갱신(사유 기록) 중 하나로 처리하라.'
  );
  process.exit(1);
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('check_flag_lifecycle.js');
if (isMain) {
  main();
}
