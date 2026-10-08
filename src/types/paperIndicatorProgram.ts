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
export function validPaperProgramNode(value: unknown): value is PaperProgramNode {
  let count = 0;
  const keys = new Set<string>();
  function visit(value: unknown, depth: number): boolean {
    if (++count > PAPER_PROGRAM_LIMITS.nodes || depth > PAPER_PROGRAM_LIMITS.depth || !value || typeof value !== 'object' || Array.isArray(value)) return false;
    const node = value as Record<string, unknown>;
    if (node.op === 'feature') {
      if (!fields(node, ['op', 'key']) || typeof node.key !== 'string' || !Object.hasOwn(PAPER_FEATURES, node.key)) return false;
      keys.add(node.key); return keys.size <= PAPER_PROGRAM_LIMITS.features;
    }
    if (node.op === 'constant') return fields(node, ['op', 'value']) && typeof node.value === 'number' && Number.isFinite(node.value) && Math.abs(node.value) <= 3;
    if (node.op === 'abs' || node.op === 'negate') return fields(node, ['op', 'value']) && visit(node.value, depth + 1);
    if (typeof node.op === 'string' && binary.includes(node.op)) return fields(node, ['op', 'left', 'right']) && visit(node.left, depth + 1) && visit(node.right, depth + 1);
    return node.op === 'ifPositive' && fields(node, ['op', 'condition', 'positive', 'otherwise'])
      && visit(node.condition, depth + 1) && visit(node.positive, depth + 1) && visit(node.otherwise, depth + 1);
  }
  return visit(value, 1) && keys.size >= 2;
}
export function validPaperIndicatorProgram(value: unknown): value is PaperIndicatorProgram {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const program = value as PaperIndicatorProgram;
  const text = (value: unknown, limit: number) => typeof value === 'string' && value.trim().length > 0 && value.length <= limit && !/[\u0000-\u001f<>]/.test(value);
  return fields(program, ['version', 'digest', 'title', 'hypothesis', 'interpretation', 'limitation', 'expression'])
    && program.version === 'feature-program-v1' && /^[a-f0-9]{64}$/.test(program.digest)
    && text(program.title, 60) && text(program.hypothesis, 300) && text(program.interpretation, 300) && text(program.limitation, 300)
    && validPaperProgramNode(program.expression);
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
  proposals: Array<{ id: string; title: string; generatedAt: string; registered: boolean; evaluated: boolean }>;
}
