/**
 * check_decision_log_correlation.js  —  ADR-0528 §Decision.4 decision-log correlation guard.
 *
 * 규칙: 핵심 결정 로그(분류표 a1~a8)는 구조화 헬퍼(logDecisionEvent/formatDecisionLog) 또는
 *       상관 필드(sourceSnapshotId/decisionStage/symbol)를 carry 해야 한다. 누락 시 "디버그
 *       재료"로 회귀하므로 fail. 부수 로그(분류표 b: retry/scheduler/provider-health/noise)는
 *       파일 화이트리스트 + stage 패턴 교집합으로 오탐을 차단한다.
 *
 *       R1 헬퍼/상관 경유: TARGET_FILES 내 DECISION_STAGE 패턴 라인이 logDecisionEvent 경유거나
 *           sourceSnapshotId/decisionStage 를 같은 라인(또는 가까운 윈도우)에 stamp 하지 않으면 fail.
 *       R2 필수 상관 필드: 매칭 결정 로그에 sourceSnapshotId= / decisionStage= / symbol= 3종 present.
 *       R3 5-event 체인 정합: SHADOW_LIFECYCLE_CHAIN 5단계 태그가 소스에 모두 emit 되는지(정적 grep).
 *       R4 proxy snapshotId 금지: a2 position 로그에서 sourceSnapshotId= 값이 buyList:/signalId/tradeId
 *           proxy 면 fail (진짜 sourceSnapshotId carry 강제).
 *
 *       인라인 예외: `/* DECISION-LOG-IGNORE: <사유> *​/` 주석으로 라인 단위 제외(빈 사유 시 fail).
 *       위반 발견 시 EXIT 1 + 파일:라인 출력. 위반 0 이면 EXIT 0.
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

/** 검사 대상 — decision-log-points.md (a) 파일 화이트리스트. 밖은 애초에 검사 안 함(b 자동 제외). */
const TARGET_FILES = [
  'server/trading/signalScanner/perSymbol/steps/sizingTierDecider.ts',
  'server/trading/sizing/regimePositionPolicy.ts',
  'server/runtime/executionPermissionResolver.ts',
  'server/trading/buy/shadowBuyExecutor.ts',
  'server/trading/orderPipelineSsot.ts',
];

/**
 * DECISION_STAGE 패턴 — TARGET_FILES 내에서 이 패턴을 emit 하는 결정 로그 라인만 강제 대상.
 * 매칭 안 되는 라인(retry/diag 등)은 결정 로그가 아니므로 검사 제외(오탐 방지 3중 방어의 3번).
 */
const DECISION_STAGE_PATTERNS = [
  { re: /\[SHADOW_EXECUTION_START\]/, label: 'SHADOW_EXECUTION_START', chain: true },
  { re: /\[SHADOW_ORDER_CREATED\]/, label: 'SHADOW_ORDER_CREATED', chain: true },
  { re: /\[SHADOW_PAPER_FILLED\]/, label: 'SHADOW_PAPER_FILLED', chain: true },
  { re: /\[SHADOW_POSITION_OPENED\]/, label: 'SHADOW_POSITION_OPENED', chain: true },
  { re: /\[PAPER_TRADE_LEDGER_RECORDED\]/, label: 'PAPER_TRADE_LEDGER_RECORDED', chain: true },
  { re: /\[POSITION_POLICY_SIMPLE_APPLIED\]/, label: 'POSITION_POLICY_SIMPLE_APPLIED', position: true },
  { re: /simple position policy/, label: 'simple position policy' },
  { re: /\[DECISION\]/, label: 'DECISION (helper line)' },
  { re: /formatExecutionPermissionLog/, label: 'EXECUTION_PERMISSION', isFunctionDef: true },
];

/** 5-event 체인 태그(R3 정합 검사). decisionLogCorrelation.SHADOW_LIFECYCLE_CHAIN 과 1:1. */
const SHADOW_LIFECYCLE_TAGS = [
  '[SHADOW_EXECUTION_START]',
  '[SHADOW_ORDER_CREATED]',
  '[SHADOW_PAPER_FILLED]',
  '[SHADOW_POSITION_OPENED]',
  '[PAPER_TRADE_LEDGER_RECORDED]',
];

/** R4: sourceSnapshotId 자리에 들어오면 안 되는 proxy 토큰. */
const PROXY_TOKENS = [/sourceSnapshotId=`?buyList:/, /sourceSnapshotId=`?signalId/, /sourceSnapshotId=`?tradeId/];

const IGNORE_RE = /\/\*\s*DECISION-LOG-IGNORE:\s*(.*?)\s*\*\//;

function isCommentLine(trimmed) {
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

/**
 * 상관 필드 토큰 detector. 라인 형식(`key=value`)·객체 속성(`key:`)·헬퍼 kv(`kv('key'`)·
 * 헬퍼 인자(`key:` in correlation obj) 모두 인식 → 다양한 직렬화 형태에서 오탐 방지.
 */
function fieldTokenRe(field) {
  return new RegExp(`(?:\\b${field}\\s*[=:])|(?:kv\\(\\s*['\"\`]${field}['\"\`])|(?:['\"\`]${field}['\"\`]\\s*,)`);
}
const SOURCE_RE = fieldTokenRe('sourceSnapshotId');
const STAGE_RE = fieldTokenRe('decisionStage');
const SYMBOL_RE = fieldTokenRe('symbol');

/**
 * 결정 로그 라인이 속한 "로그 블록"의 경계를 잡는다(오탐 방지: 이웃 formatter 토큰 누출 차단).
 * 위로는 직전 빈 줄/블록 종결자(`].join`/`});`/`return`)·아래로는 다음 블록 종결자까지를 블록으로 본다.
 * console.log/logDecisionEvent/return [ ... ] 한 호출 단위로 묶는다.
 */
function blockBounds(lines, idx) {
  let start = idx;
  for (let i = idx - 1; i >= 0 && idx - i <= 28; i -= 1) {
    const t = lines[i].trim();
    start = i;
    // 이전 호출/문장의 종결 → 블록 경계.
    if (/(\]\.join\(|\}\);|;\s*$|^\s*$)/.test(lines[i]) && i !== idx) {
      start = i + 1;
      break;
    }
    if (/(console\.(log|info|warn|error)\s*\(|logDecisionEvent\s*\(|return\s*\[)/.test(lines[i])) break;
  }
  let end = idx;
  for (let i = idx; i < lines.length && i - idx <= 28; i += 1) {
    end = i;
    if (/(\]\.join\(|\}\);|;\s*$)/.test(lines[i]) && i !== idx) break;
  }
  return { start, end };
}

/** 블록 범위 내에서 토큰 존재 여부 검사. funcDef 면 정의부 본문(return 블록)까지 넓게 스캔. */
function hasTokenNearby(lines, idx, tokenRe, funcDef) {
  let start;
  let end;
  if (funcDef) {
    start = idx;
    end = Math.min(lines.length - 1, idx + 35);
  } else {
    ({ start, end } = blockBounds(lines, idx));
  }
  for (let i = start; i <= end; i += 1) {
    if (tokenRe.test(lines[i])) return true;
  }
  return false;
}

/** 소스 문자열 단위 검사(테스트 진입점). 파일시스템 비의존 — 라인 휴리스틱 검증용. */
export function checkSource(src, relPath = '(memory)') {
  const lines = src.split('\n');
  const violations = [];
  const tagsFound = new Set();

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (isCommentLine(trimmed)) continue;

    for (const pat of DECISION_STAGE_PATTERNS) {
      if (!pat.re.test(line)) continue;
      if (pat.chain) tagsFound.add(pat.label);

      // 인라인 예외 — 사유 필수(빈 사유 시 silent skip 차단 → fail).
      const ignore = IGNORE_RE.exec(line) || (i + 1 < lines.length ? IGNORE_RE.exec(lines[i + 1]) : null);
      if (ignore) {
        if (!ignore[1] || ignore[1].length === 0) {
          violations.push({ relPath, lineNo: i + 1, rule: 'R0', reason: 'DECISION-LOG-IGNORE 사유 누락(빈 사유 금지)', line: trimmed });
        }
        continue;
      }

      const fd = pat.isFunctionDef === true;
      // R1: 헬퍼 경유 또는 decisionStage stamp.
      const viaHelper = hasTokenNearby(lines, i, /logDecisionEvent\s*\(/, fd)
        || /\[DECISION\]/.test(line);
      const hasStage = hasTokenNearby(lines, i, STAGE_RE, fd);
      if (!viaHelper && !hasStage) {
        violations.push({ relPath, lineNo: i + 1, rule: 'R1', reason: '헬퍼(logDecisionEvent) 미경유 + decisionStage 미stamp', line: trimmed });
        continue;
      }

      // R2: 필수 상관 필드(sourceSnapshotId / decisionStage / symbol) present.
      const hasSource = hasTokenNearby(lines, i, SOURCE_RE, fd);
      const hasSymbol = hasTokenNearby(lines, i, SYMBOL_RE, fd);
      if (!hasSource) {
        violations.push({ relPath, lineNo: i + 1, rule: 'R2', reason: 'sourceSnapshotId 상관 필드 누락', line: trimmed });
      }
      if (!hasStage) {
        violations.push({ relPath, lineNo: i + 1, rule: 'R2', reason: 'decisionStage 상관 필드 누락', line: trimmed });
      }
      if (!hasSymbol) {
        violations.push({ relPath, lineNo: i + 1, rule: 'R2', reason: 'symbol 상관 필드 누락', line: trimmed });
      }

      // R4: position 로그 proxy 금지.
      if (pat.position) {
        for (const proxyRe of PROXY_TOKENS) {
          if (hasTokenNearby(lines, i, proxyRe)) {
            violations.push({ relPath, lineNo: i + 1, rule: 'R4', reason: 'sourceSnapshotId 자리에 proxy(buyList:/signalId/tradeId) 사용 금지', line: trimmed });
            break;
          }
        }
      }
    }
  }
  return { violations, tags: tagsFound };
}

function checkFile(absPath, relPath) {
  if (!existsSync(absPath)) return { violations: [], tags: new Set() };
  return checkSource(readFileSync(absPath, 'utf-8'), relPath);
}

/** R3 체인 정합 검사(테스트 진입점). emit 된 chain 태그 집합을 받아 누락 태그를 반환. */
export function checkChainCompleteness(allTags) {
  const missing = [];
  for (const tag of SHADOW_LIFECYCLE_TAGS) {
    const label = tag.replace(/[[\]]/g, '');
    if (!allTags.has(label)) missing.push(tag);
  }
  return missing;
}

export { SHADOW_LIFECYCLE_TAGS, TARGET_FILES };

function main() {
  const violations = [];
  const allTags = new Set();
  for (const relPath of TARGET_FILES) {
    const { violations: v, tags } = checkFile(join(ROOT, relPath), relPath);
    violations.push(...v);
    for (const t of tags) allTags.add(t);
  }

  // R3: 5-event 체인 정합 — 5단계 태그 모두 소스 emit 존재해야 함.
  for (const tag of checkChainCompleteness(allTags)) {
    violations.push({ relPath: '(5-event chain)', lineNo: 0, rule: 'R3', reason: `Shadow lifecycle 태그 ${tag} emit 누락(체인 단절)`, line: '' });
  }

  if (violations.length > 0) {
    console.error('[DECISION_LOG_GUARD] ❌ 핵심 결정 로그가 상관 필드/헬퍼를 누락했습니다 (ADR-0528 §Decision.4)');
    console.error('  핵심 결정 로그는 sourceSnapshotId/decisionStage/symbol 을 carry 해야 합니다.');
    console.error('  부수 로그면 `/* DECISION-LOG-IGNORE: <사유> */` 로 명시 제외하세요.\n');
    for (const v of violations) {
      console.error(`  [DECISION_LOG_GUARD] file=${v.relPath} line=${v.lineNo} rule=${v.rule} reason='${v.reason}' → FAIL`);
      if (v.line) console.error(`    ${v.line}`);
    }
    console.error(`\n  총 ${violations.length}건 위반`);
    process.exit(1);
  }

  console.log(`[DECISION_LOG_GUARD] OK — ${TARGET_FILES.length}개 핵심 결정 로그 파일 검사, 상관 필드 누락 없음 (5-event 체인 완전)`);
}

// CLI 진입 — import(테스트) 시에는 실행하지 않는다.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
