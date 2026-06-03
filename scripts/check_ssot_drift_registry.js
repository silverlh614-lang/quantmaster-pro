#!/usr/bin/env node
/**
 * @responsibility SSOT drift-prevention 정적 가드 — 등재된 guarded 개념(8심볼)이 owner + LEGITIMATE
 *   allowed 외 신규 모듈에서 중복 정의/export 되면 커밋타임 차단(ADR-0560, grandfather, 런타임 0줄).
 *
 * 데이터 SSOT: docs/SSOT_REGISTRY.md §1(guarded 표) + §3.2(LEGITIMATE_PAIRS) + §3.4(에러 포맷).
 * 검증 모델: check_kis_official_endpoint_registry.js(registry 텍스트 검증) +
 *           check_ssot_single_funnel.js(allowlist/grandfather, checkFile/export 재사용).
 *
 * 탐지(D7/§3.3, false positive 최소화):
 *   - 라인 단위 정규식으로 *정의/선언* 만 본다: export (async) function|const|let|var|type|interface|
 *     class|enum <guarded> / export default (async) function <guarded> / re-export-with-source
 *     (export { <guarded> } from '...'). word boundary 정확 일치.
 *   - 주석 라인(// , * , /*) · `import` · `import type` · call site 제외.
 *   - bare `export { <guarded> };`(소스 없는 재export = owner 심볼의 위임 re-export)는 신규 정의가
 *     아니므로 제외 (trancheExecutor 의 addBusinessDaysFromKstDate 위임 re-export 오탐 방지).
 *   - 스캔 루트: server/ + src/ (.test.ts · .d.ts 제외).
 *   - guarded 심볼별 정의 모듈 집합이 {owner} ∪ allowed 의 부분집합이 아니면 초과 모듈을 신규 위반 보고.
 *
 * registry drift 주석(코드=SSOT 진실, ADR/registry 갱신 필요):
 *   - addWeekdaysApprox owner: registry §3.2 는 server/screener/businessDayApprox.ts 로 기재했으나
 *     실제 owner 는 server/persistence/businessDayApprox.ts (registry 경로 오기 — 코드 기준 사용).
 *   - MarketSession: src/services/autoTrading/ssotPipeline.ts 의 동명 projection 세션 타입(2값 union,
 *     server 정본은 4값)은 ADR-0560 D4/registry §1 row6 "파생 세션 = 건별 LEGITIMATE" 의 기존 코드
 *     실체다. grandfather 로 allowed 등재 (신규 동명 추가는 여전히 차단).
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

/**
 * GUARDED_SYMBOLS — docs/SSOT_REGISTRY.md §3.1. 메타 등재(#5 resolveExecutionPermission)는
 * "심볼 중복"이 아니라 불변식 #6 격리이므로 제외(별도 가드 위임).
 */
const GUARDED_SYMBOLS = [
  'isKrxHoliday',
  'addBusinessDaysFromKstDate',
  'addWeekdaysApprox',
  'collectUnifiedSnapshot',
  'UnifiedSourceSnapshot',
  'getOpenPositions',
  'loadOpenPositions',
  'MarketSession',
];

/**
 * LEGITIMATE_PAIRS — docs/SSOT_REGISTRY.md §3.2. (guarded) → { concept, owner, allowed[] }.
 * 경로는 ROOT 상대(POSIX). owner ∪ allowed 외 모듈 정의 = 신규 위반.
 */
const LEGITIMATE_PAIRS = new Map([
  [
    'isKrxHoliday',
    {
      concept: 'KRX 휴장일 판정 (데이터 SSOT)',
      owner: 'server/trading/krxHolidays.ts',
      // krxTradingCalendar 는 owner 값 위임 re-export (ADR-0559)
      allowed: ['server/calendar/krxTradingCalendar.ts'],
    },
  ],
  [
    'addBusinessDaysFromKstDate',
    {
      concept: '영업일 산술 (휴일 인식)',
      owner: 'server/trading/krxHolidays.ts',
      // 수렴 목표 (catalog #2 인라인은 burn-down) — bare re-export 는 탐지 제외이므로 allowed 불필요
      allowed: [],
    },
  ],
  [
    'addWeekdaysApprox',
    {
      concept: '영업일 근사 (주말만, UI 표시)',
      // registry drift: §3.2 는 server/screener/businessDayApprox.ts 라 적었으나 실제 owner 는 아래 경로.
      owner: 'server/persistence/businessDayApprox.ts',
      allowed: [],
    },
  ],
  [
    'collectUnifiedSnapshot',
    {
      concept: 'SourceSnapshot factory (정본 생성)',
      owner: 'server/trading/symbolDataCollector.ts',
      allowed: [],
    },
  ],
  [
    'UnifiedSourceSnapshot',
    {
      concept: 'SourceSnapshot 타입 (factory 정본 / projection 동명이인)',
      owner: 'server/trading/sourceSnapshot/unifiedSourceSnapshot.ts',
      // projection 동명이인 (ADR-0556, 의도된 분리)
      allowed: ['src/services/autoTrading/ssotPipeline.ts'],
    },
  ],
  [
    'getOpenPositions',
    {
      concept: '보유 포지션 조회 (엄격 5가드)',
      owner: 'server/persistence/shadowPositionLedger.ts',
      allowed: [],
    },
  ],
  [
    'loadOpenPositions',
    {
      concept: '보유 포지션 조회 (divergence 경량 2가드)',
      owner: 'server/persistence/positionTruth.ts',
      // getOpenPositions 와 짝 — 3번째 reader 금지
      allowed: [],
    },
  ],
  [
    'MarketSession',
    {
      concept: 'MarketSession 어휘 (canonical)',
      owner: 'server/ssotSnapshot.ts',
      // grandfather: ssotPipeline 의 동명 projection 세션 타입(2값). ADR-0560 D4 "파생 세션 건별
      // LEGITIMATE". 신규 동명 추가는 여전히 차단.
      allowed: ['src/services/autoTrading/ssotPipeline.ts'],
    },
  ],
]);

const SCAN_ROOTS = ['server', 'src'];

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * guarded 심볼의 *정의/선언* 라인인가? (call site·import·bare re-export 제외)
 *   - export (async) function|const|let|var|type|interface|class|enum <sym>
 *   - export default (async) function <sym>
 *   - re-export-with-source: export { ..., <sym>, ... } from '...'  (다른 모듈에서 가져와 노출)
 * bare `export { <sym> };`(from 없음)은 owner 심볼의 위임 re-export → 신규 정의 아님 → false 반환.
 */
function isDefinitionLine(line, symbol) {
  const s = escapeRegex(symbol);
  const declRe = new RegExp(
    `^\\s*export\\s+(?:default\\s+)?(?:async\\s+)?(?:function|const|let|var|type|interface|class|enum)\\s+${s}\\b`,
  );
  if (declRe.test(line)) return true;
  // re-export-with-source: export { ... <sym> ... } from '...'
  const reexportFromRe = new RegExp(
    `^\\s*export\\s*\\{[^}]*\\b${s}\\b[^}]*\\}\\s*from\\s*['"\`]`,
  );
  if (reexportFromRe.test(line)) return true;
  return false;
}

function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

/**
 * 단일 파일에서 guarded 심볼 정의 라인을 수집. 테스트 재사용 export.
 * @returns {{symbol:string, lineNo:number}[]}
 */
function checkFile(absPath, relPath) {
  const src = readFileSync(absPath, 'utf-8');
  const lines = src.split('\n');
  const hits = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (isCommentLine(line)) continue;
    for (const symbol of GUARDED_SYMBOLS) {
      // 빠른 사전 필터: 심볼명이 라인에 없으면 skip
      if (!line.includes(symbol)) continue;
      if (isDefinitionLine(line, symbol)) {
        hits.push({ symbol, lineNo: i + 1 });
      }
    }
  }
  return hits;
}

function walk(absDir, relDir, out) {
  if (!existsSync(absDir)) return;
  for (const name of readdirSync(absDir)) {
    const abs = join(absDir, name);
    const rel = relDir ? `${relDir}/${name}` : name;
    const st = statSync(abs);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      walk(abs, rel, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) {
      out.push({ abs, rel });
    }
  }
}

function main() {
  const files = [];
  for (const root of SCAN_ROOTS) {
    walk(join(ROOT, root), root, files);
  }

  // 심볼별 정의 모듈 집합 수집: Map<symbol, Map<relPath, lineNo>>
  const defsBySymbol = new Map();
  for (const symbol of GUARDED_SYMBOLS) defsBySymbol.set(symbol, new Map());
  for (const { abs, rel } of files) {
    for (const hit of checkFile(abs, rel)) {
      const norm = rel.split('\\').join('/');
      const map = defsBySymbol.get(hit.symbol);
      if (!map.has(norm)) map.set(norm, hit.lineNo);
    }
  }

  const violations = [];
  for (const symbol of GUARDED_SYMBOLS) {
    const pair = LEGITIMATE_PAIRS.get(symbol);
    if (!pair) continue;
    const allowedSet = new Set([pair.owner, ...pair.allowed]);
    for (const [relPath, lineNo] of defsBySymbol.get(symbol).entries()) {
      if (!allowedSet.has(relPath)) {
        violations.push({ symbol, concept: pair.concept, owner: pair.owner, relPath, lineNo });
      }
    }
  }

  if (violations.length > 0) {
    console.error('[SSOTDriftRegistry] [FAIL] 신규 동일개념 다중구현 (ADR-0560)');
    for (const v of violations) {
      console.error(
        `  개념 '${v.concept}' 은 이미 ${v.owner}:${v.symbol} 가 SSOT 입니다. 신규 구현 금지.\n` +
          `    위반 → ${v.relPath}:${v.lineNo}  export '${v.symbol}'\n` +
          `    해결: (a) ${v.owner} 로 위임/re-export 하거나\n` +
          `          (b) 정당한 분리면 docs/SSOT_REGISTRY.md 에 LEGITIMATE 예외 등재 (ADR 동반).`,
      );
    }
    console.error(`  위반 모듈: ${violations.map((v) => v.relPath).join(', ')}`);
    process.exit(1);
  }

  const grandfathered = [];
  for (const symbol of GUARDED_SYMBOLS) {
    const pair = LEGITIMATE_PAIRS.get(symbol);
    for (const relPath of defsBySymbol.get(symbol).keys()) {
      if (relPath !== pair.owner) grandfathered.push(`${symbol}@${relPath}`);
    }
  }
  console.log(
    `[SSOTDriftRegistry] [OK] — ${files.length}개 파일 검사, ${GUARDED_SYMBOLS.length}개 guarded 심볼, ` +
      `신규 위반 0건 (grandfather allowed ${grandfathered.length}건: ${grandfathered.join(', ') || '없음'}).`,
  );
}

export { checkFile, GUARDED_SYMBOLS, LEGITIMATE_PAIRS, isDefinitionLine };

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
