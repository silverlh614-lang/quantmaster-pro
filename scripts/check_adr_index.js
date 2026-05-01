#!/usr/bin/env node
/**
 * @responsibility ADR 파일시스템 ↔ INDEX.md 정합 정적 검증 (PR-Governance 후속)
 *
 * 사용자 4-항목 추천 후속 자동화 #1 — *"4/26 단 하루에 ADR 0028~0032 충돌 5건"*
 * 패턴 재발 차단. INDEX.md 가 단일 발급 SSOT 임을 정적 강제.
 *
 * 검사 항목:
 *   A) 파일 존재 vs 인덱스 등재 — ADR 파일은 있는데 INDEX.md 미등재
 *   B) 인덱스 등재 vs 파일 존재 — INDEX.md 엔 있는데 파일 부재
 *   C) "다음 발급" 정합 — 다음 발급 번호 = max(번호) + 1 (gap 건너뛰기)
 *   D) 누락 (Gap) 표 정합 — §"누락" 의 번호가 실제 파일 부재
 *   E) 충돌 표 정합 — §"알려진 충돌" 의 ADR 이 실제 파일 시스템에 존재
 *   F) 파일명 prefix 검증 — `^\d{4}-[a-z][a-z0-9-]*\.md$` 엄격 매치
 *
 * 사용:
 *   node scripts/check_adr_index.js                 # WARN/ERROR 출력 EXIT=0/1
 *   node scripts/check_adr_index.js --json          # JSON 진단
 *   node scripts/check_adr_index.js --strict        # 모든 위반 EXIT=1 (default 도 EXIT=1)
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ADR_DIR = join(ROOT, 'docs', 'adr');
const INDEX_PATH = join(ADR_DIR, 'INDEX.md');

// 기존 코드베이스가 camelCase ADR 이름 사용 (signalScanner / stockScreener / exitEngine 등) → 영대소문자 + 숫자 + 하이픈 허용.
// 차단 대상은 `28-*` (4자리 미만) / `0028a-*` (suffix) / 시작 비-영문 같은 변형.
const FILE_RE = /^(\d{4})-([a-zA-Z][a-zA-Z0-9-]*)\.md$/;
const STRICT_NAME_RE = /^\d{4}-[a-zA-Z][a-zA-Z0-9-]*\.md$/;

/* ───────── ADR 파일 시스템 스캔 ───────── */

export function scanAdrFiles(adrDir) {
  if (!existsSync(adrDir)) return { byNumber: new Map(), invalidNames: [] };

  const byNumber = new Map(); // number(string) → string[] (filenames)
  const invalidNames = [];

  for (const name of readdirSync(adrDir)) {
    if (!name.endsWith('.md')) continue;
    if (name === 'INDEX.md' || name === 'README.md') continue;

    if (!STRICT_NAME_RE.test(name)) {
      invalidNames.push(name);
      continue;
    }

    const m = name.match(FILE_RE);
    if (!m) {
      invalidNames.push(name);
      continue;
    }

    const num = m[1];
    if (!byNumber.has(num)) byNumber.set(num, []);
    byNumber.get(num).push(name);
  }

  return { byNumber, invalidNames };
}

/* ───────── INDEX.md 파싱 ───────── */

/**
 * parseIndex(src) — INDEX.md 4 섹션 파싱.
 *
 * @returns {{
 *   nextNumber: string | null,
 *   mainIndex: Map<string, { title: string, domain: string, isGap: boolean }>,
 *   conflicts: Array<{ number: string, file: string }>,
 *   gaps: string[]
 * }}
 */
export function parseIndex(src) {
  const lines = src.split('\n');

  let nextNumber = null;
  const mainIndex = new Map();
  const conflicts = [];
  const gaps = [];

  // §"다음 발급" — `**다음 ADR 번호: \`NNNN\`**`
  for (const line of lines) {
    const m = line.match(/\*\*다음 ADR 번호:\s*`(\d{4})`\*\*/);
    if (m) {
      nextNumber = m[1];
      break;
    }
  }

  // §"알려진 충돌" 테이블 행: `| NNNN | \`NNNN-name.md\` | ... |`
  for (const line of lines) {
    const m = line.match(/^\|\s*(\d{4})\s*\|\s*`(\d{4}-[^`]+\.md)`\s*\|/);
    if (m) {
      conflicts.push({ number: m[1], file: m[2] });
    }
  }

  // §"누락" 표: `| NNNN | 사유 |` (숫자만, .md 없음). 단 §"전체 인덱스" 의 `**NNNN**` 도 누락 마커.
  // 누락 표 형식은 단순 `| NNNN | text |` 라 모든 4자리만 행 매칭.
  // §"전체 인덱스" 의 `**NNNN**` 형식 별도 추출.
  let inGapSection = false;
  for (const line of lines) {
    if (/^##\s+누락/.test(line)) {
      inGapSection = true;
      continue;
    }
    if (inGapSection) {
      if (/^##\s+/.test(line)) {
        inGapSection = false;
        continue;
      }
      const m = line.match(/^\|\s*(\d{4})\s*\|/);
      if (m && !line.includes('`')) {
        gaps.push(m[1]);
      }
    }
  }

  // §"전체 인덱스" 표 행: `| NNNN | 제목 | 도메인 |` (또는 `| **NNNN** | *(누락)* | — |`)
  let inMainIndex = false;
  for (const line of lines) {
    if (/^##\s+전체 인덱스/.test(line)) {
      inMainIndex = true;
      continue;
    }
    if (inMainIndex) {
      if (/^##\s+/.test(line)) {
        inMainIndex = false;
        continue;
      }
      // `| **NNNN** | *(누락)* | — |`  — 누락 마커 (전체 인덱스 안)
      const gapM = line.match(/^\|\s*\*\*(\d{4})\*\*\s*\|\s*\*\(누락\)\*/);
      if (gapM) {
        const num = gapM[1];
        if (!gaps.includes(num)) gaps.push(num);
        mainIndex.set(num, { title: '(누락)', domain: '—', isGap: true });
        continue;
      }
      // 정상 행: `| NNNN | title | domain |`
      const rowM = line.match(/^\|\s*(\d{4})\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/);
      if (rowM) {
        const num = rowM[1];
        // 충돌 그룹 marker (`conflict ×N` 도메인) 도 mainIndex 에 등재됨
        mainIndex.set(num, {
          title: rowM[2].trim(),
          domain: rowM[3].trim(),
          isGap: false,
        });
      }
    }
  }

  return { nextNumber, mainIndex, conflicts, gaps };
}

/* ───────── 검증 로직 ───────── */

/**
 * computeMaxAdrNumber(byNumber) — 파일 시스템에서 발견한 max ADR 번호 (정수).
 */
export function computeMaxAdrNumber(byNumber) {
  let max = 0;
  for (const num of byNumber.keys()) {
    const n = parseInt(num, 10);
    if (n > max) max = n;
  }
  return max;
}

/**
 * formatAdrNumber(n) — `0001` 형식 4자리 zero-pad.
 */
export function formatAdrNumber(n) {
  return String(n).padStart(4, '0');
}

/**
 * validate(scan, parsed) — 6 검사 항목 적용.
 *
 * @returns {{ violations: Array<{ category: string, message: string }>, summary: object }}
 */
export function validate(scan, parsed) {
  const violations = [];
  const { byNumber, invalidNames } = scan;
  const { nextNumber, mainIndex, conflicts, gaps } = parsed;

  // F) 파일명 prefix 엄격 매치
  for (const name of invalidNames) {
    violations.push({
      category: 'F_INVALID_FILENAME',
      message: `파일명 패턴 위반: ${name} (기대: NNNN-name.md, 영소문자+숫자+하이픈)`,
    });
  }

  // A) 파일 존재 vs 인덱스 등재 — 파일 시스템 모든 ADR 이 인덱스에 등재되어야
  for (const [num, files] of byNumber) {
    if (!mainIndex.has(num)) {
      violations.push({
        category: 'A_MISSING_INDEX_ENTRY',
        message: `ADR 파일 ${files.join(', ')} (${num}) — INDEX.md §"전체 인덱스" 미등재`,
      });
    }
    // 충돌 파일은 §"알려진 충돌" 표에도 모두 등재되어야
    if (files.length > 1) {
      const conflictFiles = conflicts.filter((c) => c.number === num).map((c) => c.file);
      for (const f of files) {
        if (!conflictFiles.includes(f)) {
          violations.push({
            category: 'A_MISSING_CONFLICT_ENTRY',
            message: `충돌 ADR ${f} — §"알려진 충돌" 표 미등재`,
          });
        }
      }
    }
  }

  // B) 인덱스 등재 vs 파일 존재 — main index 의 비-누락 항목은 파일 존재해야
  for (const [num, info] of mainIndex) {
    if (info.isGap) continue;
    if (!byNumber.has(num)) {
      violations.push({
        category: 'B_STALE_INDEX_ENTRY',
        message: `INDEX.md 등재된 ADR ${num} (${info.title}) — 파일 시스템 부재`,
      });
    }
  }

  // E) 충돌 표 entries 모두 파일 시스템에 존재해야
  for (const c of conflicts) {
    if (!byNumber.has(c.number)) {
      violations.push({
        category: 'E_STALE_CONFLICT_ENTRY',
        message: `§"알려진 충돌" ${c.file} — 파일 시스템 부재`,
      });
      continue;
    }
    const filesForNum = byNumber.get(c.number);
    if (!filesForNum.includes(c.file)) {
      violations.push({
        category: 'E_STALE_CONFLICT_ENTRY',
        message: `§"알려진 충돌" ${c.file} — 파일 시스템 부재 (해당 번호 다른 파일은 존재)`,
      });
    }
  }

  // D) 누락 entries 가 실제로 파일 부재여야
  for (const num of gaps) {
    if (byNumber.has(num)) {
      violations.push({
        category: 'D_FALSE_GAP',
        message: `§"누락" 등재 ${num} — 실제 파일 시스템에 존재 (${byNumber.get(num).join(', ')})`,
      });
    }
  }

  // C) 다음 발급 번호 정합 — max(번호) + 1 또는 그 다음 미사용 번호
  if (nextNumber !== null) {
    const max = computeMaxAdrNumber(byNumber);
    const expected = formatAdrNumber(max + 1);
    if (nextNumber !== expected) {
      violations.push({
        category: 'C_NEXT_NUMBER_MISMATCH',
        message: `§"다음 발급" ${nextNumber} ≠ 기대값 ${expected} (max 번호 ${formatAdrNumber(max)} + 1)`,
      });
    }
  } else {
    violations.push({
      category: 'C_NEXT_NUMBER_MISSING',
      message: `§"다음 발급" 섹션 파싱 실패 — \`**다음 ADR 번호: \\\`NNNN\\\`**\` 패턴 부재`,
    });
  }

  const summary = {
    totalAdrFiles: Array.from(byNumber.values()).reduce((s, a) => s + a.length, 0),
    uniqueNumbers: byNumber.size,
    conflictGroups: Array.from(byNumber.values()).filter((a) => a.length > 1).length,
    indexedEntries: mainIndex.size,
    gapEntries: gaps.length,
    nextNumber,
    violationCount: violations.length,
  };

  return { violations, summary };
}

/* ───────── 메인 ───────── */

function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');

  if (!existsSync(INDEX_PATH)) {
    console.error(`[ADR Index] FAIL — INDEX.md 부재: ${INDEX_PATH}`);
    process.exit(1);
  }

  const indexSrc = readFileSync(INDEX_PATH, 'utf-8');
  const scan = scanAdrFiles(ADR_DIR);
  const parsed = parseIndex(indexSrc);
  const { violations, summary } = validate(scan, parsed);

  if (json) {
    console.log(JSON.stringify({ summary, violations }, null, 2));
    process.exit(violations.length === 0 ? 0 : 1);
  }

  if (violations.length === 0) {
    console.log(
      `[ADR Index] OK — ${summary.totalAdrFiles}개 파일 / ` +
        `${summary.uniqueNumbers}개 unique 번호 / ` +
        `충돌 ${summary.conflictGroups}그룹 / ` +
        `누락 ${summary.gapEntries}건 / ` +
        `다음 발급 ${summary.nextNumber}`
    );
    return;
  }

  console.error(`[ADR Index] FAIL — ${violations.length}건 위반:`);
  const byCategory = new Map();
  for (const v of violations) {
    if (!byCategory.has(v.category)) byCategory.set(v.category, []);
    byCategory.get(v.category).push(v.message);
  }
  for (const [cat, msgs] of byCategory) {
    console.error(`  [${cat}] ${msgs.length}건:`);
    for (const m of msgs) console.error(`    - ${m}`);
  }
  console.error('');
  console.error('해결: INDEX.md 갱신 — 신규 ADR 발급 시 §"다음 발급" 번호 사용 + §"전체 인덱스" 한 줄 추가.');
  process.exit(1);
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('check_adr_index.js');
if (isMain) {
  main();
}
