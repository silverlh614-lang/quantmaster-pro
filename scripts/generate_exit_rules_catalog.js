/**
 * generate_exit_rules_catalog.js — Exit Rule Catalog 자동 생성 (PR-R / 아이디어 6)
 *
 * server/trading/exitEngine.ts + server/trading/rules/*.ts 의 @rule 표준 헤더를 추출해
 * docs/exit-rules-catalog.md 를 자동 생성한다. 회고/감사 시 SSOT 단일 문서.
 *
 * Schema: docs/EXIT_RULE_HEADER.md 참조.
 *
 * 사용:
 *   npm run build:exit-catalog
 *   node scripts/generate_exit_rules_catalog.js [--check]   # --check 면 변경사항 있을 시 exit 1 (CI)
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOTS = [
  'server/trading/exitEngine.ts',          // PR-53 후 barrel (legacy ref)
  'server/trading/exitEngine/rules',       // PR-53 분해 후 실제 위치 (ADR-0028)
  'server/trading/rules',                  // legacy (미사용)
];

const OUTPUT = 'docs/exit-rules-catalog.md';

// JSDoc @rule 블록 매칭 — 다중 라인 + 옵셔널 필드.
// 캡처: 헤더 본문 (라인 단위 파싱은 본문 후처리)
const RULE_BLOCK_RE = /\/\*\*\s*\n([\s\S]*?@rule[\s\S]*?)\*\//g;

const REQUIRED_FIELDS = ['rule', 'priority', 'action', 'trigger', 'rationale'];
const OPTIONAL_FIELDS = ['ratio', 'regime', 'minHoldingDays', 'deprecated'];
const ALL_FIELDS = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS];

function walkTs(dir, out = []) {
  if (!existsSync(dir)) return out;
  const stat = statSync(dir);
  if (stat.isFile()) {
    if (dir.endsWith('.ts') && !dir.endsWith('.test.ts')) out.push(dir);
    return out;
  }
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') || name === 'node_modules') continue;
    walkTs(join(dir, name), out);
  }
  return out;
}

function extractFieldValue(body, field) {
  // @field <value...> (다음 @field 또는 블록 종료 까지)
  const re = new RegExp(`@${field}\\s+([^\\n]+(?:\\n\\s*\\*\\s+(?!@)[^\\n]+)*)`, 'i');
  const m = body.match(re);
  if (!m) return null;
  return m[1]
    .split('\n')
    .map(line => line.replace(/^\s*\*\s*/, '').trim())
    .filter(Boolean)
    .join(' ')
    .trim();
}

function parseRuleBlock(blockBody, file, lineNumber) {
  const rule = {};
  for (const field of ALL_FIELDS) {
    const value = extractFieldValue(blockBody, field);
    if (value != null) rule[field] = value;
  }
  // 필수 필드 검증
  const missing = REQUIRED_FIELDS.filter(f => !rule[f]);
  if (missing.length > 0) {
    return { error: `누락 필수 필드: ${missing.join(', ')}`, file, lineNumber };
  }
  // priority 정수 변환
  const priorityNum = parseInt(rule.priority, 10);
  if (!Number.isFinite(priorityNum) || priorityNum < 1) {
    return { error: `잘못된 priority: "${rule.priority}"`, file, lineNumber };
  }
  rule.priority = priorityNum;
  // ratio 숫자 변환 (옵션)
  if (rule.ratio != null) {
    const r = parseFloat(rule.ratio);
    if (Number.isFinite(r) && r >= 0 && r <= 1) rule.ratio = r;
  }
  rule._source = `${file}:${lineNumber}`;
  return { rule };
}

function extractRulesFromFile(file) {
  const src = readFileSync(file, 'utf-8');
  const rules = [];
  const errors = [];
  let m;
  RULE_BLOCK_RE.lastIndex = 0;
  while ((m = RULE_BLOCK_RE.exec(src)) !== null) {
    const blockBody = m[1];
    const lineNumber = src.slice(0, m.index).split('\n').length;
    const result = parseRuleBlock(blockBody, file, lineNumber);
    if (result.error) errors.push(result);
    else rules.push(result.rule);
  }
  return { rules, errors };
}

function collectAllRules() {
  const allRules = [];
  const allErrors = [];
  for (const root of ROOTS) {
    const files = walkTs(root);
    for (const file of files) {
      const { rules, errors } = extractRulesFromFile(file);
      allRules.push(...rules);
      allErrors.push(...errors);
    }
  }
  return { allRules, allErrors };
}

function formatCatalog(rules, errors) {
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  const now = new Date().toISOString().slice(0, 10);

  let out = '# Exit Rules Catalog\n\n';
  out += `> 자동 생성 — \`npm run build:exit-catalog\` (스크립트: \`scripts/generate_exit_rules_catalog.js\`)\n`;
  out += `> Schema: [docs/EXIT_RULE_HEADER.md](./EXIT_RULE_HEADER.md)\n`;
  out += `> Generated: ${now}\n\n`;
  out += `**총 ${sorted.length}개 매도 규칙** (priority 오름차순).\n\n`;

  if (sorted.length === 0) {
    out += '_매도 규칙이 검출되지 않았습니다 — `@rule` 헤더 추가 후 재실행하세요._\n\n';
  } else {
    out += '| # | rule | priority | action | ratio | trigger | rationale | source |\n';
    out += '|---|------|---------:|--------|------:|---------|-----------|--------|\n';
    for (let i = 0; i < sorted.length; i += 1) {
      const r = sorted[i];
      const ratio = r.ratio != null ? (typeof r.ratio === 'number' ? `${(r.ratio * 100).toFixed(0)}%` : r.ratio) : '—';
      const trigger = (r.trigger ?? '—').replace(/\|/g, '\\|');
      const rationale = (r.rationale ?? '—').replace(/\|/g, '\\|');
      const source = r._source.replace(/\|/g, '\\|');
      out += `| ${i + 1} | \`${r.rule}\` | ${r.priority} | \`${r.action}\` | ${ratio} | \`${trigger}\` | ${rationale} | \`${source}\` |\n`;
    }
    out += '\n';
  }

  if (errors.length > 0) {
    out += `## ⚠️ 검출된 헤더 오류 (${errors.length})\n\n`;
    for (const e of errors) {
      out += `- \`${e.file}:${e.lineNumber}\` — ${e.error}\n`;
    }
    out += '\n';
  }

  out += '---\n\n';
  out += '신규 규칙 추가 시 `docs/EXIT_RULE_HEADER.md` 의 표준 schema 를 따라 헤더 작성 후 재생성.\n';
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const checkMode = args.includes('--check');

  const { allRules, allErrors } = collectAllRules();
  const newContent = formatCatalog(allRules, allErrors);

  const existing = existsSync(OUTPUT) ? readFileSync(OUTPUT, 'utf-8') : '';
  // Generated 줄 차이 무시한 비교 (날짜 갱신 제외)
  const stripDate = (s) => s.replace(/^>\s*Generated:.*$/m, '> Generated: <date>');
  const changed = stripDate(existing) !== stripDate(newContent);

  if (checkMode) {
    if (changed) {
      console.error('[ExitRulesCatalog] FAIL — docs/exit-rules-catalog.md 가 최신 상태가 아닙니다.');
      console.error('  해결: `npm run build:exit-catalog` 후 commit.');
      if (allErrors.length > 0) {
        console.error(`  헤더 오류 ${allErrors.length}건:`);
        for (const e of allErrors) console.error(`    ${e.file}:${e.lineNumber} — ${e.error}`);
      }
      process.exit(1);
    }
    console.log(`[ExitRulesCatalog] OK — ${allRules.length}개 규칙, 카탈로그 최신 상태.`);
    return;
  }

  writeFileSync(OUTPUT, newContent);
  console.log(`[ExitRulesCatalog] ${allRules.length}개 규칙 추출 → ${OUTPUT} 갱신.`);
  if (allErrors.length > 0) {
    console.warn(`[ExitRulesCatalog][WARN] 헤더 오류 ${allErrors.length}건 — 카탈로그 하단 참조.`);
  }
}

main();
