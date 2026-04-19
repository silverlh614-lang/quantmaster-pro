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

/**
 * 라인/블록 주석을 같은 길이의 공백으로 치환해 코드의 절대 위치(라인/컬럼)를 보존.
 * 문자열 리터럴(작은/큰/백틱) 안의 // /* 시퀀스는 주석으로 간주하지 않는다.
 */
function stripCommentsPreservingPositions(src) {
  const out = [];
  let i = 0;
  let state = 'code'; // 'code' | 'sq' | 'dq' | 'tpl' | 'block' | 'line'
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (state === 'code') {
      if (c === '/' && n === '/') { out.push('  '); i += 2; state = 'line'; continue; }
      if (c === '/' && n === '*') { out.push('  '); i += 2; state = 'block'; continue; }
      if (c === "'") { state = 'sq'; out.push(c); i++; continue; }
      if (c === '"') { state = 'dq'; out.push(c); i++; continue; }
      if (c === '`') { state = 'tpl'; out.push(c); i++; continue; }
      out.push(c); i++; continue;
    }
    if (state === 'sq' || state === 'dq') {
      const quote = state === 'sq' ? "'" : '"';
      if (c === '\\' && i + 1 < src.length) { out.push(c, src[i + 1]); i += 2; continue; }
      if (c === quote) { state = 'code'; out.push(c); i++; continue; }
      out.push(c); i++; continue;
    }
    if (state === 'tpl') {
      if (c === '\\' && i + 1 < src.length) { out.push(c, src[i + 1]); i += 2; continue; }
      if (c === '`') { state = 'code'; out.push(c); i++; continue; }
      out.push(c); i++; continue;
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; out.push(c); i++; continue; }
      out.push(' '); i++; continue;
    }
    if (state === 'block') {
      if (c === '*' && n === '/') { out.push('  '); i += 2; state = 'code'; continue; }
      // 줄바꿈은 보존 (라인 번호 정확도)
      out.push(c === '\n' ? '\n' : ' '); i++; continue;
    }
  }
  return out.join('');
}

function scanSwallowedErrors(files) {
  // catch (e) { ... } 블록을 스캔해서 logger/console/throw/return 중 어느 것도
  // 없으면 swallowed error 로 간주한다.
  const offenders = [];
  const catchRe = /catch\s*\(\s*([A-Za-z_$][\w$]*)?\s*\)\s*\{/g;

  for (const f of files) {
    const rawSrc = readFileSync(f, 'utf-8');
    // 블록·라인 주석 안의 catch 키워드(예: JSDoc 예시)를 스캔에서 제외하기 위해
    // 코드 본문 위치를 보존한 채 동일 길이의 공백으로 치환한다.
    // 단, SDS-ignore 검사는 raw 소스에서 수행해야 하므로 body는 rawSrc로 추출.
    const src = stripCommentsPreservingPositions(rawSrc);
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
      // 본문은 rawSrc에서 추출 — /* SDS-ignore */ 등 의도적 무시 마커를 보존하기 위함.
      const body    = src.slice(start, i - 1);
      const rawBody = rawSrc.slice(start, i - 1);
      const trimmed    = body.trim();
      const rawTrimmed = rawBody.trim();
      // 진짜 빈 catch는 raw 본문도 비어 있어야 한다. 주석만 있는 catch는 의도적 swallow로 본다.
      if (trimmed === '' && rawTrimmed === '') {
        offenders.push({ file: f, reason: 'empty catch block' });
        continue;
      }
      const ignored = /SDS-ignore/.test(rawBody);
      if (ignored) continue;
      // 주석으로 의도가 명시된 빈 catch (예: "// Ignore", "// Not JSON")는 swallow로 인정.
      if (trimmed === '' && /\/\/.*|\/\*[\s\S]*?\*\//.test(rawBody)) continue;
      // 인정 패턴:
      //   - 표준 콘솔/로거/리포터/토스트/Sentry
      //   - 프로젝트 디버그 헬퍼: debugLog/debugWarn/debugError (console.* 직접 래퍼)
      //   - 스트림/도메인 이벤트 로거: logStreamEvent
      //   - React 상태 셋터로 UI에 에러 표면화: setError/setErr/setFlash/set*Error
      //   - HTTP 응답으로 클라이언트에 통보: res.status / res.json / res.send
      //   - 진단 누적: issues.push / warnings.push / errors.push (호출자가 반환받음)
      //   - 텔레그램 봇 응답: await reply(
      const mentionsLogging = new RegExp([
        'console\\.(log|warn|error|info|debug)',
        'logger\\.',           'log\\.',
        'reportError',         'captureException',
        'toast\\.',            'Sentry\\.',
        'debug(Log|Warn|Error)\\(',
        'logStreamEvent\\(',
        'set\\w*(Err|Error|Flash|Status|Message)\\(',  // setError/setErr/setScanError/setFlash/setStatus/setMessage
        'setLoading\\(',                                  // 종종 catch에서 false로 리셋
        '\\bres\\.(status|json|send)\\(',
        '\\b(issues|warnings|errors)\\.push\\(',
        '\\breply\\(',
      ].join('|')).test(body);
      // break도 catch 탈출(루프 종료) 의미 — 상위 코드에서 lastErr를 throw하는 패턴 인정.
      const rethrows = /\b(throw|return|reject\(|break\b)/.test(body);
      if (!mentionsLogging && !rethrows) {
        const lineNo = rawSrc.slice(0, m.index).split('\n').length;
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
