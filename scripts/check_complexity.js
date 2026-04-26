/**
 * check_complexity.js  —  ACMA (App.tsx Cyclomatic Meltdown Alarm)
 *
 * 한계치를 넘는 대형 컴포넌트 파일을 pre-commit 단계에서 차단한다.
 * 측정 항목:
 *   - 라인 수 (공백/주석 포함 원문 기준)
 *   - JSX 최대 중첩 깊이 (단순 토큰 카운팅)
 *   - useEffect 호출 개수
 *   - import 선언 개수
 *   - PR-Q (아이디어 9): 함수 단위 라인 수 + cyclomatic complexity 근사 (GodFunctionGuard)
 *
 * "코드가 길어지는 것보다 결합도가 높아지는 것이 더 위험하다."
 * — SRP 즉각적 파산을 기계적으로 막기 위한 스크립트.
 *
 * 사용:
 *   node scripts/check_complexity.js                 # 기본 타겟(App.tsx + 상위 경고)
 *   node scripts/check_complexity.js path/to.tsx ... # 경로 직접 지정
 *   SUGGEST=1 node scripts/check_complexity.js       # 초과 시 refactor-suggester 호출
 *   FUNCTION_GUARD=strict                           # 함수 임계 초과 시 빌드 실패 (기본: warn)
 *   FUNCTION_GUARD_STRICT_SCOPE=server/trading/exitEngine,server/trading/signalScanner/entryGates
 *                                                   # 콤마 구분 디렉토리 — 해당 prefix 안 offender 만
 *                                                   # 빌드 실패. 외부 디렉토리는 WARN 만 (분해된
 *                                                   # 영역의 깨끗한 상태 락-인용).
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, relative, extname } from 'path';
import { execSync } from 'child_process';

const LIMITS = {
  lines: 1500,
  jsxDepth: 18, // 들여쓰기 기반 근사치이므로 느슨하게 설정
  useEffects: 10,
  imports: 50,
};

// PR-Q (아이디어 9 — GodFunctionGuard): 함수 단위 임계.
// 페르소나의 "직전 청소된 곳도 다시 더러워질 수 있지만 청소되지 않은 곳보다는 낫다" 코드 버전.
// 분해 직후의 깨끗한 상태를 락-인하기 위한 사전 차단.
const FUNCTION_LIMITS = {
  lines: 300,                 // 함수 본문 최대 줄 수
  cyclomaticComplexity: 25,   // if/else/case/&&/||/?: 카운트 (근사)
};

const DEFAULT_TARGETS = ['src/App.tsx'];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (['.tsx', '.ts'].includes(extname(p))) out.push(p);
  }
  return out;
}

function countJsxDepth(source) {
  // TypeScript 제네릭(<Foo>) 과 JSX 태그를 regex로 구분하기 어렵기 때문에,
  // 들여쓰기 기반 휴리스틱을 사용한다: JSX 열기 태그로 시작하는 라인의
  // 최대 indent 레벨을 깊이로 간주한다. 탭은 4칸으로 환산.
  const lines = source.split('\n');
  let max = 0;
  for (const raw of lines) {
    const line = raw.replace(/\t/g, '    ');
    const m = line.match(/^(\s*)<[A-Za-z]/);
    if (!m) continue;
    const indent = m[1].length;
    const depth = Math.floor(indent / 2);
    if (depth > max) max = depth;
  }
  return max;
}

function countMatches(source, re) {
  const m = source.match(re);
  return m ? m.length : 0;
}

function analyze(file) {
  const src = readFileSync(file, 'utf-8');
  const lines = src.split('\n').length;
  const jsxDepth = countJsxDepth(src);
  const useEffects = countMatches(src, /\buseEffect\s*\(/g);
  const imports = countMatches(src, /^\s*import\s[^;]*;/gm);
  return { file, lines, jsxDepth, useEffects, imports };
}

// ─── PR-Q (아이디어 9 — GodFunctionGuard) ─────────────────────────────────
// 함수 단위 라인 수 + cyclomatic complexity 근사 추출.
// AST 파싱 대신 정규식 + 중괄호 깊이 추적으로 의존성 0 환경에서 동작.
//
// 인식 패턴 (함수 시작):
//   function name(...)             — 일반 함수
//   const name = (...) => {        — 화살표 함수 (중괄호 본문만)
//   const name = function(...)     — 함수 표현식
//   async function name(...)       — async 일반 함수
//   export (default) (async)? function name(...)
//
// 무시:
//   - 한 줄 표현식 화살표 (=> expr) — 본문 없음
//   - 객체 메소드 단축 표기 (name(...) {}) — 클래스 외 흔치 않음
//   - 중첩 함수 — 가장 바깥 함수만 카운트 (단순화)

function findFunctionRegions(src) {
  const lines = src.split('\n');
  const regions = [];
  // 함수 시작 패턴: 라인의 명시적 함수 선언만 (중첩 회피)
  const startRe = /^\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*[(<]/;
  const arrowStartRe = /^\s*(?:export\s+(?:default\s+)?)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=]+)?\s*=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{/;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let name = null;
    const m1 = line.match(startRe);
    const m2 = !m1 && line.match(arrowStartRe);
    if (m1) name = m1[1];
    else if (m2) name = m2[1];

    if (!name) { i += 1; continue; }

    // 본문 시작 라인 찾기 (이 라인 또는 이후 라인의 첫 `{`)
    let bodyStart = i;
    let openCount = (line.match(/\{/g) || []).length;
    let closeCount = (line.match(/\}/g) || []).length;
    while (openCount === 0 && bodyStart + 1 < lines.length) {
      bodyStart += 1;
      openCount += (lines[bodyStart].match(/\{/g) || []).length;
      closeCount += (lines[bodyStart].match(/\}/g) || []).length;
    }
    if (openCount === 0) { i += 1; continue; } // 본문 없음 (선언만)

    let depth = openCount - closeCount;
    let bodyEnd = bodyStart;
    // 함수 종료 ({ 깊이 0 도달) 추적
    while (depth > 0 && bodyEnd + 1 < lines.length) {
      bodyEnd += 1;
      const ln = lines[bodyEnd];
      // 문자열·정규식 안 중괄호 무시 — 단순화 위해 모든 { } 카운트 (근사)
      depth += (ln.match(/\{/g) || []).length;
      depth -= (ln.match(/\}/g) || []).length;
    }

    const body = lines.slice(i, bodyEnd + 1).join('\n');
    const lineCount = bodyEnd - i + 1;
    // cyclomatic 근사: 분기 키워드 카운트
    const branches = (body.match(/\b(if|else if|case|catch|while|for)\b/g) || []).length;
    const ternary = (body.match(/\?[^?]/g) || []).length; // 단순 ? 카운트
    const logical = (body.match(/&&|\|\|/g) || []).length;
    const complexity = 1 + branches + ternary + logical;

    regions.push({ name, startLine: i + 1, endLine: bodyEnd + 1, lineCount, complexity });
    i = bodyEnd + 1;
  }
  return regions;
}

function analyzeFunctions(file) {
  const src = readFileSync(file, 'utf-8');
  const fns = findFunctionRegions(src);
  const offenders = fns.filter(f =>
    f.lineCount > FUNCTION_LIMITS.lines || f.complexity > FUNCTION_LIMITS.cyclomaticComplexity);
  return { file, totalFunctions: fns.length, offenders };
}

function over(metric, value) {
  return value > LIMITS[metric];
}

function formatRow(r) {
  const mark = (k) => (over(k, r[k]) ? `${r[k]}!` : `${r[k]}`);
  return `  ${r.file}\n    lines=${mark('lines')}/${LIMITS.lines}  jsxDepth=${mark('jsxDepth')}/${LIMITS.jsxDepth}  useEffects=${mark('useEffects')}/${LIMITS.useEffects}  imports=${mark('imports')}/${LIMITS.imports}`;
}

function suggest(file) {
  try {
    execSync(`node scripts/refactor_suggester.js "${file}"`, { stdio: 'inherit' });
  } catch {
    // suggester 오류는 빌드 실패 원인이 되지 않도록 무시
  }
}

function main() {
  const args = process.argv.slice(2);
  const explicit = args.filter((a) => !a.startsWith('-'));

  // 기본 동작: 지정된 타겟을 검사하고, 동시에 src 전체에서 경고 수준으로 상위 오프렌더를 리포트한다.
  const targets = explicit.length > 0 ? explicit : DEFAULT_TARGETS;

  const failed = [];
  for (const t of targets) {
    if (!existsSync(t)) {
      console.log(`[ACMA] ${t} not found — skipping`);
      continue;
    }
    const r = analyze(t);
    const bad =
      over('lines', r.lines) ||
      over('jsxDepth', r.jsxDepth) ||
      over('useEffects', r.useEffects) ||
      over('imports', r.imports);
    console.log(formatRow(r));
    if (bad) failed.push(r);
  }

  // 정보성 상위 경고 (실패는 시키지 않음)
  if (explicit.length === 0 && existsSync('src')) {
    const all = walk('src').map(analyze);
    const worst = all
      .filter((r) => r.lines > LIMITS.lines || r.useEffects > LIMITS.useEffects)
      .sort((a, b) => b.lines - a.lines)
      .slice(0, 5);
    if (worst.length > 0) {
      console.log('\n[ACMA] 참고: 한계 초과 가능성이 있는 상위 파일 (경고)');
      for (const r of worst) console.log(formatRow(r));
    }
  }

  // ─── PR-Q (GodFunctionGuard): 함수 단위 임계 검사 ─────────────────────────
  // 변경 분 (--changed) 또는 `src/` + `server/` 전체 walk 후 임계 초과 함수 보고.
  // 기본은 warn (정보성), `FUNCTION_GUARD=strict` 면 빌드 실패.
  // PR-67 (5번 아이디어): `FUNCTION_GUARD_STRICT_SCOPE=path1,path2` — 콤마 구분 prefix
  //   디렉토리 안 offender 만 FAIL, 외부 디렉토리는 WARN 만 출력 (분해 영역 락-인).
  const guardMode = process.env.FUNCTION_GUARD ?? 'warn';
  const strictScopePrefixes = (process.env.FUNCTION_GUARD_STRICT_SCOPE ?? '')
    .split(',')
    .map(s => s.trim().replace(/^\.\//, '').replace(/\/+$/, ''))
    .filter(Boolean);
  const isInStrictScope = (file) => {
    if (strictScopePrefixes.length === 0) return false;
    const norm = relative(process.cwd(), file).replace(/^\.\//, '');
    return strictScopePrefixes.some(p => norm === p || norm.startsWith(`${p}/`));
  };
  const fnTargets = explicit.length > 0
    ? explicit.filter(t => existsSync(t))
    : [...walk('src'), ...(existsSync('server') ? walk('server') : [])];
  const fnReports = fnTargets.map(analyzeFunctions);
  const fnOffenders = fnReports
    .filter(r => r.offenders.length > 0)
    .flatMap(r => r.offenders.map(o => ({ ...o, file: r.file })));

  // strict scope 모드: 분해된 영역(in-scope) FAIL, 그 외(out-of-scope) WARN.
  // strict 모드 (scope 없음): 모든 offender FAIL.
  // warn 기본: 모든 offender WARN.
  const inScopeOffenders = fnOffenders.filter(o => isInStrictScope(o.file));
  const outOfScopeOffenders = fnOffenders.filter(o => !isInStrictScope(o.file));
  const scopeMode = strictScopePrefixes.length > 0;

  if (fnOffenders.length > 0) {
    if (scopeMode) {
      // in-scope (락-인 영역) — FAIL 출력
      if (inScopeOffenders.length > 0) {
        console.error(`\n[GodFunctionGuard][FAIL] strict-scope 영역 임계 초과 ${inScopeOffenders.length}건 — lines>${FUNCTION_LIMITS.lines} 또는 complexity>${FUNCTION_LIMITS.cyclomaticComplexity}`);
        console.error(`  scope: ${strictScopePrefixes.join(', ')}`);
        for (const o of inScopeOffenders.slice(0, 15)) {
          console.error(`  ${o.file}:${o.startLine}  ${o.name}()  lines=${o.lineCount}  cc=${o.complexity}`);
        }
        if (inScopeOffenders.length > 15) console.error(`  ... 외 ${inScopeOffenders.length - 15}건`);
        console.error('  해결: 분해된 영역의 깨끗한 상태 락-인 — 함수 추출 / 룩업 테이블 전환.');
      }
      // out-of-scope — WARN 만
      if (outOfScopeOffenders.length > 0) {
        console.warn(`\n[GodFunctionGuard][WARN] strict-scope 외부 임계 초과 ${outOfScopeOffenders.length}건 (정보성)`);
        for (const o of outOfScopeOffenders.slice(0, 5)) {
          console.warn(`  ${o.file}:${o.startLine}  ${o.name}()  lines=${o.lineCount}  cc=${o.complexity}`);
        }
        if (outOfScopeOffenders.length > 5) console.warn(`  ... 외 ${outOfScopeOffenders.length - 5}건 (보이스카우트 규칙으로 점진 청소)`);
      }
      if (inScopeOffenders.length > 0) {
        console.error('  FUNCTION_GUARD_STRICT_SCOPE 모드 — 커밋 차단');
        process.exit(1);
      } else {
        console.log(`[GodFunctionGuard] OK — strict-scope (${strictScopePrefixes.join(', ')}) 깨끗 (out-of-scope ${outOfScopeOffenders.length}건은 WARN 만)`);
      }
    } else {
      const label = guardMode === 'strict' ? '[GodFunctionGuard][FAIL]' : '[GodFunctionGuard][WARN]';
      console.error(`\n${label} 함수 단위 임계 초과 ${fnOffenders.length}건 — lines>${FUNCTION_LIMITS.lines} 또는 complexity>${FUNCTION_LIMITS.cyclomaticComplexity}`);
      for (const o of fnOffenders.slice(0, 15)) {
        console.error(`  ${o.file}:${o.startLine}  ${o.name}()  lines=${o.lineCount}  cc=${o.complexity}`);
      }
      if (fnOffenders.length > 15) console.error(`  ... 외 ${fnOffenders.length - 15}건`);
      console.error('  해결: 함수를 작은 단위로 분해 (early return / 추출) 또는 분기 매트릭스 → 룩업 테이블 전환.');
      if (guardMode === 'strict') {
        console.error('  FUNCTION_GUARD=strict 모드 — 커밋 차단');
        process.exit(1);
      }
    }
  } else if (fnTargets.length > 0) {
    console.log(`[GodFunctionGuard] OK — ${fnReports.reduce((s, r) => s + r.totalFunctions, 0)}개 함수 검사 (lines≤${FUNCTION_LIMITS.lines}, cc≤${FUNCTION_LIMITS.cyclomaticComplexity})`);
  }

  if (failed.length > 0) {
    console.error('\n[ACMA] 한계치 초과 — 커밋 차단');
    console.error('  해결: 파일을 페이지/섹션 단위로 분리하거나 커스텀 훅으로 effect를 추출하세요.');
    if (process.env.SUGGEST === '1') {
      for (const r of failed) {
        console.error(`\n[ACMA] ${r.file} 리팩토링 후보 분석:`);
        suggest(r.file);
      }
    } else {
      console.error('  SUGGEST=1 을 설정하면 refactor_suggester 가 자동 제안을 출력합니다.');
    }
    process.exit(1);
  }

  console.log('\n[ACMA] OK — 복잡도 한계 내');
}

main();
