#!/usr/bin/env node
/**
 * @responsibility BUG_LEDGER 형식·area·status·severity·recurrence·P0 섹션·Fixes BUG 참조 검증 (PR #669 후속 P1 가드)
 *
 * BUG_LEDGER 수동 관리의 한계 (누락 / 오타 / area 불일치 / Fixes BUG 누락 / recurrence_count 누락) 차단.
 *
 * 검사 항목:
 *   1) 파일 존재 — docs/ops/BUG_LEDGER.md, BUG_AREAS.md, BUG_TEMPLATE.md
 *   2) BUG ID 형식 — `BUG-YYYY-MM-DD-NNN`
 *   3) BUG ID 중복 — frontmatter id: 기준
 *   4) frontmatter 필수 10 필드
 *   5) status enum (OPEN/PATCHED/VERIFIED/WATCHING/CLOSED/WONTFIX)
 *   6) severity enum (P0/P1/P2/P3)
 *   7) area — BUG_AREAS.md 정의 영역만 허용
 *   8) recurrence_count — 0 이상 정수
 *   9) discovered/resolved 날짜 — YYYY-MM-DD 또는 null
 *  10) P0 항목 7 필수 섹션 (증상/영향/재현/근본 원인/기대 동작/해결/재발 감시)
 *  11) P0 항목 위험 키워드 1개 이상
 *  12) related_adrs / keywords 배열 형식
 *  13) Fixes BUG 참조 무결성 (--text 인자)
 *
 * 사용:
 *   node scripts/check_bug_ledger.js                                  # 형식 검증
 *   node scripts/check_bug_ledger.js --text "Fixes BUG-2026-05-07-001" # 참조 무결성 추가
 *   node scripts/check_bug_ledger.js --json                            # JSON 진단
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(__dirname, '..');

export function resolveOpsDir(rootDir = DEFAULT_ROOT) {
  return join(rootDir, 'docs', 'ops');
}

export function resolveLedgerPaths(rootDir = DEFAULT_ROOT) {
  const opsDir = resolveOpsDir(rootDir);
  return {
    ledger: join(opsDir, 'BUG_LEDGER.md'),
    areas: join(opsDir, 'BUG_AREAS.md'),
    template: join(opsDir, 'BUG_TEMPLATE.md'),
  };
}

// ----- SSOT 상수 -----
export const BUG_ID_RE = /^BUG-\d{4}-\d{2}-\d{2}-\d{3}$/;
export const BUG_ID_REFERENCE_RE = /BUG-\d{4}-\d{2}-\d{2}-\d{3}/g;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const VALID_STATUSES = Object.freeze([
  'OPEN', 'PATCHED', 'VERIFIED', 'WATCHING', 'CLOSED', 'WONTFIX',
]);

export const VALID_SEVERITIES = Object.freeze(['P0', 'P1', 'P2', 'P3']);

export const REQUIRED_FRONTMATTER_KEYS = Object.freeze([
  'id', 'status', 'severity', 'area', 'discovered',
  'resolved', 'related_adrs', 'related_bugs', 'keywords', 'recurrence_count',
]);

export const P0_REQUIRED_SECTIONS = Object.freeze([
  '증상', '영향', '재현', '근본 원인', '기대 동작', '해결', '재발 감시',
]);

export const P0_RISK_KEYWORDS = Object.freeze([
  '자금 손실',
  '잘못된 주문',
  '손절 실패',
  '가짜 STRONG_BUY',
  '데이터 진실성 붕괴',
  '가짜 Confluence',
  '학습 데이터 오염',
]);

// 명시적으로 BUG_AREAS.md 가 누락된 경우의 안전 fallback 베이스라인 (사용자 명시 8 영역).
export const BUG_AREAS_FALLBACK = Object.freeze([
  'Market Truth Layer',
  'Order Execution Layer',
  'Risk Layer',
  'Learning Layer',
  'Persistence Layer',
  'Diagnostics Layer',
  'UI/UX Layer',
  'Infrastructure Layer',
]);

// ----- 파서 -----

/**
 * BUG_AREAS.md 의 H3 (### Area Name) 항목을 추출한다.
 * "영역 정의" / "영역 명명 규칙" 같은 메타 섹션은 H2 라 자동 제외.
 * H3 중에서도 `규칙|기준|정의|원칙` 키워드 포함 항목은 제외.
 */
export function parseAreas(src) {
  const areas = new Set();
  if (typeof src !== 'string') return areas;
  const lines = src.split('\n');
  for (const line of lines) {
    const m = line.match(/^###\s+(.+?)\s*$/);
    if (!m) continue;
    const name = m[1].trim();
    if (/(규칙|기준|정의|원칙)/.test(name)) continue;
    areas.add(name);
  }
  return areas;
}

/**
 * 단순 YAML-스타일 frontmatter 파서 (BUG_LEDGER 형식 한정).
 * 외부 yaml 패키지 미사용.
 */
export function parseFrontmatter(block) {
  const result = {};
  if (typeof block !== 'string') return result;
  const lines = block.split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^([a-z_][a-z0-9_]*)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1];
    const value = m[2].trim();
    result[key] = parseFrontmatterValue(value);
  }
  return result;
}

function parseFrontmatterValue(value) {
  if (value === '' || value === '~') return null;
  if (value === 'null' || value === 'Null' || value === 'NULL') return null;
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, ''));
  }
  if (/^-?\d+$/.test(value)) {
    return parseInt(value, 10);
  }
  if (/^-?\d+\.\d+$/.test(value)) {
    // 소수는 의도적으로 string 으로 보존 → recurrence_count 검증에서 fail.
    return value;
  }
  return value.replace(/^['"]|['"]$/g, '');
}

/**
 * BUG_LEDGER.md 안의 BUG 항목을 추출한다.
 *
 * 규칙: 본 장부에서 BUG 항목은 `---` ... `---` frontmatter 블록 + 그 직후 본문이다.
 * 문서 메타 (frontmatter 표준 §) 안의 ```yaml ... ``` 코드 블록은 제외해야 한다.
 */
export function extractBugEntries(src) {
  const entries = [];
  if (typeof src !== 'string') return entries;
  const lines = src.split('\n');
  let i = 0;
  let inFence = false;
  while (i < lines.length) {
    const line = lines[i];
    // 코드 펜스 진입/탈출 추적 — 펜스 안 `---` 은 frontmatter 가 아님
    if (/^```/.test(line.trim())) {
      inFence = !inFence;
      i++;
      continue;
    }
    if (!inFence && line.trim() === '---') {
      // closing `---` 검색
      let j = i + 1;
      while (j < lines.length && lines[j].trim() !== '---') j++;
      if (j >= lines.length) { i++; continue; }
      const fmBlock = lines.slice(i + 1, j).join('\n');
      // BUG entry 판정 — `id: BUG-...` 시작 라인이 있어야 함
      if (/^\s*id\s*:\s*BUG-/m.test(fmBlock)) {
        // 본문 종료 위치 — 다음 frontmatter (`---` + `id:` 시작) 또는 EOF
        let bodyEnd = j + 1;
        let bodyFence = false;
        while (bodyEnd < lines.length) {
          const bl = lines[bodyEnd];
          if (/^```/.test(bl.trim())) { bodyFence = !bodyFence; bodyEnd++; continue; }
          if (!bodyFence && bl.trim() === '---' && bodyEnd + 1 < lines.length
              && /^\s*id\s*:/.test(lines[bodyEnd + 1])) {
            break;
          }
          bodyEnd++;
        }
        const body = lines.slice(j + 1, bodyEnd).join('\n');
        entries.push({
          frontmatterStartLine: i + 1,
          frontmatterEndLine: j + 1,
          frontmatter: parseFrontmatter(fmBlock),
          rawFrontmatter: fmBlock,
          body,
        });
        i = bodyEnd;
        continue;
      }
    }
    i++;
  }
  return entries;
}

// ----- 검증 -----

function pushError(errors, code, message) {
  errors.push({ code, message });
}

export function validateLedger({ ledgerSrc, areasSrc }) {
  const errors = [];
  const stats = { bugs: 0, open: 0, p0: 0, watching: 0 };

  if (typeof ledgerSrc !== 'string') {
    pushError(errors, 'BUG_LEDGER_MISSING', 'docs/ops/BUG_LEDGER.md 읽기 실패');
    return { errors, stats, entries: [], areas: new Set() };
  }

  const areas = parseAreas(typeof areasSrc === 'string' ? areasSrc : '');
  // BUG_AREAS.md 부재 또는 파싱 실패 시 fallback baseline 사용
  const effectiveAreas = areas.size > 0 ? areas : new Set(BUG_AREAS_FALLBACK);

  const entries = extractBugEntries(ledgerSrc);
  stats.bugs = entries.length;

  const seenIds = new Set();
  for (const entry of entries) {
    const fm = entry.frontmatter;
    const idLabel = typeof fm.id === 'string' ? fm.id : '(no id)';
    const where = `${idLabel} (line ~${entry.frontmatterStartLine})`;

    // 4) frontmatter 필수 필드
    for (const key of REQUIRED_FRONTMATTER_KEYS) {
      if (!(key in fm)) {
        pushError(errors, 'FRONTMATTER_MISSING_FIELD',
          `${where}: 필수 frontmatter 필드 "${key}" 누락`);
      }
    }

    // 2) BUG ID 형식
    if (typeof fm.id === 'string' && !BUG_ID_RE.test(fm.id)) {
      pushError(errors, 'BUG_ID_INVALID',
        `${where}: id 형식 위반 (BUG-YYYY-MM-DD-NNN 필요)`);
    }

    // 3) 중복 ID — frontmatter id: 기준
    if (typeof fm.id === 'string' && BUG_ID_RE.test(fm.id)) {
      if (seenIds.has(fm.id)) {
        pushError(errors, 'BUG_ID_DUPLICATE',
          `${where}: 중복 BUG ID`);
      }
      seenIds.add(fm.id);
    }

    // 5) status enum
    if (fm.status !== undefined && fm.status !== null) {
      if (typeof fm.status !== 'string' || !VALID_STATUSES.includes(fm.status)) {
        pushError(errors, 'STATUS_INVALID',
          `${where}: status="${fm.status}" 무효 (허용: ${VALID_STATUSES.join('/')})`);
      }
    }

    // 6) severity enum
    if (fm.severity !== undefined && fm.severity !== null) {
      if (typeof fm.severity !== 'string' || !VALID_SEVERITIES.includes(fm.severity)) {
        pushError(errors, 'SEVERITY_INVALID',
          `${where}: severity="${fm.severity}" 무효 (허용: ${VALID_SEVERITIES.join('/')})`);
      }
    }

    // 7) area
    if (fm.area !== undefined && fm.area !== null) {
      if (typeof fm.area !== 'string' || !effectiveAreas.has(fm.area)) {
        pushError(errors, 'AREA_INVALID',
          `${where}: area="${fm.area}" 가 BUG_AREAS.md 에 정의되지 않음`);
      }
    }

    // 8) recurrence_count
    if ('recurrence_count' in fm) {
      const v = fm.recurrence_count;
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
        pushError(errors, 'RECURRENCE_INVALID',
          `${where}: recurrence_count 는 0 이상 정수 (현재: ${JSON.stringify(v)})`);
      }
    }

    // 9-a) discovered
    if (fm.discovered !== undefined && fm.discovered !== null) {
      if (typeof fm.discovered !== 'string' || !DATE_RE.test(fm.discovered)) {
        pushError(errors, 'DATE_INVALID',
          `${where}: discovered="${fm.discovered}" 형식 위반 (YYYY-MM-DD 필요)`);
      }
    }

    // 9-b) resolved (null 또는 YYYY-MM-DD)
    if ('resolved' in fm && fm.resolved !== null) {
      if (typeof fm.resolved !== 'string' || !DATE_RE.test(fm.resolved)) {
        pushError(errors, 'DATE_INVALID',
          `${where}: resolved="${fm.resolved}" 형식 위반 (null 또는 YYYY-MM-DD 필요)`);
      }
    }

    // 11) related_adrs 배열
    if ('related_adrs' in fm) {
      if (!Array.isArray(fm.related_adrs)) {
        pushError(errors, 'RELATED_ADRS_INVALID',
          `${where}: related_adrs 는 배열이어야 함`);
      } else {
        for (const ref of fm.related_adrs) {
          if (typeof ref !== 'string' || !/^ADR-\d{4}[a-z]?$/.test(ref)) {
            pushError(errors, 'RELATED_ADRS_INVALID',
              `${where}: related_adrs 항목 "${ref}" 형식 위반 (ADR-NNNN 또는 ADR-NNNNa)`);
          }
        }
      }
    }

    // 12) keywords 배열
    if ('keywords' in fm) {
      if (!Array.isArray(fm.keywords)) {
        pushError(errors, 'KEYWORDS_INVALID',
          `${where}: keywords 는 배열이어야 함`);
      }
    }

    // 10) P0 필수 섹션
    if (fm.severity === 'P0') {
      stats.p0 += 1;
      for (const section of P0_REQUIRED_SECTIONS) {
        if (!entry.body.includes(section)) {
          pushError(errors, 'P0_SECTION_MISSING',
            `${where}: P0 항목에 필수 섹션 "${section}" 누락`);
        }
      }
      // 11) P0 위험 키워드 1개 이상
      const hasRiskKeyword = P0_RISK_KEYWORDS.some((kw) => entry.body.includes(kw));
      if (!hasRiskKeyword) {
        pushError(errors, 'P0_RISK_KEYWORD_MISSING',
          `${where}: P0 항목에 위험 키워드 1개 이상 필요 (${P0_RISK_KEYWORDS.join(' / ')})`);
      }
    }

    // 통계 갱신
    if (fm.status === 'OPEN') stats.open += 1;
    if (fm.status === 'WATCHING') stats.watching += 1;
  }

  return { errors, stats, entries, areas: effectiveAreas };
}

/**
 * --text 인자에서 BUG-YYYY-MM-DD-NNN 참조를 추출하여
 * BUG_LEDGER.md 의 frontmatter id: 와 매칭한다.
 */
export function checkFixesReferences({ ledgerSrc, text }) {
  const errors = [];
  const referenced = new Set();
  if (typeof text !== 'string' || !text) {
    return { errors, referenced: [] };
  }
  const matches = text.match(BUG_ID_REFERENCE_RE);
  if (matches) {
    for (const id of matches) referenced.add(id);
  }
  const ledger = typeof ledgerSrc === 'string' ? ledgerSrc : '';
  for (const id of referenced) {
    // frontmatter id: 라인 검사 — heading 등장만으로는 통과 차단
    const idLineRe = new RegExp(`^\\s*id\\s*:\\s*${id}\\s*$`, 'm');
    if (!idLineRe.test(ledger)) {
      pushError(errors, 'UNKNOWN_BUG_REFERENCE',
        `${id} 가 BUG_LEDGER.md 에 등록되지 않음`);
    }
  }
  return { errors, referenced: Array.from(referenced) };
}

// ----- CLI -----

export function readFileSafe(p) {
  try {
    return readFileSync(p, 'utf8');
  } catch (_err) {
    return null;
  }
}

export function runCli({
  argv = [],
  stdout = process.stdout,
  stderr = process.stderr,
  rootDir = DEFAULT_ROOT,
} = {}) {
  const jsonMode = argv.includes('--json');
  const textIdx = argv.indexOf('--text');
  const textArg = textIdx >= 0 && argv[textIdx + 1] ? argv[textIdx + 1] : null;
  const paths = resolveLedgerPaths(rootDir);

  const errors = [];

  // 1) 파일 존재
  if (!existsSync(paths.ledger)) {
    pushError(errors, 'BUG_LEDGER_MISSING', 'docs/ops/BUG_LEDGER.md 부재');
  }
  if (!existsSync(paths.areas)) {
    pushError(errors, 'BUG_AREAS_MISSING', 'docs/ops/BUG_AREAS.md 부재');
  }
  if (!existsSync(paths.template)) {
    pushError(errors, 'BUG_TEMPLATE_MISSING', 'docs/ops/BUG_TEMPLATE.md 부재');
  }

  let stats = { bugs: 0, open: 0, p0: 0, watching: 0 };
  let referenced = [];
  let ledgerSrc = null;
  if (errors.length === 0) {
    ledgerSrc = readFileSafe(paths.ledger);
    const areasSrc = readFileSafe(paths.areas);
    const result = validateLedger({ ledgerSrc, areasSrc });
    errors.push(...result.errors);
    stats = result.stats;

    // 13) Fixes BUG 참조 무결성
    if (textArg !== null) {
      const ref = checkFixesReferences({ ledgerSrc, text: textArg });
      errors.push(...ref.errors);
      referenced = ref.referenced;
    }
  } else if (textArg !== null) {
    // BUG_LEDGER 부재여도 사용자 텍스트 자체는 분석
    const ref = checkFixesReferences({ ledgerSrc: '', text: textArg });
    errors.push(...ref.errors);
    referenced = ref.referenced;
  }

  if (jsonMode) {
    stdout.write(JSON.stringify({
      ok: errors.length === 0,
      errors,
      stats,
      referenced,
    }, null, 2) + '\n');
  } else if (errors.length === 0) {
    stdout.write('✅ BUG_LEDGER validation passed\n');
    stdout.write(`- bugs: ${stats.bugs}\n`);
    stdout.write(`- open: ${stats.open}\n`);
    stdout.write(`- p0: ${stats.p0}\n`);
    stdout.write(`- watching: ${stats.watching}\n`);
    if (referenced.length > 0) {
      stdout.write(`- fixes references verified: ${referenced.length}\n`);
    }
  } else {
    stderr.write('❌ BUG_LEDGER validation failed\n');
    for (const e of errors) {
      stderr.write(`- [${e.code}] ${e.message}\n`);
    }
  }

  return errors.length === 0 ? 0 : 1;
}

const isMain = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch (_err) {
    return false;
  }
})();

if (isMain) {
  const exitCode = runCli({ argv: process.argv.slice(2) });
  process.exit(exitCode);
}
