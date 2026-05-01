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
 *   G) 백로그 등재 vs 실제 wiring 정합성 (PR-Governance-Followup-2):
 *      G1 — 모듈 경로 백틱 안 파일이 실제 존재 (placeholder 제외)
 *      G2 — DECIDED_NOT_WIRING 항목은 reason 에 PR 인용 (`PR-` / `완료` / audit 산출물 인용) 의무
 *      G3 — INFRASTRUCTURE_ONLY / PARTIAL / BLOCKED 항목은 reason 에 차단 사유 / 다음 액션 명시 의무
 *
 *      배경: A3 (emitFullCloseAttribution) 가 6개월간 INFRASTRUCTURE_ONLY stale 로 남았던
 *      이유 — 백로그 등재가 *실제 코드 상태와 정합* 하는지 검사 부재. G 카테고리는
 *      "코드는 wired 되었는데 백로그가 갱신 안 됨" / "신규 항목인데 모듈 경로 오타" 등
 *      drift 영구 차단.
 *
 * 본 PR (Governance 후속): baseline 0건 위반 — 신규 회귀만 차단.
 *
 * 사용:
 *   node scripts/check_pending_wiring.js                # WARN/ERROR 출력 EXIT=0/1
 *   node scripts/check_pending_wiring.js --json         # JSON 진단
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
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
// PR-Governance-Followup-2: 6 컬럼 모두 캡처 (id/adr/모듈/상태/우선순위/사유)
const ROW_RE =
  /^\|\s*([A-Z]\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([A-Z_]+)\s*\|\s*(P\d)\s*\|\s*(.+?)\s*\|\s*$/;
const CATEGORY_RE = /^###\s+([A-E])\.\s+/;
const ADR_REF_RE = /\b(\d{4})\b/g;
// PR-Governance-Followup-2: 모듈 경로 백틱 추출 (예: `server/persistence/x.ts`)
const MODULE_PATH_RE = /`([^`]+)`/g;
// PR-Governance-Followup-2: placeholder 패턴 — 모듈 경로 검증 skip 대상
const MODULE_PLACEHOLDER_RE = /\(\s*신규\s*\)|\(\s*정성[^)]*\)|\(\s*예정[^)]*\)/;
// PR-Governance-Followup-2: DECIDED_NOT_WIRING 의 reason 에 audit 추적성 인용 패턴
//   - PR 인용 / "완료" / audit 산출물 / `_workspace/` / ADR 인용 (정책 SSOT 명시)
const DECIDED_REASON_REF_RE =
  /(PR-[가-힣A-Za-z0-9_-]+|완료|audit|_workspace\/|ADR-\d{4})/i;
// PR-Governance-Followup-2: 와일드카드 / glob 경로 — 파일 단위 검증 skip
const WILDCARD_RE = /[*?]/;

/* ───────── PENDING_WIRING 파싱 ───────── */

/**
 * parsePendingWiring(src) — 백로그 본문 파싱.
 *
 * @returns {{
 *   entries: Array<{
 *     id: string,
 *     adrRefs: string[],
 *     module: string,           // PR-Governance-Followup-2: raw 모듈 컬럼 텍스트
 *     modulePaths: string[],    // PR-Governance-Followup-2: 백틱 안 파일 경로 추출
 *     status: string,
 *     priority: string,
 *     category: string,
 *     reason: string,           // PR-Governance-Followup-2: raw 사유 컬럼 텍스트
 *   }>,
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
      const moduleField = m[3].trim();
      const status = m[4];
      const priority = m[5];
      const reason = m[6].trim();

      const adrRefs = [];
      let r;
      ADR_REF_RE.lastIndex = 0;
      while ((r = ADR_REF_RE.exec(adrField)) !== null) {
        adrRefs.push(r[1]);
      }

      // PR-Governance-Followup-2: 모듈 컬럼에서 백틱 안 파일 경로 추출
      const modulePaths = [];
      let p;
      MODULE_PATH_RE.lastIndex = 0;
      while ((p = MODULE_PATH_RE.exec(moduleField)) !== null) {
        modulePaths.push(p[1]);
      }

      entries.push({
        id,
        adrRefs,
        module: moduleField,
        modulePaths,
        status,
        priority,
        category: id.charAt(0),
        reason,
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
 * fileExistsAtRoot(rootDir, relPath) — 모듈 경로 파일 존재 검증 헬퍼 (G1).
 *
 * 절대 경로면 그대로, 상대면 rootDir 기준 join. 와일드카드는 false 반환 후
 * 호출자가 skip. 디렉토리도 true (예: `server/clients/kisClient/`).
 */
export function fileExistsAtRoot(rootDir, relPath) {
  if (!relPath || typeof relPath !== 'string') return false;
  if (WILDCARD_RE.test(relPath)) return false; // glob 은 검증 skip
  const abs = relPath.startsWith('/') ? relPath : join(rootDir, relPath);
  try {
    statSync(abs); // 디렉토리 / 파일 모두 OK
    return true;
  } catch {
    return false;
  }
}

/**
 * isWildcardPath(p) — glob/wildcard 패턴 판정.
 */
export function isWildcardPath(p) {
  return typeof p === 'string' && WILDCARD_RE.test(p);
}

/**
 * isModulePlaceholder(moduleField) — `(신규)` `(정성 — 격상 불가)` 등 placeholder 판정.
 */
export function isModulePlaceholder(moduleField) {
  if (!moduleField) return false;
  return MODULE_PLACEHOLDER_RE.test(moduleField);
}

/**
 * validate(parsed, knownAdrNumbers, options) — 7 카테고리 적용.
 *
 * @param {object} parsed - parsePendingWiring 결과
 * @param {Set<string>} knownAdrNumbers - INDEX.md 등재 ADR 번호
 * @param {object} [options]
 * @param {string} [options.rootDir] - 모듈 경로 검증 기준 디렉토리 (G1). 미전달 시 G1 skip.
 */
export function validate(parsed, knownAdrNumbers = new Set(), options = {}) {
  const violations = [];
  const { entries, categories, stats } = parsed;
  const { rootDir } = options;

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

  // G) 백로그 등재 vs 실제 wiring 정합성 (PR-Governance-Followup-2)
  for (const e of entries) {
    // G1) 모듈 경로 파일 존재 검증
    //   - rootDir 미전달 시 skip (단위 테스트용)
    //   - placeholder (`(신규)` / `(정성)`) skip
    //   - 와일드카드 skip
    //   - 백틱 안 경로 0건 + placeholder 도 아니면 형식 오류
    if (rootDir) {
      const isPlaceholder = isModulePlaceholder(e.module);
      if (e.modulePaths.length === 0 && !isPlaceholder) {
        violations.push({
          category: 'G_MODULE_FORMAT',
          message: `${e.id}: 모듈 컬럼에 백틱 안 파일 경로 부재 — \`server/path.ts\` 또는 \`(신규)\` placeholder 필요. 현재: "${e.module.slice(0, 80)}"`,
        });
      } else if (!isPlaceholder) {
        for (const mp of e.modulePaths) {
          if (isWildcardPath(mp)) continue; // glob 은 skip
          if (!fileExistsAtRoot(rootDir, mp)) {
            violations.push({
              category: 'G_MODULE_FILE_MISSING',
              message: `${e.id}: 모듈 경로 \`${mp}\` 파일 부재 — 코드 이동·삭제·오타 의심. 백로그 SSOT drift 차단을 위해 경로 정정 또는 항목 제거 필요.`,
            });
          }
        }
      }
    }

    // G2) DECIDED_NOT_WIRING 항목은 reason 에 audit 추적성 인용 의무
    //   - PR 인용 / "완료" 키워드 / audit 산출물 인용 (`_workspace/`)
    //   - audit 추적성 부재 시 결정 근거 불명 (A3 stale 같은 결함 차단)
    if (e.status === 'DECIDED_NOT_WIRING') {
      if (!DECIDED_REASON_REF_RE.test(e.reason)) {
        violations.push({
          category: 'G_DECIDED_NO_AUDIT_REF',
          message: `${e.id}: DECIDED_NOT_WIRING 항목 reason 에 audit 추적성 인용 부재 — \`PR-...\` / \`완료\` / \`_workspace/...\` 중 하나 필수. 결정 근거 명시 의무.`,
        });
      }
    }

    // G3) INFRASTRUCTURE_ONLY / PARTIAL / BLOCKED 항목 reason 비어있음
    //   - 차단 사유 / 다음 액션 명시 의무
    //   - 6개월 stale 결함 (예: A3) 차단
    if (
      e.status === 'INFRASTRUCTURE_ONLY' ||
      e.status === 'PARTIAL' ||
      e.status === 'BLOCKED'
    ) {
      const trimmed = e.reason.replace(/[\s\-—|]+/g, '');
      if (trimmed.length < 5) {
        violations.push({
          category: 'G_EMPTY_REASON',
          message: `${e.id} (${e.status}): reason 컬럼이 비어있거나 너무 짧음 — 차단 사유 / 다음 액션 명시 의무.`,
        });
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
  const { violations, summary } = validate(parsed, knownAdrNumbers, { rootDir: ROOT });

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
