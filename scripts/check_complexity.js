/**
 * check_complexity.js  —  ACMA (App.tsx Cyclomatic Meltdown Alarm)
 *
 * 한계치를 넘는 대형 컴포넌트 파일을 pre-commit 단계에서 차단한다.
 * 측정 항목:
 *   - 라인 수 (공백/주석 포함 원문 기준)
 *   - JSX 최대 중첩 깊이 (단순 토큰 카운팅)
 *   - useEffect 호출 개수
 *   - import 선언 개수
 *
 * "코드가 길어지는 것보다 결합도가 높아지는 것이 더 위험하다."
 * — SRP 즉각적 파산을 기계적으로 막기 위한 스크립트.
 *
 * 사용:
 *   node scripts/check_complexity.js                 # 기본 타겟(App.tsx + 상위 경고)
 *   node scripts/check_complexity.js path/to.tsx ... # 경로 직접 지정
 *   SUGGEST=1 node scripts/check_complexity.js       # 초과 시 refactor-suggester 호출
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
