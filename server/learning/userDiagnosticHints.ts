// @responsibility 사용자 진단 단서 영속 ledger — 결함 추적 성공 패턴 학습 (ADR-0250)
/**
 * userDiagnosticHints.ts — 사용자가 결함 진단 과정에서 던진 단서 영속.
 *
 * 사용자 5/6 보고 회상: 본 세션 9 PR 사슬 추적은 사용자 직관 단서 7개에 의존:
 *   - "신규매수가 전혀 일어나지 않고 있음"
 *   - "조회시점이 이상함"
 *   - "57100원은 2025년 12월 가격"
 *   - "코스피 종목은 정상인가?"
 *   - "점심시간 빈 스캔 임계 조정 권유 잘못된거 아닌가"
 *   - "코스닥 12종목 stale base 패턴"
 *   - "추가적인 문제점들 분석"
 *
 * 본 ledger 는 (1) 단서 자체 + (2) 어떤 결함 상황에서 나왔는지 + (3) 어떤
 * 추론 경로로 진실에 도달했는지 + (4) 해결한 ADR 을 영속해 향후 비슷한 단서
 * 발생 시 빠른 진단 권고.
 *
 * ADR-0260 defectEvolutionLedger 와 책임 분리:
 *   - ADR-0260: incident 단위 사슬 (ID + 9 layer 구조 + status)
 *   - ADR-0250: 단서 단위 매칭 (개별 단서 + success pattern + Jaccard 유사도)
 *
 * 영속: atomic write tmp→rename + FIFO 500 trim + 손상 JSON 빈 배열 fallback.
 * ENV `USER_DIAGNOSTIC_HINTS_DISABLED=true` 우회.
 */

import fs from 'fs';
import { USER_DIAGNOSTIC_HINTS_FILE, ensureDataDir } from '../persistence/paths.js';

export interface UserDiagnosticHint {
  /** 사용자 단서 자체. */
  hint: string;
  /** 단서가 나온 결함 상황 (예: 'STALE_BASE 위반 코스닥 편중'). */
  context: string;
  /** 단서 → 진실 경로 (예: '대조군 비교 질문 → 12/12 코스닥 편중 검증'). */
  successPattern: string;
  /** 해결한 ADR 라벨 (예: 'ADR-0241'). */
  resolvedADR: string;
  /** 관련 PR (예: 'PR #628'). */
  resolvedPR?: string;
  /** 해결 시각 (ISO). */
  resolvedAt: string;
  /** 진단 단계 — 결함 사슬 몇 번째 layer 에서 나왔는가. */
  layer?: number;
  /** 관련 incident (ADR-0260 evolutionId 와 cross-reference). */
  evolutionId?: string;
}

interface UserDiagnosticHintsStore {
  schemaVersion: 1;
  hints: UserDiagnosticHint[];
}

const FIFO_LIMIT = 500;

function isLedgerDisabled(): boolean {
  return process.env.USER_DIAGNOSTIC_HINTS_DISABLED === 'true';
}

let _store: UserDiagnosticHintsStore | null = null;

function loadStore(): UserDiagnosticHintsStore {
  if (_store) return _store;
  ensureDataDir();
  if (!fs.existsSync(USER_DIAGNOSTIC_HINTS_FILE)) {
    _store = { schemaVersion: 1, hints: [] };
    return _store;
  }
  try {
    const raw = fs.readFileSync(USER_DIAGNOSTIC_HINTS_FILE, 'utf8');
    const parsed = JSON.parse(raw) as UserDiagnosticHintsStore;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.hints)) {
      _store = { schemaVersion: 1, hints: [] };
      return _store;
    }
    _store = parsed;
    return _store;
  } catch {
    _store = { schemaVersion: 1, hints: [] };
    return _store;
  }
}

function persistStore(store: UserDiagnosticHintsStore): void {
  ensureDataDir();
  if (store.hints.length > FIFO_LIMIT) {
    store.hints = store.hints.slice(-FIFO_LIMIT);
  }
  const tmp = `${USER_DIAGNOSTIC_HINTS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmp, USER_DIAGNOSTIC_HINTS_FILE);
}

/** 단서 영속 — 결함 해결 직후 호출. */
export function recordUserDiagnosticHint(hint: UserDiagnosticHint): boolean {
  if (isLedgerDisabled()) return false;
  const store = loadStore();
  store.hints.push(hint);
  try {
    persistStore(store);
    return true;
  } catch (e) {
    console.warn('[userDiagnosticHints] persist 실패:', e);
    return false;
  }
}

/** 다중 단서 일괄 영속 — 한 incident 단서 묶음 (ADR-0260 와 cross-reference). */
export function recordUserDiagnosticHintsBulk(hints: UserDiagnosticHint[]): number {
  if (isLedgerDisabled() || hints.length === 0) return 0;
  const store = loadStore();
  store.hints.push(...hints);
  try {
    persistStore(store);
    return hints.length;
  } catch (e) {
    console.warn('[userDiagnosticHints] bulk persist 실패:', e);
    return 0;
  }
}

/** 한국어 토큰화 + Jaccard similarity (ADR-0260 패턴 차용). */
function tokenize(text: string): Set<string> {
  const KOREAN_PARTICLES = /[은는이가을를에서의도와과나]/g;
  const PUNCT = /[.,!?()[\]{}'"<>·~|/\\:-]+/g;
  const cleaned = text.toLowerCase().replace(PUNCT, ' ').replace(KOREAN_PARTICLES, ' ');
  return new Set(
    cleaned
      .split(/\s+/)
      .filter(t => t.length >= 2),
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersect = 0;
  for (const t of a) if (b.has(t)) intersect++;
  const unionSize = a.size + b.size - intersect;
  return unionSize === 0 ? 0 : intersect / unionSize;
}

export interface SimilarHintMatch {
  hint: UserDiagnosticHint;
  similarity: number;
}

/**
 * 현재 단서와 유사한 과거 단서 검색 — Jaccard ≥ threshold 매칭.
 *
 * 호출 예: 운영자가 새 결함 진단 중 "조회시점이 이상함" 단서 입력 시
 * 과거 ADR-0241 케이스 (success pattern + 해결 ADR) 자동 표출.
 */
export function findSimilarHints(
  query: string,
  threshold = 0.25,
  limit = 5,
): SimilarHintMatch[] {
  if (isLedgerDisabled()) return [];
  const store = loadStore();
  const queryTokens = tokenize(query);
  const matches: SimilarHintMatch[] = [];
  for (const hint of store.hints) {
    const sim = jaccardSimilarity(queryTokens, tokenize(hint.hint));
    if (sim >= threshold) {
      matches.push({ hint, similarity: sim });
    }
  }
  return matches.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
}

/** 진단 — 전체 단서 조회 (예: /diagnostic_hints 텔레그램 명령). */
export function getAllUserDiagnosticHints(): UserDiagnosticHint[] {
  if (isLedgerDisabled()) return [];
  return [...loadStore().hints];
}

/**
 * ADR-0250: 본 세션 (#622~#632, INC-2026-05-06-001) 핵심 진단 단서 시드.
 * 모듈 로드 시 자동 호출 — ledger 가 비어있으면 1회 영속.
 */
export const SESSION_2026_05_06_HINTS: UserDiagnosticHint[] = [
  {
    hint: '신규매수가 전혀 일어나지 않고 있음',
    context: 'KOSPI +5% 강세장에 매수 0건',
    successPattern: '증상 자체 보고 → R3 sanity false positive latch 가설 → gate1Pass 카운터 영구 0 발견',
    resolvedADR: 'ADR-0211',
    resolvedPR: 'PR #622',
    resolvedAt: '2026-05-06T00:00:00.000Z',
    layer: 1,
    evolutionId: 'INC-2026-05-06-001',
  },
  {
    hint: '조회시점이 이상함',
    context: 'STALE_BASE 위반 반복',
    successPattern: '시점 의심 → 가격값 자체 비현실 검증 → KIS prevClose 1차 출처 우선 결정',
    resolvedADR: 'ADR-0221',
    resolvedPR: 'PR #623',
    resolvedAt: '2026-05-06T01:00:00.000Z',
    layer: 2,
    evolutionId: 'INC-2026-05-06-001',
  },
  {
    hint: '57100원은 2025년 12월 가격',
    context: 'closeTimestamps stale 5개월',
    successPattern: '구체적 가격값 + 시점 매칭 → Yahoo 시계열 갱신 지연 종목 식별 → 7일 stale 임계 도입',
    resolvedADR: 'ADR-0235',
    resolvedPR: 'PR #626',
    resolvedAt: '2026-05-06T04:00:00.000Z',
    layer: 5,
    evolutionId: 'INC-2026-05-06-001',
  },
  {
    hint: '코스피 종목은 정상인가?',
    context: 'STALE_BASE 위반 코스닥 편중',
    successPattern: '대조군 비교 질문 → 12/12 코스닥 편중 검증 → nullish ?? sanity 폴백 결함 결정적 확정',
    resolvedADR: 'ADR-0241',
    resolvedPR: 'PR #628',
    resolvedAt: '2026-05-06T06:00:00.000Z',
    layer: 7,
    evolutionId: 'INC-2026-05-06-001',
  },
  {
    hint: '점심시간 빈 스캔 임계 조정 권유 잘못된거 아닌가',
    context: '점심 11:31~12:59 BLOCKED 구간 false positive 경고',
    successPattern: '시간대 인지 + 정상 동작 의심 → volumeClock vs isBuyableKstWindow mismatch 발견',
    resolvedADR: 'ADR-0237',
    resolvedPR: 'PR #627',
    resolvedAt: '2026-05-06T05:00:00.000Z',
    layer: 6,
    evolutionId: 'INC-2026-05-06-001',
  },
  {
    hint: '코스닥 12종목 stale base 패턴',
    context: 'fetchYahooQuoteByCode .KS STALE 시 .KQ fallback 미작동',
    successPattern: '특정 시장 편중 패턴 명시 → nullish 폴백의 sanity 무관 결함 즉시 식별',
    resolvedADR: 'ADR-0241',
    resolvedPR: 'PR #628',
    resolvedAt: '2026-05-06T06:00:00.000Z',
    layer: 7,
    evolutionId: 'INC-2026-05-06-001',
  },
  {
    hint: '추가적인 문제점들 분석',
    context: '결함 사슬 진행 중 다음 layer 의심',
    successPattern: 'open-ended 분석 요청 → KRX off-hours 카운터 모순 + RECOMMENDATION_RETURN grace 미적용 발견',
    resolvedADR: 'ADR-0251+0252',
    resolvedPR: 'PR #629',
    resolvedAt: '2026-05-06T07:00:00.000Z',
    layer: 8,
    evolutionId: 'INC-2026-05-06-001',
  },
];

/**
 * 초기 시드 — ledger 비어있을 때 1회 자동 영속. idempotent.
 */
export function seedSessionHintsIfEmpty(): boolean {
  if (isLedgerDisabled()) return false;
  const hints = getAllUserDiagnosticHints();
  if (hints.length > 0) return false;
  recordUserDiagnosticHintsBulk(SESSION_2026_05_06_HINTS);
  return true;
}

/** 테스트 격리. */
export function __resetUserDiagnosticHintsForTests(): void {
  _store = null;
}
