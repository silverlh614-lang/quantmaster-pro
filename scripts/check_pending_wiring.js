#!/usr/bin/env node
/**
 * @responsibility PENDING_WIRING.md ↔ INDEX.md / 백로그 SSOT 정합 정적 검증
 *
 * 사용자 4-항목 추천 후속 자동화 #2 — *"PR-L/N/O 같은 게 영원히 dead code 로 남는 결함"*
 * 영구 차단. PENDING_WIRING.md 가 단일 wiring 추적 SSOT 임을 정적 강제.
 *
 * 검사 항목:
 *   A) 상태 4단계 SSOT — INFRASTRUCTURE_ONLY / PARTIAL / BLOCKED / DECIDED_NOT_WIRING 외 차단
 *   B) 우선순위 3등급 SSOT — P0/P1/P2/P3 외 차단
 *   C) ADR 참조 정합 — 본 백로그가 참조하는 ADR 번호가 INDEX.md 에 등재되어 있는지
 *   D) 카테고리 파싱 정합 — 5 카테고리 (A. 학습 / B. 매매 / C. 시그널 / D. UI / E. 영속) 모두 존재
 *   E) 진행 통계 자동 갱신 — §"진행 통계" 표가 실제 카테고리 카운트와 일치
 *   F) ID 형식 — `[A-E][0-9]+` 엄격
 *
 * 본 PR (Governance 후속): baseline 0건 위반 — 신규 회귀만 차단.
 *
 * 사용:
 *   node scripts/check_pending_wiring.js                # WARN/ERROR 출력 EXIT=0/1
 *   node scripts/check_pending_wiring.js --json         # JSON 진단
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PENDING_PATH = join(ROOT, '_workspace', 'PENDING_WIRING.md');
const INDEX_PATH = join(ROOT, 'docs', 'adr', 'INDEX.md');

export const VALID_STATES = new Set([
  'INFRASTRUCTURE_ONLY',
  'PARTIAL',
  'BLOCKED',
  'DECIDED_NOT_WIRING',
]);

export const VALID_PRIORITIES = new Set(['P0', 'P1', 'P2', 'P3']);

export const EXPECTED_CATEGORIES = ['A', 'B', 'C', 'D', 'E'];

const ID_RE = /^[A-E]\d+$/;
const ROW_RE =
  /^\|\s*([A-Z]\d+)\s*\|\s*([^|]+?)\s*\|\s*[^|]+?\s*\|\s*([A-Z_]+)\s*\|\s*(P\d)\s*\|\s*[^|]+?\s*\|/;
const CATEGORY_RE = /^###\s+([A-E])\.\s+/;
const ADR_REF_RE = /\b(\d{4})\b/g;

/* ───────── PENDING_WIRING 파싱 ───────── */

/**
 * parsePendingWiring(src) — 백로그 본문 파싱.
 *
 * @returns {{
 *   entries: Array<{ id: string, adrRefs: string[], status: string, priority: string, category: string }>,
 *   categories: Set<string>,
 *   stats: Map<string, { total: number, p0: number, p1: number, p2: number, p3: number }> | null
 * }}
 */
export function parsePendingWiring(src) {
  const lines = src.split('\n');
  const entries = [];
  const categories = new Set();
  let currentCategory = null;
  let inStatsTable = false;

  // 통계 표 파싱
  const stats = new Map();

  for (const line of lines) {
    // 카테고리 헤더 추출
    const cat = line.match(CATEGORY_RE);
    if (cat) {
      currentCategory = cat[1];
      categories.add(currentCategory);
      continue;
    }

    // 통계 표 진입
    if (/^##\s+진행 통계/.test(line)) {
      inStatsTable = true;
      continue;
    }
    if (inStatsTable && /^##\s+/.test(line)) {
      inStatsTable = false;
    }

    // 통계 표 행 파싱: `| A. 학습 시리즈 | 7 | 1 | 3 | 3 | 0 |`
    if (inStatsTable) {
      const sm = line.match(
        /^\|\s+([A-E])\.\s+[^|]+?\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|/
      );
      if (sm) {
        stats.set(sm[1], {
          total: parseInt(sm[2], 10),
          p0: parseInt(sm[3], 10),
          p1: parseInt(sm[4], 10),
          p2: parseInt(sm[5], 10),
          p3: parseInt(sm[6], 10),
        });
      }
      continue;
    }

    // 백로그 행 파싱
    const m = line.match(ROW_RE);
    if (m) {
      const id = m[1];
      const adrField = m[2].trim();
      const adrRefs = [];
      let r;
      while ((r = ADR_REF_RE.exec(adrField)) !== null) {
        adrRefs.push(r[1]);
      }
      entries.push({
        id,
        adrRefs,
        status: m[3],
        priority: m[4],
        category: id.charAt(0),
      });
    }
  }

  return { entries, categories, stats: stats.size > 0 ? stats : null };
}

/* ───────── INDEX.md ADR 번호 추출 (간소) ───────── */

/**
 * extractAllAdrNumbers(indexSrc) — INDEX.md §"전체 인덱스" + §"알려진 충돌" 의 모든 번호 set.
 */
export function extractAllAdrNumbers(indexSrc) {
  const numbers = new Set();
  const lines = indexSrc.split('\n');
  let inIndexedSection = false;

  for (const line of lines) {
    if (/^##\s+(전체 인덱스|알려진 충돌)/.test(line)) {
      inIndexedSection = true;
      continue;
    }
    if (inIndexedSection) {
      if (/^##\s+/.test(line)) {
        inIndexedSection = false;
        continue;
      }
      const m = line.match(/^\|\s*\*?\*?(\d{4})\*?\*?\s*\|/);
      if (m) numbers.add(m[1]);
    }
  }
  return numbers;
}

/* ───────── 검증 ───────── */

/**
 * validate(parsed, knownAdrNumbers) — 6 카테고리 적용.
 */
export function validate(parsed, knownAdrNumbers = new Set()) {
  const violations = [];
  const { entries, categories, stats } = parsed;

  // F) ID 형식
  for (const e of entries) {
    if (!ID_RE.test(e.id)) {
      violations.push({
        category: 'F_INVALID_ID',
        message: `백로그 ID 형식 위반: ${e.id} (기대: A1, B2, ... E6 패턴)`,
      });
    }
    // ID 카테고리 prefix 와 위치 카테고리 일치
    if (e.id.charAt(0) !== e.category) {
      violations.push({
        category: 'F_CATEGORY_MISMATCH',
        message: `백로그 ID ${e.id} 의 prefix 가 위치한 섹션 ${e.category} 와 불일치`,
      });
    }
  }

  // A) 상태 SSOT
  for (const e of entries) {
    if (!VALID_STATES.has(e.status)) {
      violations.push({
        category: 'A_INVALID_STATE',
        message: `${e.id}: 상태 "${e.status}" 무효 (허용: ${[...VALID_STATES].join('/')})`,
      });
    }
  }

  // B) 우선순위 SSOT
  for (const e of entries) {
    if (!VALID_PRIORITIES.has(e.priority)) {
      violations.push({
        category: 'B_INVALID_PRIORITY',
        message: `${e.id}: 우선순위 "${e.priority}" 무효 (허용: ${[...VALID_PRIORITIES].join('/')})`,
      });
    }
  }

  // C) ADR 참조 정합
  if (knownAdrNumbers.size > 0) {
    for (const e of entries) {
      for (const ref of e.adrRefs) {
        if (!knownAdrNumbers.has(ref)) {
          violations.push({
            category: 'C_UNKNOWN_ADR_REF',
            message: `${e.id}: 참조 ADR ${ref} — INDEX.md 미등재`,
          });
        }
      }
    }
  }

  // D) 카테고리 누락
  for (const c of EXPECTED_CATEGORIES) {
    if (!categories.has(c)) {
      violations.push({
        category: 'D_MISSING_CATEGORY',
        message: `카테고리 ${c}. 헤더 부재 — 5 카테고리 (A~E) 모두 정의 필요`,
      });
    }
  }

  // E) 진행 통계 자동 갱신
  if (stats) {
    // 실제 카운트 산출
    const actual = new Map();
    for (const c of EXPECTED_CATEGORIES) {
      actual.set(c, { total: 0, p0: 0, p1: 0, p2: 0, p3: 0 });
    }
    for (const e of entries) {
      const a = actual.get(e.category);
      if (a) {
        a.total++;
        const p = e.priority.toLowerCase();
        if (p === 'p0') a.p0++;
        else if (p === 'p1') a.p1++;
        else if (p === 'p2') a.p2++;
        else if (p === 'p3') a.p3++;
      }
    }

    for (const [c, expected] of stats) {
      const a = actual.get(c);
      if (!a) continue;
      if (a.total !== expected.total) {
        violations.push({
          category: 'E_STATS_MISMATCH',
          message: `진행 통계 ${c}.total=${expected.total} 표기 ≠ 실제 ${a.total}`,
        });
      }
      for (const k of ['p0', 'p1', 'p2', 'p3']) {
        if (a[k] !== expected[k]) {
          violations.push({
            category: 'E_STATS_MISMATCH',
            message: `진행 통계 ${c}.${k.toUpperCase()}=${expected[k]} 표기 ≠ 실제 ${a[k]}`,
          });
        }
      }
    }
  }

  return {
    violations,
    summary: {
      entryCount: entries.length,
      categoryCount: categories.size,
      knownAdrCount: knownAdrNumbers.size,
      hasStats: stats !== null,
    },
  };
}

/* ───────── 메인 ───────── */

function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');

  if (!existsSync(PENDING_PATH)) {
    console.error(`[PendingWiring] FAIL — 파일 부재: ${PENDING_PATH}`);
    process.exit(1);
  }

  const pendingSrc = readFileSync(PENDING_PATH, 'utf-8');
  const indexSrc = existsSync(INDEX_PATH) ? readFileSync(INDEX_PATH, 'utf-8') : '';
  const knownAdrNumbers = extractAllAdrNumbers(indexSrc);
  const parsed = parsePendingWiring(pendingSrc);
  const { violations, summary } = validate(parsed, knownAdrNumbers);

  if (json) {
    console.log(JSON.stringify({ summary, violations }, null, 2));
    process.exit(violations.length === 0 ? 0 : 1);
  }

  if (violations.length === 0) {
    console.log(
      `[PendingWiring] OK — ${summary.entryCount}개 항목 / ` +
        `${summary.categoryCount}개 카테고리 / ` +
        `통계 표 ${summary.hasStats ? '정합' : '부재'} / ` +
        `참조 ADR ${summary.knownAdrCount}건 검증`
    );
    return;
  }

  console.error(`[PendingWiring] FAIL — ${violations.length}건 위반:`);
  const byCategory = new Map();
  for (const v of violations) {
    if (!byCategory.has(v.category)) byCategory.set(v.category, []);
    byCategory.get(v.category).push(v.message);
  }
  for (const [cat, msgs] of byCategory) {
    console.error(`  [${cat}] ${msgs.length}건:`);
    for (const m of msgs.slice(0, 10)) console.error(`    - ${m}`);
    if (msgs.length > 10) console.error(`    ... ${msgs.length - 10}건 더`);
  }
  console.error('');
  console.error(
    '해결: _workspace/PENDING_WIRING.md 갱신 — 신규 PR 머지 시 wiring 미완 항목 등재 + 완료 시 제거 의무.'
  );
  process.exit(1);
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('check_pending_wiring.js');
if (isMain) {
  main();
}
