// @responsibility Generate durable bounded research proposals independently of trading execution.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PaperAdaptiveState } from '../../../src/types/paperAdaptive.js';
import { PAPER_FEATURES } from '../../../src/types/paperObservationFeatures.js';
import { PAPER_PROGRAM_FAILURE_LABELS, PAPER_PROGRAM_FAILURES, PAPER_PROGRAM_LIMITS, type PaperIndicatorProgram, type PaperProgramFailure,
  type PaperProgramResearchView } from '../../../src/types/paperIndicatorProgram.js';
import { paperIndicatorFormulaId } from '../../../src/types/paperIndicatorFormula.js';
import { DATA_DIR } from '../../persistence/paths.js';
import { callGeminiText } from '../../clients/geminiClient.js';
import { AI_MODELS } from '../../constants.js';
import { toKstDateKey } from '../../calendar/krxTradingCalendar.js';
import { sealPaperProgram, validSealedPaperFormula } from './paperIndicatorProgram.js';
import { paperEvidenceDigest } from './paperStrategyEvidence.js';

export interface PaperProgramProposal { formula: PaperIndicatorProgram; generatedAt: string; model: string; inputDigest: string }
const timestamp = z.string().datetime({ offset: true });
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const proposalSchema = z.object({ formula: z.custom<PaperIndicatorProgram>(value => validSealedPaperFormula(value) && value.version === 'feature-program-v1'),
  generatedAt: timestamp, model: z.string().min(1).max(80), inputDigest: digest });
const storeSchema = z.object({ version: z.literal(1), attemptedAt: timestamp.nullable(), completedAt: timestamp.nullable(),
  inputDigest: digest.nullable(), state: z.enum(['IDLE', 'RUNNING', 'READY', 'FAILED']), message: z.string().max(300),
  failure: z.enum(PAPER_PROGRAM_FAILURES).optional(),
  proposals: z.array(proposalSchema).max(PAPER_PROGRAM_LIMITS.storedProposals), seen: z.array(digest).max(1000),
}).refine(value => new Set(value.proposals.map(item => item.formula.digest)).size === value.proposals.length
  && value.proposals.every(item => value.seen.includes(item.formula.digest))
  && (value.attemptedAt === null ? value.state === 'IDLE' && value.inputDigest === null && value.completedAt === null : value.inputDigest !== null)
  && (!value.completedAt || Boolean(value.attemptedAt && Date.parse(value.completedAt) >= Date.parse(value.attemptedAt)))
  && value.proposals.every(item => (value.completedAt ?? value.attemptedAt) && Date.parse(item.generatedAt) <= Date.parse((value.completedAt ?? value.attemptedAt)!)));
type Store = z.infer<typeof storeSchema>;
const empty = (): Store => ({ version: 1, attemptedAt: null, completedAt: null, inputDigest: null, state: 'IDLE', message: '장외 새 학습 자료 대기', proposals: [], seen: [] });
const file = (directory: string) => path.join(directory, 'paper-program-research.json');
function load(directory: string): Store {
  if (!fs.existsSync(file(directory))) return empty();
  if (fs.statSync(file(directory)).size > 200_000) throw new Error('연구 후보 파일 크기 검사 실패');
  return storeSchema.parse(JSON.parse(fs.readFileSync(file(directory), 'utf8')));
}
function save(directory: string, value: Store): void {
  storeSchema.parse(value);
  fs.mkdirSync(directory, { recursive: true });
  const target = file(directory), temporary = `${target}.${randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(temporary, 'wx');
    try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, target);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
export function paperProgramResearchInput(state: PaperAdaptiveState) {
  // Only training aggregates are exposed. Validation returns and individual transactions stay local.
  return state.candidates.filter(item => !item.rule.invention && item.training.sampleCount > 0).map(item => ({
    feature: item.rule.feature, bucket: item.rule.bucket, horizon: item.rule.horizon,
    samples: item.training.sampleCount, dates: item.training.dateCount,
    meanNetReturnPct: item.training.meanNetReturnPct, meanDailyExcessPct: item.training.meanDailyExcessPct,
    evidence: item.training.experimentIdsDigest ?? paperEvidenceDigest(item.training.experimentIds ?? []),
  }));
}
export function paperProgramResearchPrompt(state: PaperAdaptiveState, previous: PaperProgramProposal[]): string {
  return `기존 관측 자료만 사용하는 Shadow 연구 가설과 계산 프로그램을 최대 2개 만드세요. 수익 보장이나 매수 지시는 금지합니다.
한국어 title(60자), hypothesis(300자), interpretation(300자), limitation(300자), expression을 가진 JSON 배열만 반환하세요.
재료 정의: ${JSON.stringify(PAPER_FEATURES)}
모든 feature는 고정 cuts의 가운데 값을 빼고 (최댓값-최솟값)으로 나눈 뒤 -3~3으로 제한한 환산값입니다.
노드 형식: {"op":"feature","key":"rsi14"}, {"op":"constant","value":1},
{"op":"abs 또는 negate","value":노드}, {"op":"add/subtract/multiply/divide/min/max/mean 중 하나","left":노드,"right":노드},
{"op":"ifPositive","condition":노드,"positive":노드,"otherwise":노드}. condition>0일 때 positive입니다.
문자열 코드, 파일, 네트워크, 시간, 미래 성과 접근은 없습니다. 현재 저장된 지표 외 자료와 원시 시계열 연산을 가정하지 마세요.
최대31노드/깊이6/서로 다른2~6개재료/상수-3~3. 모든 분기의 입력이 필요합니다. 0에 가까운 나눗셈은 계산불가입니다.
중간 사칙연산은 -27~27, 최종값은 -3~3으로 제한합니다. 나눗셈의 분모가0이 되는 설계를 피하세요.
기존 두 재료의 단순 평균/차이/곱 복제보다 여러 단계 계산이나 비선형/분기로 독립 가설을 제안하세요.
학습 구간 집계(후반 검증 결과 아님): ${JSON.stringify(paperProgramResearchInput(state))}
이전 AI 계산의 학습 검사 결과(실패 사유를 참고해 계산을 개선): ${JSON.stringify(state.discovery?.programReviews ?? [])}
이미 제안한 계산(검사 결과의 id로 대조, 중복 금지): ${JSON.stringify(previous.map(item => ({ id: paperIndicatorFormulaId(item.formula), title: item.formula.title, expression: item.formula.expression })))}
해석은 실제 계산의 증감 방향과 제한을 설명하고, 가설의 실패 상황을 명시하세요. 설명에 줄바꿈/HTML을 넣지 마세요.`;
}
export function parsePaperProgramProposals(raw: string): PaperIndicatorProgram[] {
  if (raw.length > 30_000) throw new Error('AI 응답 길이 검사 실패');
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const entries: unknown = JSON.parse(cleaned);
  if (!Array.isArray(entries) || entries.length > PAPER_PROGRAM_LIMITS.dailyProposals) throw new Error('AI 후보 개수 검사 실패');
  return entries.map(sealPaperProgram);
}
/** Tags each failing step so the stored round says why it failed without persisting the raw error. */
class ProgramResearchFailure extends Error {
  constructor(readonly failure: PaperProgramFailure, message: string) { super(message); }
}
const failureMessage = (failure: PaperProgramFailure) => `${PAPER_PROGRAM_FAILURE_LABELS[failure]} · 같은 날짜 재호출 없이 기존 연구를 계속합니다.`;
const inFlight = new Map<string, Promise<void>>();
let readIssue: string | null = null;
export function readPaperProgramProposals(directory = DATA_DIR): PaperProgramProposal[] {
  try { const state = load(directory); readIssue = null; return state.proposals; }
  catch (error) {
    if (!readIssue) console.error('[PaperProgramResearch] 후보 원본 보존, 기존 전략 계속:', error instanceof Error ? error.name : '읽기 실패');
    readIssue = '후보 파일을 읽을 수 없습니다. 원본을 보존하고 기존 전략을 계속합니다.'; return [];
  }
}
export function readPaperProgramResearch(adaptive?: PaperAdaptiveState, directory = DATA_DIR): PaperProgramResearchView {
  try {
    const store = load(directory), interrupted = store.state === 'RUNNING' && !inFlight.has(directory);
    const failure = interrupted ? 'INTERRUPTED' : store.state === 'FAILED' ? store.failure : undefined;
    return { state: interrupted ? 'FAILED' : store.state, attemptedAt: store.attemptedAt, completedAt: store.completedAt,
      message: interrupted ? failureMessage('INTERRUPTED') : store.message, ...(failure ? { failure } : {}),
      proposals: store.proposals.map(item => ({ id: paperIndicatorFormulaId(item.formula), title: item.formula.title, generatedAt: item.generatedAt,
        registered: Boolean(adaptive?.discovery?.inventions.some(invention => invention.id === paperIndicatorFormulaId(item.formula))),
        evaluated: Boolean(adaptive?.discovery?.programAttemptedIds?.includes(paperIndicatorFormulaId(item.formula))) })) };
  } catch (error) {
    console.error('[PaperProgramResearch] 상태 조회 실패:', error instanceof Error ? error.name : '읽기 실패');
    return { state: 'FAILED', attemptedAt: null, completedAt: null, failure: 'STORAGE',
      message: '연구 후보 파일 확인 필요 · 기존 전략은 계속됩니다.', proposals: [] };
  }
}
/** Invoked after durable strategy commits; never awaited by market scanning or holding monitoring. */
export function queuePaperProgramResearch(adaptive: PaperAdaptiveState, options: { asOf: string; marketOpen: boolean; directory?: string;
  generate?: (prompt: string) => Promise<string | null>; now?: () => string }): Promise<void> {
  const directory = options.directory ?? DATA_DIR;
  if (options.marketOpen || !Number.isFinite(Date.parse(options.asOf))) return Promise.resolve();
  if (inFlight.has(directory)) return inFlight.get(directory)!;
  const work = async () => {
    let store: Store;
    try { store = load(directory); } catch (error) { console.error('[PaperProgramResearch] 원본 확인 필요:', error instanceof Error ? error.name : '읽기 실패'); return; }
    const day = toKstDateKey(options.asOf), input = paperProgramResearchInput(adaptive);
    if (!input.some(item => item.samples >= 10 && item.dates >= 3) || Date.parse(adaptive.evaluatedAt) > Date.parse(options.asOf)
      || store.attemptedAt && toKstDateKey(store.attemptedAt) >= day) return;
    const inputDigest = createHash('sha256').update(JSON.stringify([input, adaptive.discovery?.programReviews ?? []])).digest('hex');
    if (store.state === 'READY' && store.inputDigest === inputDigest) return;
    // Claim before external work so restarts cannot repeatedly spend the same daily budget.
    const { failure: _previousFailure, ...previous } = store;
    store = { ...previous, attemptedAt: options.asOf, completedAt: null, inputDigest, state: 'RUNNING', message: 'AI가 가설과 계산 절차를 작성 중입니다.' };
    const persist = (value: Store) => {
      try { save(directory, value); } catch (error) {
        throw new ProgramResearchFailure('STORAGE', error instanceof Error ? error.message : '저장 실패');
      }
    };
    try {
      persist(store);
      const generate = options.generate ?? ((prompt: string) => callGeminiText(prompt, { caller: 'paper-program-research', prependPersona: false,
        stripPreamble: false, temperature: 0.4, maxOutputTokens: 4096, thinkingBudget: 0 }));
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let raw: string | null;
      try { raw = await Promise.race([generate(paperProgramResearchPrompt(adaptive, store.proposals)), new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new ProgramResearchFailure('TIMEOUT', 'AI 응답 시간 초과')), 120_000);
      })]); } catch (error) {
        throw error instanceof ProgramResearchFailure ? error : new ProgramResearchFailure('AI_ERROR', error instanceof Error ? error.message : 'AI 호출 오류');
      } finally { if (timeout) clearTimeout(timeout); }
      if (!raw) throw new ProgramResearchFailure('NO_RESPONSE', 'AI 응답 없음 또는 API 예산·연결 확인 필요');
      let parsed: PaperIndicatorProgram[];
      try { parsed = parsePaperProgramProposals(raw); } catch (error) {
        throw new ProgramResearchFailure('INVALID_OUTPUT', error instanceof Error ? error.message : '계산 검사 실패');
      }
      const programs = parsed.filter(program => !store.seen.includes(program.digest));
      const generatedAt = options.now?.() ?? new Date().toISOString();
      if (Date.parse(generatedAt) < Date.parse(options.asOf)) throw new Error('AI 생성 시각 검사 실패');
      const unique = [...new Map(programs.map(program => [program.digest, program])).values()];
      store.proposals = [...store.proposals, ...unique.map(formula => ({ formula, generatedAt, model: AI_MODELS.SERVER_SIDE, inputDigest }))].slice(-PAPER_PROGRAM_LIMITS.storedProposals);
      store.seen = [...new Set([...store.seen, ...unique.map(program => program.digest)])].slice(-1000);
      store.state = 'READY'; store.completedAt = generatedAt;
      store.message = `계산 검사 통과 ${unique.length}개 · 다음 일일 평가에서 학습 우위와 중복 여부를 확인합니다.`;
      persist(store);
    } catch (error) {
      console.error('[PaperProgramResearch] 생성 실패, 기존 전략 계속:', error instanceof Error ? error.message : '알 수 없는 오류');
      const failure = error instanceof ProgramResearchFailure ? error.failure : 'UNKNOWN';
      store.state = 'FAILED'; store.failure = failure; store.completedAt = options.now?.() ?? new Date().toISOString();
      store.message = failureMessage(failure);
      try { save(directory, store); } catch (saveError) { console.error('[PaperProgramResearch] 실패 상태 저장 오류:', saveError instanceof Error ? saveError.name : '저장 실패'); }
    }
  };
  const pending = work().catch(error => { console.error('[PaperProgramResearch] 연구 격리 오류:', error instanceof Error ? error.name : '처리 실패'); })
    .finally(() => inFlight.delete(directory));
  inFlight.set(directory, pending); return pending;
}
