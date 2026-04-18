/**
 * refactor_suggester.js
 *
 * 거대 컴포넌트를 받아 "분리 가능한 페이지/섹션 컴포넌트" 후보를 제안한다.
 * 정적 휴리스틱으로만 동작:
 *   1) 파일에서 정의된 함수형 하위 컴포넌트(대문자 시작)를 수집
 *   2) JSX 안에서 최상위 Route/Tab/Page 처럼 쓰이는 블록을 탐지
 *   3) useEffect 를 도메인 키워드 기준으로 그룹화
 *
 * 사용:
 *   node scripts/refactor_suggester.js src/App.tsx
 */

import { readFileSync, existsSync } from 'fs';

const file = process.argv[2];
if (!file || !existsSync(file)) {
  console.error('usage: node scripts/refactor_suggester.js <file>');
  process.exit(2);
}

const src = readFileSync(file, 'utf-8');

function uniq(arr) {
  return Array.from(new Set(arr));
}

function findSubComponents() {
  const re = /(?:function|const)\s+([A-Z][A-Za-z0-9_]+)\s*[=(:]/g;
  const found = [];
  let m;
  while ((m = re.exec(src)) !== null) found.push(m[1]);
  return uniq(found);
}

function findRouteLike() {
  // <Route ... component|element> 와 <TabsContent value="..."> 와 같은 큰 블록
  const patterns = [
    /<Route\b[^>]*\bpath=["'`]([^"'`]+)["'`]/g,
    /<TabsContent\b[^>]*\bvalue=["'`]([^"'`]+)["'`]/g,
    /case\s+["'`]([A-Za-z0-9_-]+)["'`]\s*:\s*return\s*</g,
  ];
  const out = [];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(src)) !== null) out.push(m[1]);
  }
  return uniq(out);
}

function groupEffectsByDomain() {
  const effectRe = /useEffect\s*\(\s*\(\)\s*=>\s*\{([\s\S]*?)\n\s*\}\s*,\s*\[[^\]]*\]\s*\)/g;
  const domains = new Map();
  const keywords = [
    ['auth', /auth|login|token|session/i],
    ['market', /market|ticker|quote|price/i],
    ['portfolio', /portfolio|position|holding/i],
    ['chart', /chart|candle|indicator/i],
    ['watchlist', /watchlist|favorite/i],
    ['theme', /theme|dark|light|color/i],
    ['modal', /modal|dialog|popup/i],
  ];
  let m;
  while ((m = effectRe.exec(src)) !== null) {
    const body = m[1];
    let bucket = 'misc';
    for (const [name, re] of keywords) if (re.test(body)) { bucket = name; break; }
    if (!domains.has(bucket)) domains.set(bucket, 0);
    domains.set(bucket, domains.get(bucket) + 1);
  }
  return domains;
}

function top(list, n) {
  return list.slice(0, n);
}

const subs = findSubComponents();
const routes = findRouteLike();
const domains = groupEffectsByDomain();

console.log(`\n[refactor] target: ${file}`);
console.log(`\n[refactor] 1. 분리 후보 상위 하위 컴포넌트 (대문자 심볼):`);
for (const s of top(subs, 8)) console.log(`   - ${s}`);

console.log(`\n[refactor] 2. Route/Tab/case 기반 페이지 후보 (상위 3):`);
for (const r of top(routes, 3)) console.log(`   - ${r} → pages/${r.replace(/[^A-Za-z0-9]/g, '')}Page.tsx 로 추출 검토`);

console.log(`\n[refactor] 3. useEffect 도메인 그룹 (커스텀 훅 후보):`);
for (const [name, count] of domains) {
  if (count >= 2) console.log(`   - use${name[0].toUpperCase()}${name.slice(1)}Effects()  (${count}개의 effect)`);
}

console.log('\n[refactor] 출력은 제안일 뿐입니다 — 실제 분리는 의존성 확인 후 수동 진행하세요.');
