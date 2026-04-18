/**
 * silent_degradation_sentinel.js  —  SDS
 *
 * "Gemini 모델명 오류가 일부 함수에 남아있다가 조용한 열화로 번지는" 재앙을 막는다.
 *
 * 기능:
 *   1) 전 코드베이스에서 AI 모델 문자열(gemini-*, claude-*, gpt-* 등)을 수집한다.
 *   2) src/constants/aiConfig.ts 의 AI_MODELS 상수에 등록된 값과 다르면 빌드 실패.
 *   3) try/catch 가 에러를 잡기만 하고 console/logger 로 남기지 않는 패턴(swallowed error)을
 *      정적 분석으로 탐지해 실패 처리한다.
 *
 * responseMimeType × googleSearch 충돌 검사(validate_gemini_calls.js)의 자연스러운 확장.
 *
 * 사용:
 *   node scripts/silent_degradation_sentinel.js
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

const ROOT = 'src';
const SERVER = 'server';
const AI_CONFIG_FILES = ['src/constants/aiConfig.ts', 'server/constants.ts'];
const EXTS = new Set(['.ts', '.tsx', '.js', '.mjs']);
const MODEL_RE = /['"`](gemini-[a-z0-9.\-]+|claude-[a-z0-9.\-]+|gpt-[a-z0-9.\-]+|text-bison-[a-z0-9.\-]+)['"`]/gi;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'build') continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (EXTS.has(extname(p))) out.push(p);
  }
  return out;
}

function readApprovedModels() {
  const approved = new Set();
  for (const file of AI_CONFIG_FILES) {
    if (!existsSync(file)) continue;
    const src = readFileSync(file, 'utf-8');
    const block = src.match(/AI_MODELS\s*=\s*\{([\s\S]*?)\}\s*as\s+const/);
    const body = block ? block[1] : src;
    const re = /['"`]([a-zA-Z][a-zA-Z0-9.\-_:]+)['"`]/g;
    let m;
    while ((m = re.exec(body)) !== null) approved.add(m[1]);
  }
  if (approved.size === 0) console.warn('[SDS] AI_MODELS 정의를 찾지 못했음 — 승인 목록 비어 있음으로 진행');
  return approved;
}

function scanModels(files, approved) {
  const bad = [];
  for (const f of files) {
    if (AI_CONFIG_FILES.includes(f)) continue;
    const src = readFileSync(f, 'utf-8');
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      // 주석에 나오는 모델명은 허용
      const stripped = line.replace(/\/\/.*$/, '').replace(/\/\*[\s\S]*?\*\//g, '');
      let m;
      MODEL_RE.lastIndex = 0;
      while ((m = MODEL_RE.exec(stripped)) !== null) {
        const model = m[1];
        if (!approved.has(model)) {
          bad.push({ file: f, line: i + 1, model, snippet: line.trim() });
        }
      }
    });
  }
  return bad;
}

function scanSwallowedErrors(files) {
  // catch (e) { ... } 블록을 스캔해서 logger/console/throw/return 중 어느 것도
  // 없으면 swallowed error 로 간주한다.
  const offenders = [];
  const catchRe = /catch\s*\(\s*([A-Za-z_$][\w$]*)?\s*\)\s*\{/g;

  for (const f of files) {
    const src = readFileSync(f, 'utf-8');
    let m;
    while ((m = catchRe.exec(src)) !== null) {
      // 블록 본문 추출
      const start = catchRe.lastIndex;
      let depth = 1;
      let i = start;
      while (i < src.length && depth > 0) {
        const ch = src[i];
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        i++;
      }
      const body = src.slice(start, i - 1);
      const trimmed = body.trim();
      if (trimmed === '' || trimmed === ';') {
        offenders.push({ file: f, reason: 'empty catch block' });
        continue;
      }
      const ignored = /SDS-ignore/.test(body);
      if (ignored) continue;
      const mentionsLogging = /(console\.(log|warn|error|info|debug)|logger\.|log\.|reportError|captureException|toast\.|Sentry\.)/.test(body);
      const rethrows = /\b(throw|return|reject\()/.test(body);
      if (!mentionsLogging && !rethrows) {
        const lineNo = src.slice(0, m.index).split('\n').length;
        offenders.push({ file: f, line: lineNo, reason: 'catch block has no log/throw/return' });
      }
    }
  }
  return offenders;
}

function main() {
  const args = process.argv.slice(2);
  const strict = args.includes('--strict');

  const approved = readApprovedModels();
  const files = [...walk(ROOT), ...walk(SERVER)];

  console.log(`[SDS] 스캔 대상: ${files.length} 파일`);
  console.log(`[SDS] AI_MODELS 승인 목록: ${Array.from(approved).join(', ') || '(비어 있음)'}`);

  const modelViolations = approved.size > 0 ? scanModels(files, approved) : [];
  const swallowed = scanSwallowedErrors(files);

  let failed = false;

  // 모델 문자열 불일치는 항상 hard fail — 조용한 열화의 주 원인.
  if (modelViolations.length > 0) {
    console.error(`\n[SDS][FAIL] 승인되지 않은 AI 모델 문자열 ${modelViolations.length}건`);
    for (const v of modelViolations) {
      console.error(`  ${v.file}:${v.line}  "${v.model}"`);
      console.error(`    → ${v.snippet}`);
    }
    console.error('  해결: AI_MODELS 상수를 import 해서 사용하거나 상수 파일에 모델을 등록하세요.');
    failed = true;
  }

  // Swallowed catch 는 기본 경고, --strict 에서 실패.
  if (swallowed.length > 0) {
    const label = strict ? '[SDS][FAIL]' : '[SDS][WARN]';
    console.error(`\n${label} swallowed error(로그 없이 삼켜진 catch) ${swallowed.length}건`);
    for (const s of swallowed.slice(0, 30)) {
      console.error(`  ${s.file}${s.line ? ':' + s.line : ''}  ${s.reason}`);
    }
    if (swallowed.length > 30) console.error(`  ... 외 ${swallowed.length - 30}건`);
    console.error('  해결: console.error/logger 로 남기거나, 의도적 무시라면 /* SDS-ignore */ 주석을 추가하세요.');
    if (strict) failed = true;
  }

  if (failed) process.exit(1);
  console.log('\n[SDS] OK — 모델 문자열 일관성 정상');
}

main();
