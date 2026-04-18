/**
 * scan_exposure.js  —  PRES (Public Repo Exposure Scanner)
 *
 * 퍼블릭 레포 × KIS API 조합은 계좌 탈취급 위협이다.
 * 매 빌드/푸시 시 다음을 차단한다:
 *   1) 작업 트리에 존재해서는 안 되는 파일 (grep_output.txt, .env*, debug_*.txt 등)
 *   2) 스테이징/트래킹된 파일 본문의 API 키 패턴
 *   3) 주석과 README 내부의 앱 URL/키 패턴
 *   4) git history 전체에서 민감 파일이 과거에 커밋된 적이 있는지 (history wipe 안내)
 *
 * 사용:
 *   node scripts/scan_exposure.js             # 현재 작업 트리 + 히스토리 검사
 *   node scripts/scan_exposure.js --no-history
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, basename, extname } from 'path';
import { execSync } from 'child_process';

const FORBIDDEN_FILES = [
  /^grep_output\.txt$/,
  /^debug_.*\.(txt|log)$/,
  /^.*\.debug\.(txt|log)$/,
  /^\.env($|\..*)/,
];
const FORBIDDEN_FILES_ALLOW = [/^\.env\.example$/];

const SECRET_PATTERNS = [
  { name: 'Google API key',       re: /AIza[0-9A-Za-z_\-]{35}/ },
  { name: 'AWS access key',       re: /AKIA[0-9A-Z]{16}/ },
  { name: 'Slack token',          re: /xox[baprs]-[0-9A-Za-z-]{10,}/ },
  { name: 'OpenAI key',           re: /sk-[A-Za-z0-9]{32,}/ },
  { name: 'Anthropic key',        re: /sk-ant-[A-Za-z0-9_\-]{20,}/ },
  { name: 'Generic long hex secret', re: /(?:secret|token|apikey|api_key|password)\s*[:=]\s*['"][A-Za-z0-9+/=_\-]{32,}['"]/i },
  { name: 'KIS appkey',           re: /(?:appkey|appsecret|app_key|app_secret)\s*[:=]\s*['"][A-Za-z0-9]{20,}['"]/i },
];

const APP_URL_PATTERNS = [
  { name: 'Railway app URL',  re: /[a-z0-9-]+\.up\.railway\.app/i },
  { name: 'Vercel app URL',   re: /[a-z0-9-]+\.vercel\.app/i },
  { name: 'ngrok URL',        re: /[a-z0-9-]+\.ngrok(-free)?\.(app|io)/i },
];

const TEXT_EXTS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.md', '.txt', '.yml', '.yaml', '.html', '.css']);

const SCRIPT_FILE = 'scripts/scan_exposure.js';

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'build' || name === '.git') continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function isForbiddenFilename(relPath) {
  const base = basename(relPath);
  if (FORBIDDEN_FILES_ALLOW.some((re) => re.test(base))) return false;
  return FORBIDDEN_FILES.some((re) => re.test(base));
}

function scanContent(file) {
  if (!TEXT_EXTS.has(extname(file))) return [];
  let src;
  try { src = readFileSync(file, 'utf-8'); } catch { return []; }
  // PRES 자체 파일(패턴 상수를 포함)은 본문 스캔에서 제외
  if (file === SCRIPT_FILE || file.endsWith('/scan_exposure.js')) return [];
  const hits = [];
  for (const { name, re } of [...SECRET_PATTERNS, ...APP_URL_PATTERNS]) {
    const m = src.match(re);
    if (m) {
      const idx = src.indexOf(m[0]);
      const line = src.slice(0, idx).split('\n').length;
      hits.push({ file, line, name, sample: m[0].slice(0, 12) + '…' });
    }
  }
  return hits;
}

function gitTrackedFiles() {
  try {
    return execSync('git ls-files', { encoding: 'utf-8' }).split('\n').filter(Boolean);
  } catch {
    return null;
  }
}

function historyCheck() {
  try {
    const raw = execSync("git log --all --pretty=format: --name-only --diff-filter=A", { encoding: 'utf-8' });
    const names = new Set(raw.split('\n').map((s) => s.trim()).filter(Boolean));
    const offenders = [];
    for (const n of names) {
      if (isForbiddenFilename(n)) offenders.push(n);
    }
    return offenders;
  } catch {
    return [];
  }
}

function main() {
  const args = process.argv.slice(2);
  const skipHistory = args.includes('--no-history');

  const tracked = gitTrackedFiles();
  const files = tracked || walk('.').map((p) => p.replace(/^\.\//, ''));

  const fsViolations = [];
  const contentHits = [];

  for (const f of files) {
    if (!existsSync(f)) continue;
    if (isForbiddenFilename(f)) fsViolations.push(f);
    contentHits.push(...scanContent(f));
  }

  let failed = false;

  if (fsViolations.length > 0) {
    console.error(`[PRES] 금지된 파일이 트래킹/워킹트리에 존재: ${fsViolations.length}건`);
    for (const f of fsViolations) console.error(`  - ${f}`);
    console.error('  해결: 파일을 삭제하고 .gitignore 에 추가하세요.');
    failed = true;
  }

  if (contentHits.length > 0) {
    console.error(`\n[PRES] 비밀정보/앱 URL 유출 의심 ${contentHits.length}건`);
    for (const h of contentHits.slice(0, 50)) {
      console.error(`  ${h.file}:${h.line}  ${h.name}  (샘플: ${h.sample})`);
    }
    if (contentHits.length > 50) console.error(`  ... 외 ${contentHits.length - 50}건`);
    failed = true;
  }

  if (!skipHistory) {
    const historic = historyCheck();
    if (historic.length > 0) {
      console.error(`\n[PRES] 과거 커밋에 금지 파일이 포함된 적 있음 ${historic.length}건`);
      for (const n of historic) console.error(`  - ${n}`);
      console.error('  해결: git filter-repo 혹은 BFG 로 히스토리 정리, 그리고 연관 키는 전부 재발급하세요.');
      // 히스토리 오염은 즉시 실패로 처리
      failed = true;
    }
  }

  if (failed) process.exit(1);
  console.log('[PRES] OK — 유출 흔적 없음');
}

main();
