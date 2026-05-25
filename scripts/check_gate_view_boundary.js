/**
 * check_gate_view_boundary.js  —  ADR-0526 §Decision.5 legacy read-guard (gate view boundary).
 *
 * 규칙: per-candidate Gate0/1/2/3 판정 정본은 CandidateGateEvaluationView /
 *       candidateGateAggregate / candidateGate2Confluence / candidateGate3Closure (스캔-시점 View) 다.
 *       formatter / 소비자 (분류 (b)) 는 본 View 만 read 한다. raw candidateTraces 에서
 *       gate2Status / gate3Readiness / gate2Passed / gate3Passed 를 직접 채굴하거나,
 *       buildGate2ConfluenceSummary / buildGate3RuntimeClosureSummary /
 *       resolveFinalExecutionDecision 를 *재실행* 하면 안 된다 (gate2/3 판정 분기 차단).
 *
 *       생산자 (a) / View SSOT 생산자 / 테스트는 대상에서 제외 (rich trace 정당 사용).
 *
 *       예외 구간: `// GATE-VIEW-EXEMPT-BEGIN ... // GATE-VIEW-EXEMPT-END` 로 감싼 라인은
 *       ADR-0527/Phase2 execution resolver 입력 전용으로 명시 예외 처리한다 (gate2/3 display 아님).
 *
 *       위반 발견 시 EXIT 1 + 파일:라인 출력. 위반 0 이면 EXIT 0.
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

/** 검사 대상 — ADR-0526 분류 (b) formatter / 소비자 파일. */
const TARGET_FILES = [
  'server/telegram/commands/system/gateUx.cmd.ts',
  'server/telegram/commands/system/scanBlockersGate2.cmd.ts',
  'server/telegram/commands/system/scanBlockersGate3.cmd.ts',
  'server/telegram/commands/system/gate2ExternalRefresh.cmd.ts',
  'server/telegram/renderers/snapshotBundle.ts',
  'server/trading/signalScanner/scanDiagnostics/scanBlockersFormatter.ts',
];

/** 금지 패턴 — gate2/3 판정 재추론(raw 채굴) + 정본 빌더 재실행. */
const FORBIDDEN_PATTERNS = [
  // raw candidateTraces 에서 gate 판정 직접 채굴 (배열 인덱싱/속성 접근 형태).
  { re: /candidateTraces\b[\s\S]{0,40}?\.(gate2Status|gate3Readiness|gate2Passed|gate3Passed)\b/, label: 'candidateTraces gate verdict 직접 채굴' },
  { re: /\.(gate2Status|gate3Readiness|gate2Passed|gate3Passed)\b/, label: 'gate verdict 직접 채굴', traceContextOnly: true },
  // 정본 빌더 formatter 측 재실행.
  { re: /\bbuildGate2ConfluenceSummary\s*\(/, label: 'buildGate2ConfluenceSummary 재실행' },
  { re: /\bbuildGate3RuntimeClosureSummary\s*\(/, label: 'buildGate3RuntimeClosureSummary 재실행' },
  { re: /\bresolveFinalExecutionDecision\s*\(/, label: 'resolveFinalExecutionDecision 재실행' },
];

const EXEMPT_BEGIN = 'GATE-VIEW-EXEMPT-BEGIN';
const EXEMPT_END = 'GATE-VIEW-EXEMPT-END';

function isCommentLine(trimmed) {
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

function checkFile(absPath, relPath) {
  if (!existsSync(absPath)) return [];
  const src = readFileSync(absPath, 'utf-8');
  const lines = src.split('\n');
  const violations = [];
  let exempt = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.includes(EXEMPT_BEGIN)) { exempt = true; continue; }
    if (trimmed.includes(EXEMPT_END)) { exempt = false; continue; }
    if (exempt) continue;
    if (isCommentLine(trimmed)) continue;
    for (const { re, label, traceContextOnly } of FORBIDDEN_PATTERNS) {
      // traceContextOnly 패턴(.gate2Status 단독)은 trace/candidate 식별자가 같은 라인에 있을 때만 위반.
      if (traceContextOnly && !/\b(trace|candidate|traces|row)\b/i.test(line)) continue;
      if (re.test(line)) {
        violations.push({ relPath, lineNo: i + 1, line: trimmed, label });
        break;
      }
    }
  }
  return violations;
}

function main() {
  const violations = [];
  for (const relPath of TARGET_FILES) {
    violations.push(...checkFile(join(ROOT, relPath), relPath));
  }

  if (violations.length > 0) {
    console.error('[GateViewBoundary] ❌ formatter 가 raw trace 에서 gate 판정을 재추론합니다 (ADR-0526 §Decision.5)');
    console.error('  per-candidate Gate0/1/2/3 정본은 candidateGateViews / candidateGateAggregate /');
    console.error('  candidateGate2Confluence / candidateGate3Closure (스캔-시점 View) 입니다.');
    console.error('  formatter 는 본 View 만 read 하세요. (Phase2 execution input 은 GATE-VIEW-EXEMPT 구간으로 명시)\n');
    for (const v of violations) {
      console.error(`  ${v.relPath}:${v.lineNo}  [${v.label}]`);
      console.error(`    ${v.line}`);
    }
    console.error(`\n  총 ${violations.length}건 위반`);
    process.exit(1);
  }

  console.log(`[GateViewBoundary] OK — ${TARGET_FILES.length}개 formatter/소비자 검사, gate 판정 재추론 누출 없음`);
}

main();
