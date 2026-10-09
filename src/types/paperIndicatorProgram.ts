// @responsibility Define bounded calculation programs for autonomous indicator research.
import { PAPER_FEATURES, type PaperFeatureKey } from './paperObservationFeatures';

export type PaperProgramNode = { op: 'feature'; key: PaperFeatureKey } | { op: 'constant'; value: number }
  | { op: 'abs' | 'negate'; value: PaperProgramNode }
  | { op: 'add' | 'subtract' | 'multiply' | 'divide' | 'min' | 'max' | 'mean'; left: PaperProgramNode; right: PaperProgramNode }
  | { op: 'ifPositive'; condition: PaperProgramNode; positive: PaperProgramNode; otherwise: PaperProgramNode };
export interface PaperIndicatorProgram {
  version: 'feature-program-v1'; digest: string; title: string; hypothesis: string;
  interpretation: string; limitation: string; expression: PaperProgramNode;
}
export const PAPER_PROGRAM_LIMITS = { nodes: 31, depth: 6, features: 6, dailyProposals: 2, storedProposals: 12 } as const;
const binary = ['add', 'subtract', 'multiply', 'divide', 'min', 'max', 'mean'];
const fields = (value: object, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
// Echo only plain identifiers from AI output; anything else is summarized.
const shown = (value: unknown) => typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,30}$/.test(value) ? value : '기타';
/** First reason a calculation tree fails, in Korean, or null when it is valid. */
export function paperProgramNodeIssue(value: unknown): string | null {
  let count = 0;
  const keys = new Set<string>();
  function visit(value: unknown, depth: number): string | null {
    if (++count > PAPER_PROGRAM_LIMITS.nodes) return `노드 ${PAPER_PROGRAM_LIMITS.nodes}개 초과`;
    if (depth > PAPER_PROGRAM_LIMITS.depth) return `깊이 ${PAPER_PROGRAM_LIMITS.depth} 초과`;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return '노드 형식 오류';
    const node = value as Record<string, unknown>;
    const only = (expected: string[]) => fields(node, expected) ? null : `${shown(node.op)} 노드 항목 오류(${expected.join('·')}만 허용)`;
    if (node.op === 'feature') {
      const issue = only(['op', 'key']);
      if (issue) return issue;
      if (typeof node.key !== 'string' || !Object.hasOwn(PAPER_FEATURES, node.key)) return `없는 재료 ${shown(node.key)}`;
      keys.add(node.key); return keys.size <= PAPER_PROGRAM_LIMITS.features ? null : `재료 ${PAPER_PROGRAM_LIMITS.features}개 초과`;
    }
    if (node.op === 'constant') {
      return only(['op', 'value']) ?? (typeof node.value !== 'number' || !Number.isFinite(node.value) ? '상수 숫자 오류'
        : Math.abs(node.value) > 3 ? '상수 -3~3 범위 초과' : null);
    }
    if (node.op === 'abs' || node.op === 'negate') return only(['op', 'value']) ?? visit(node.value, depth + 1);
    if (typeof node.op === 'string' && binary.includes(node.op)) return only(['op', 'left', 'right']) ?? visit(node.left, depth + 1) ?? visit(node.right, depth + 1);
    if (node.op !== 'ifPositive') return `허용되지 않은 연산 ${shown(node.op)}`;
    return only(['op', 'condition', 'positive', 'otherwise'])
      ?? visit(node.condition, depth + 1) ?? visit(node.positive, depth + 1) ?? visit(node.otherwise, depth + 1);
  }
  return visit(value, 1) ?? (keys.size >= 2 ? null : '서로 다른 재료 2개 미만');
}
export function validPaperProgramNode(value: unknown): value is PaperProgramNode {
  return paperProgramNodeIssue(value) === null;
}
const programFields = ['version', 'digest', 'title', 'hypothesis', 'interpretation', 'limitation', 'expression'];
/** First reason a program fails, in Korean, or null when it is valid. Angle brackets stay banned for HTML reports. */
export function paperProgramIssue(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '계산 프로그램 형식 오류';
  const program = value as PaperIndicatorProgram;
  if (!fields(program, programFields)) {
    const extra = Object.keys(program).filter(key => !programFields.includes(key));
    return extra.length ? `허용되지 않은 항목 ${extra.slice(0, 3).map(shown).join('·')}` : '필수 항목 누락';
  }
  if (program.version !== 'feature-program-v1' || !/^[a-f0-9]{64}$/.test(program.digest)) return '버전·식별값 오류';
  for (const [key, label, limit] of [['title', '제목', 60], ['hypothesis', '가설', 300], ['interpretation', '해석', 300], ['limitation', '한계', 300]] as const) {
    const value: unknown = program[key];
    if (typeof value !== 'string' || !value.trim()) return `${label} 비어 있음`;
    if (value.length > limit) return `${label} ${limit}자 초과`;
    if (/[\u0000-\u001f]/.test(value)) return `${label}에 줄바꿈·제어문자`;
    if (/[<>]/.test(value)) return `${label}에 꺾쇠 기호`;
  }
  return paperProgramNodeIssue(program.expression);
}
export function validPaperIndicatorProgram(value: unknown): value is PaperIndicatorProgram {
  return paperProgramIssue(value) === null;
}
/** Canonical executable identity excludes prose; renaming cannot reset a failed experiment. */
export function paperProgramCode(node: PaperProgramNode): string {
  if (node.op === 'feature') return `N(${node.key})`;
  if (node.op === 'constant') return String(node.value);
  if (node.op === 'abs' || node.op === 'negate') return `${node.op}(${paperProgramCode(node.value)})`;
  if (node.op === 'ifPositive') return `ifPositive(${paperProgramCode(node.condition)},${paperProgramCode(node.positive)},${paperProgramCode(node.otherwise)})`;
  if ('left' in node) return `${node.op}(${paperProgramCode(node.left)},${paperProgramCode(node.right)})`;
  return '';
}
export function paperProgramFeatures(node: PaperProgramNode): PaperFeatureKey[] {
  if (node.op === 'feature') return [node.key];
  if (node.op === 'constant') return [];
  const children = 'left' in node ? [node.left, node.right] : node.op === 'ifPositive'
    ? [node.condition, node.positive, node.otherwise] : [node.value];
  return [...new Set(children.flatMap(paperProgramFeatures))].sort();
}
/** Only validated finite trees reach this interpreter; no executable strings or external capabilities. */
export function evaluatePaperProgram(program: PaperIndicatorProgram, input: (key: PaperFeatureKey) => number | null): number | null {
  if (!validPaperIndicatorProgram(program)) return null;
  const values = new Map(paperProgramFeatures(program.expression).map(key => [key, input(key)]));
  if ([...values.values()].some(value => value === null || !Number.isFinite(value))) return null;
  function run(node: PaperProgramNode): number | null {
    if (node.op === 'feature') return values.get(node.key)!;
    if (node.op === 'constant') return node.value;
    if (node.op === 'abs' || node.op === 'negate') { const value = run(node.value); return value === null ? null : node.op === 'abs' ? Math.abs(value) : -value; }
    if (node.op === 'ifPositive') { const condition = run(node.condition); return condition === null ? null : run(condition > 0 ? node.positive : node.otherwise); }
    if (!('left' in node)) return null;
    const left = run(node.left), right = run(node.right);
    if (left === null || right === null || node.op === 'divide' && Math.abs(right) < 1e-6) return null;
    const result = node.op === 'add' ? left + right : node.op === 'subtract' ? left - right
      : node.op === 'multiply' ? left * right : node.op === 'divide' ? left / right
        : node.op === 'min' ? Math.min(left, right) : node.op === 'max' ? Math.max(left, right) : (left + right) / 2;
    return Number.isFinite(result) ? Math.max(-27, Math.min(27, result)) : null;
  }
  const result = run(program.expression);
  return result === null ? null : Math.max(-3, Math.min(3, result));
}

/** Why the latest AI formula round failed. The raw error stays in the server log. */
export const PAPER_PROGRAM_FAILURES = ['INTERRUPTED', 'TIMEOUT', 'NO_RESPONSE', 'AI_ERROR', 'INVALID_FORMAT', 'INVALID_OUTPUT', 'STORAGE', 'UNKNOWN'] as const;
export type PaperProgramFailure = typeof PAPER_PROGRAM_FAILURES[number];
export const PAPER_PROGRAM_FAILURE_LABELS: Record<PaperProgramFailure, string> = {
  INTERRUPTED: '서버 재시작으로 중단', TIMEOUT: 'AI 응답 시간 초과(120초)',
  NO_RESPONSE: 'AI 응답 없음 · API 키·월 예산 확인(/ai_status)', AI_ERROR: 'AI 호출 오류 · 연결·호출 한도 확인(/ai_status)',
  INVALID_FORMAT: 'AI 응답이 JSON 배열 형식이 아니거나 잘림',
  INVALID_OUTPUT: 'AI가 쓴 계산법 후보가 모두 계산 검사를 통과하지 못함', STORAGE: '연구 후보 파일 읽기·저장 오류 · 파일 점검 필요',
  UNKNOWN: '기타 오류 · 서버 로그 [PaperProgramResearch] 확인',
};

export interface PaperProgramResearchView {
  state: 'IDLE' | 'RUNNING' | 'READY' | 'FAILED'; attemptedAt: string | null; completedAt: string | null;
  message: string; failure?: PaperProgramFailure;
  /** First failed check of a candidate, already free of raw AI text. */
  failureDetail?: string;
  proposals: Array<{ id: string; title: string; generatedAt: string; registered: boolean; evaluated: boolean }>;
}
