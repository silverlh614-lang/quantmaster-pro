#!/usr/bin/env node
/**
 * check_ui_language.js — ADR-0094 UI Language SSOT 게이트키퍼
 *
 * 사용자 명시 정책 — 페르소나 철학 ("Data-driven, no emotion") 위반 표현 영구 차단.
 * src/ 의 string literal / template literal 안에 금지 표현이 등장하면 빌드 실패.
 *
 * 금지 표현 4 카테고리:
 *   1. 절대 표현: 완벽한 / 강력한 / 확실한 / 보장 / 확실히 / 최고의 / 베스트
 *   2. 출처 모호: AI 가 분석한 / AI 추천 / AI가 분석
 *   3. 감정 표현: 놀라운 / 엄청난 / 대박 / 가장 좋은
 *   4. 약속 표현: 반드시 / 무조건 / 승률 100%
 *
 * 화이트리스트 (정책 정의/문서/테스트는 검출 제외):
 *   - src/config/uiLanguage.ts (정책 SSOT 자기 자신)
 *   - src/config/uiLanguage.test.ts (회귀 테스트)
 *   - src/__tests__/uiLanguagePhaseA-DoD.test.ts (DoD 회귀)
 *   - scripts/check_ui_language.js (시그니처 정의)
 *   - scripts/check_ui_language.test.js (자체 회귀)
 *   - docs/adr/ (정책 문서 자기 인용)
 *   - *.test.ts / *.test.tsx (회귀 시나리오)
 *
 * 매칭 규칙:
 *   - 한국어 표현은 string/template/single-quote literal 안에서만 매칭
 *   - 식별자/주석 등장은 허용 (false positive 차단)
 *   - 한 줄 주석 (//) + 블록 주석 (/* ... *\/) strip 후 검사
 *   - console.* 인자 안 표현은 차단 *대상* (UI 라벨일 수 있음 — JSX/text 등 구분 어렵지만
 *     본 PR scope 에서는 src/ 전체 일괄 검사)
 *
 * ENV 무관 — 정적 검증이라 항상 실행.
 *
 * 사용:
 *   node scripts/check_ui_language.js
 *   node scripts/check_ui_language.js --changed
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { execSync } from 'child_process';

const ROOTS = ['src'];
const EXTS = new Set(['.ts', '.tsx']);
const IGNORED_SUFFIX = ['.d.ts'];

// 정책 정의/UI/문서 — 본 시그니처가 "정상적으로 등장" 가능한 파일
const ALLOWED_FILES = [
  'src/config/uiLanguage.ts',
  'src/config/uiLanguage.test.ts',
  'src/__tests__/uiLanguagePhaseA-DoD.test.ts',
  'scripts/check_ui_language.js',
  'scripts/check_ui_language.test.js',
];

/**
 * BASELINE_TECHNICAL_DEBT — Phase A 도입 시점의 *기존* 위반 파일.
 *
 * 본 14 파일은 ADR-0094 도입 *전* 부터 한국어 UI 라벨을 인라인으로 보유. 본 PR 의 scope
 * 는 *Phase A SSOT 신설 + 회귀 가드* — 마이그레이션은 후속 PR (각 파일 별도) 에서 점진
 * 청소. 후속 PR 이 한 파일을 useUILang() 으로 마이그레이션 후 본 카탈로그에서 *제거* 하면
 * 회귀 가드가 자동 강화 (해당 파일에 한국어 금지 표현 재발 시 자동 fail).
 *
 * `precommit` 의 `--changed` 모드는 본 카탈로그와 무관 — staged 신규 파일만 검사하므로
 * baseline 부채는 영향 없음. `validate:all` 의 full 모드는 본 카탈로그를 통과하므로
 * 운영자가 이미 인지된 부채에 대해 추가 알림 받지 않음. 미카탈로그 파일에서 신규 위반이
 * 발생하면 즉시 fail.
 *
 * 마이그레이션 우선순위 (ADR-0094 후속 PR):
 *   1. src/services/stock/momentumRecommendations.ts (5건 — 가장 큰 부채)
 *   2. src/services/quant/bearSimulatorEngine.ts (1건)
 *   3. src/services/quant/bearScreenerEngine.ts
 *   4. src/components/* (UI 직접 노출 — 사용자 인지 우선)
 *   5. 나머지 helper / constants
 */
const BASELINE_TECHNICAL_DEBT = [
  'src/components/common/KeyboardShortcutsModal.tsx',
  'src/components/common/RecommendationWarningsBanner.tsx',
  'src/components/macro/constants.ts',
  'src/components/trading/TradeJournal.tsx',
  'src/config/navigation.ts',
  'src/constants/checklist.ts',
  'src/hooks/useStockSearch.ts',
  'src/pages/PortfolioExtractPage.tsx',
  'src/services/autoTrading.slippageEngine.test.ts',
  'src/services/quant/bearScreenerEngine.ts',
  'src/services/quant/bearSimulatorEngine.ts',
  'src/services/stock/momentumRecommendations.ts',
  'src/services/stock/quantScreener.ts',
  'src/services/stock/stockSearch.ts',
];

// 금지 표현 카탈로그 — 카테고리별 분류 (보고 메시지에 사용)
//
// 매칭 패턴은 한국어 음절을 정확히 잡는 정규식. 어미 변화 (-한/하는/하다/했다/했음 등) 도 흡수.
// 예: "완벽한" / "완벽하게" / "완벽" 단독은 카테고리에 따라 차이.
const FORBIDDEN_PATTERNS = [
  // 1. 절대 표현
  { category: 'ABSOLUTE', term: '완벽한', regex: /완벽한/g },
  { category: 'ABSOLUTE', term: '완벽하게', regex: /완벽하게/g },
  { category: 'ABSOLUTE', term: '강력한', regex: /강력한/g },
  { category: 'ABSOLUTE', term: '강력하게', regex: /강력하게/g },
  { category: 'ABSOLUTE', term: '확실한', regex: /확실한/g },
  { category: 'ABSOLUTE', term: '확실히', regex: /확실히/g },
  { category: 'ABSOLUTE', term: '보장', regex: /보장(?:한다|함|됩니다|됨|드립니다)/g },
  { category: 'ABSOLUTE', term: '최고의', regex: /최고의/g },
  { category: 'ABSOLUTE', term: '베스트', regex: /베스트/g },

  // 2. 출처 모호 — AI 추천/분석 직접 표현
  { category: 'AMBIGUOUS_SOURCE', term: 'AI 가 분석', regex: /AI\s*가\s*분석/g },
  { category: 'AMBIGUOUS_SOURCE', term: 'AI가 분석', regex: /AI가\s*분석/g },
  { category: 'AMBIGUOUS_SOURCE', term: 'AI 추천', regex: /AI\s*추천/g },
  { category: 'AMBIGUOUS_SOURCE', term: 'AI가 추천', regex: /AI가\s*추천/g },

  // 3. 감정 표현
  { category: 'EMOTIONAL', term: '놀라운', regex: /놀라운/g },
  { category: 'EMOTIONAL', term: '엄청난', regex: /엄청난/g },
  { category: 'EMOTIONAL', term: '대박', regex: /대박/g },
  { category: 'EMOTIONAL', term: '가장 좋은', regex: /가장\s*좋은/g },

  // 4. 약속 표현
  { category: 'PROMISE', term: '반드시', regex: /반드시/g },
  { category: 'PROMISE', term: '무조건', regex: /무조건/g },
  { category: 'PROMISE', term: '승률 100%', regex: /승률\s*100\s*%/g },
];

const CATEGORY_LABEL = {
  ABSOLUTE: '절대 표현 (확률 사고 위반)',
  AMBIGUOUS_SOURCE: '출처 모호 (tier.ESTIMATED 사용 권장)',
  EMOTIONAL: '감정 표현 (Data-driven 위반)',
  PROMISE: '약속 표현 (금융 표현 위험)',
};

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (EXTS.has(extname(p)) && !IGNORED_SUFFIX.some((suf) => p.endsWith(suf))) out.push(p);
  }
  return out;
}

function changedFiles() {
  try {
    const out = execSync('git diff --cached --name-only --diff-filter=ACMR', { encoding: 'utf-8' });
    return out
      .split('\n')
      .filter((n) => n && EXTS.has(extname(n)) && !IGNORED_SUFFIX.some((suf) => n.endsWith(suf)));
  } catch {
    return [];
  }
}

function isAllowed(file) {
  // 정규화: leading ./ 제거
  const norm = file.replace(/^\.\//, '');
  if (ALLOWED_FILES.some((allow) => norm === allow || norm.endsWith('/' + allow))) return true;
  if (BASELINE_TECHNICAL_DEBT.some((debt) => norm === debt || norm.endsWith('/' + debt))) return true;
  return false;
}

/**
 * 라인에서 주석 영역 제거 (정확한 lexer 가 아닌 안전한 휴리스틱).
 * - 한 줄 주석: `//` 이후 무시. 단, 문자열/정규식 안의 `//` 는 보존.
 * - 블록 주석: 외부 in_block flag 로 추적.
 *
 * 안전 정책: 의심스러운 경우 *코드로 간주* (false negative 보다 false positive 차단 우선).
 * 본 검증은 정책 SSOT 차단이므로 주석으로 우회 불가능해야 한다.
 */
function stripCommentsLine(line, state) {
  let out = '';
  let i = 0;
  let inString = null; // ' " or ` (문자열 내부)

  while (i < line.length) {
    const ch = line[i];
    const next = line[i + 1];

    if (state.inBlock) {
      // 블록 주석 종료 탐색
      if (ch === '*' && next === '/') {
        state.inBlock = false;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    if (inString) {
      out += ch;
      if (ch === '\\' && i + 1 < line.length) {
        // escape: 다음 문자도 그대로
        out += next;
        i += 2;
        continue;
      }
      if (ch === inString) {
        inString = null;
      }
      i += 1;
      continue;
    }

    // 문자열 시작
    if (ch === "'" || ch === '"' || ch === '`') {
      inString = ch;
      out += ch;
      i += 1;
      continue;
    }

    // 블록 주석 시작
    if (ch === '/' && next === '*') {
      state.inBlock = true;
      i += 2;
      continue;
    }
    // 라인 주석 시작
    if (ch === '/' && next === '/') {
      break; // 라인 끝까지 무시
    }

    out += ch;
    i += 1;
  }
  return out;
}

/**
 * 라인에서 string/template literal 영역만 추출.
 * 식별자/주석 등장은 무시 — UI 라벨은 항상 literal 안에 존재.
 */
function extractLiteralRegions(line) {
  const regions = [];
  let i = 0;
  let inString = null;
  let start = -1;

  while (i < line.length) {
    const ch = line[i];

    if (inString) {
      if (ch === '\\' && i + 1 < line.length) {
        i += 2;
        continue;
      }
      if (ch === inString) {
        regions.push({ start: start + 1, end: i, text: line.slice(start + 1, i) });
        inString = null;
        start = -1;
      }
      i += 1;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      inString = ch;
      start = i;
    }
    i += 1;
  }
  return regions;
}

/** 파일 내용에서 시그니처 매치 — line 번호 + matched text + 카테고리. */
function findViolations(filePath, content) {
  const violations = [];
  const lines = content.split('\n');
  const state = { inBlock: false };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const codeLine = stripCommentsLine(rawLine, state);
    const regions = extractLiteralRegions(codeLine);

    for (const region of regions) {
      for (const { category, term, regex } of FORBIDDEN_PATTERNS) {
        regex.lastIndex = 0;
        let m;
        while ((m = regex.exec(region.text)) !== null) {
          violations.push({
            file: filePath,
            line: i + 1,
            column: region.start + m.index + 1,
            match: m[0],
            term,
            category,
          });
        }
      }
    }
  }
  return violations;
}

function main() {
  const argv = process.argv.slice(2);
  const useChanged = argv.includes('--changed');

  let files;
  if (useChanged) {
    files = changedFiles();
    if (files.length === 0) {
      console.log('[UILanguage] --changed 모드: 변경된 파일 없음 — skip');
      return 0;
    }
  } else {
    files = ROOTS.flatMap((root) => walk(root));
  }

  let totalViolations = 0;
  const violationsByFile = new Map();

  for (const file of files) {
    if (isAllowed(file)) continue;
    if (!existsSync(file)) continue;

    let content;
    try {
      content = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    const v = findViolations(file, content);
    if (v.length > 0) {
      violationsByFile.set(file, v);
      totalViolations += v.length;
    }
  }

  if (totalViolations === 0) {
    console.log(`[UILanguage] ✅ 검사 ${files.length} 파일 — 위반 0건`);
    return 0;
  }

  console.error(`[UILanguage] ❌ 위반 ${totalViolations}건 (${violationsByFile.size} 파일)\n`);
  console.error('ADR-0094 — UI Language SSOT 게이트키퍼');
  console.error('  src/ 의 string/template literal 에 금지 표현이 등장하면 차단.');
  console.error('  페르소나 철학 ("Data-driven, no emotion") 위반 표현 영구 차단.\n');

  for (const [file, vs] of violationsByFile.entries()) {
    console.error(`  ${file}:`);
    for (const v of vs) {
      console.error(`    L${v.line}:${v.column} [${v.category}] "${v.match}" — ${CATEGORY_LABEL[v.category]}`);
    }
  }
  console.error('');
  console.error('해결:');
  console.error('  - 절대 표현 → 확률 표현으로 교체 (예: "완벽한 신호" → "고확신 신호")');
  console.error('  - AI 추천 표기 → tier.ESTIMATED 라벨 사용 (UI_LANG.tier.ESTIMATED = "AI 추정")');
  console.error('  - 감정 표현 → 정량 표현 (예: "엄청난 수익" → "수익률 +N%")');
  console.error('  - 약속 표현 → 확률 표현 (예: "반드시 매수" → "강매수 후보")');
  console.error('  정책 정의/UI/테스트 파일은 ALLOWED_FILES 화이트리스트 갱신.');
  return 1;
}

const code = main();
process.exit(code);
