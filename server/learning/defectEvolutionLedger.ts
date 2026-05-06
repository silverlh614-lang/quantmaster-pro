// @responsibility 결함 진화 ledger — 패치 후 노출 결함 사슬 영속 + 유사 사례 매칭 (ADR-0260)
/**
 * defectEvolutionLedger.ts — 결함 진화 패턴 학습 데이터 영속.
 *
 * 사용자 5/6 보고: "한 결함을 패치하면 다른 결함이 노출되는 패턴이 시스템에서
 * 반복됩니다. 이 진화 과정 자체를 학습 데이터로 영속합니다."
 *
 * 본 세션 9 PR 사슬 (#622~#630, INC-2026-05-06-001) 자체가 첫 evolution record.
 * 향후 비슷한 symptom 진단 시 유사 사례 매칭으로 다음 결함 layer 후보 자동 제안.
 *
 * 영속: atomic write tmp→rename + FIFO 200 trim + 손상 JSON 빈 배열 fallback.
 * ENV `DEFECT_EVOLUTION_LEDGER_DISABLED=true` 시 모든 API no-op.
 */

import fs from 'fs';
import { DEFECT_EVOLUTION_LEDGER_FILE, ensureDataDir } from '../persistence/paths.js';

export interface DefectLayer {
  /** 1-indexed 사슬 순서. */
  layer: number;
  /** 'ADR-0211' format (단일) 또는 'ADR-0255+0256+0259' (통합). */
  adr: string;
  /** human-readable 결함 설명 (예: "R3 sanity gate1Pass wiring 결함"). */
  defect: string;
  /** PR 번호 — 예: 'PR #622'. */
  pr?: string;
  /** 어떤 패치 후 노출됐는가 — 'ADR-0211' 같은 ADR 라벨. layer 1 은 undefined. */
  revealedAfterPatchOf?: string;
  /** 패치 머지 시각 (ISO). */
  patchedAt: string;
}

export type DefectEvolutionStatus = 'IN_PROGRESS' | 'RESOLVED' | 'ABANDONED';

export interface DefectEvolutionRecord {
  /** 'INC-YYYY-MM-DD-NNN' 형식 식별자. */
  evolutionId: string;
  /** 운영자 / 사용자가 처음 보고한 증상. */
  initialSymptom: string;
  /** 진단 과정에서 사용자가 던진 단서들 (시간 순). */
  userDiagnosticHints: string[];
  /** 결함 사슬 — layer 1 부터 마지막까지. */
  defectChain: DefectLayer[];
  totalLayers: number;
  startedAt: string;
  resolvedAt?: string;
  status: DefectEvolutionStatus;
}

interface DefectEvolutionStore {
  schemaVersion: 1;
  records: DefectEvolutionRecord[];
}

const FIFO_LIMIT = 200;

function isLedgerDisabled(): boolean {
  return process.env.DEFECT_EVOLUTION_LEDGER_DISABLED === 'true';
}

let _store: DefectEvolutionStore | null = null;

function loadStore(): DefectEvolutionStore {
  if (_store) return _store;
  ensureDataDir();
  if (!fs.existsSync(DEFECT_EVOLUTION_LEDGER_FILE)) {
    _store = { schemaVersion: 1, records: [] };
    return _store;
  }
  try {
    const raw = fs.readFileSync(DEFECT_EVOLUTION_LEDGER_FILE, 'utf8');
    const parsed = JSON.parse(raw) as DefectEvolutionStore;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.records)) {
      _store = { schemaVersion: 1, records: [] };
      return _store;
    }
    _store = parsed;
    return _store;
  } catch {
    _store = { schemaVersion: 1, records: [] };
    return _store;
  }
}

function persistStore(store: DefectEvolutionStore): void {
  ensureDataDir();
  // FIFO trim — 가장 오래된 record 부터 제거.
  if (store.records.length > FIFO_LIMIT) {
    store.records = store.records.slice(-FIFO_LIMIT);
  }
  const tmp = `${DEFECT_EVOLUTION_LEDGER_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmp, DEFECT_EVOLUTION_LEDGER_FILE);
}

/**
 * 신규 evolution record 영속 — 보통 incident 발생 직후 호출.
 *
 * @returns 영속된 record (evolutionId 자동 부여 시 갱신된 형태) 또는 null (disabled).
 */
export function recordDefectEvolution(input: {
  evolutionId: string;
  initialSymptom: string;
  userDiagnosticHints?: string[];
  defectChain?: DefectLayer[];
  status?: DefectEvolutionStatus;
  startedAt?: string;
  resolvedAt?: string;
}): DefectEvolutionRecord | null {
  if (isLedgerDisabled()) return null;
  const store = loadStore();

  // 동일 evolutionId 중복 시 덮어쓰기 (idempotent — append-only 성격 보존).
  const idx = store.records.findIndex(r => r.evolutionId === input.evolutionId);
  const record: DefectEvolutionRecord = {
    evolutionId: input.evolutionId,
    initialSymptom: input.initialSymptom,
    userDiagnosticHints: input.userDiagnosticHints ?? [],
    defectChain: input.defectChain ?? [],
    totalLayers: input.defectChain?.length ?? 0,
    startedAt: input.startedAt ?? new Date().toISOString(),
    resolvedAt: input.resolvedAt,
    status: input.status ?? 'IN_PROGRESS',
  };
  if (idx >= 0) {
    store.records[idx] = record;
  } else {
    store.records.push(record);
  }
  try {
    persistStore(store);
  } catch (e) {
    console.warn(`[defectEvolutionLedger] persist 실패 (${input.evolutionId}):`, e);
  }
  return record;
}

/** 진행 중 evolution 에 layer 추가. */
export function appendLayerToEvolution(evolutionId: string, layer: DefectLayer): boolean {
  if (isLedgerDisabled()) return false;
  const store = loadStore();
  const record = store.records.find(r => r.evolutionId === evolutionId);
  if (!record) return false;
  record.defectChain.push(layer);
  record.totalLayers = record.defectChain.length;
  try {
    persistStore(store);
    return true;
  } catch (e) {
    console.warn(`[defectEvolutionLedger] append 실패 (${evolutionId}):`, e);
    return false;
  }
}

/** evolution 종결 — RESOLVED 또는 ABANDONED. */
export function markEvolutionResolved(
  evolutionId: string,
  status: 'RESOLVED' | 'ABANDONED' = 'RESOLVED',
): boolean {
  if (isLedgerDisabled()) return false;
  const store = loadStore();
  const record = store.records.find(r => r.evolutionId === evolutionId);
  if (!record) return false;
  record.status = status;
  record.resolvedAt = new Date().toISOString();
  try {
    persistStore(store);
    return true;
  } catch (e) {
    console.warn(`[defectEvolutionLedger] resolve 실패 (${evolutionId}):`, e);
    return false;
  }
}

/**
 * 한국어 텍스트 토큰화 — 단순 공백 + 조사 제거.
 * Jaccard similarity 입력용.
 */
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

export interface SimilarPatternMatch {
  evolutionId: string;
  similarity: number;
  initialSymptom: string;
  totalLayers: number;
  defectChain: DefectLayer[];
}

/**
 * 현재 증상과 유사한 과거 evolution 검색 — Jaccard similarity 기반.
 *
 * @param symptom 현재 증상 텍스트
 * @param threshold 최소 similarity (default 0.2)
 * @param limit Top N (default 5)
 */
export function findSimilarEvolutionPatterns(
  symptom: string,
  threshold = 0.2,
  limit = 5,
): SimilarPatternMatch[] {
  if (isLedgerDisabled()) return [];
  const store = loadStore();
  const queryTokens = tokenize(symptom);
  const matches: SimilarPatternMatch[] = [];
  for (const r of store.records) {
    const recordTokens = tokenize(r.initialSymptom);
    const sim = jaccardSimilarity(queryTokens, recordTokens);
    if (sim >= threshold) {
      matches.push({
        evolutionId: r.evolutionId,
        similarity: sim,
        initialSymptom: r.initialSymptom,
        totalLayers: r.totalLayers,
        defectChain: r.defectChain,
      });
    }
  }
  return matches.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
}

export interface DefectHypothesis {
  hypothesis: string;
  confidence: number;
  basedOn: string;
}

/**
 * 다음 결함 layer 후보 제안 — 유사 사례의 사슬에서 *다음 layer* 추출.
 * 현재 사슬 길이가 N 이면 유사 사례의 N+1 layer 가 후보.
 */
export function suggestNextDefectLayer(
  currentSymptom: string,
  currentChainLength: number,
): DefectHypothesis[] {
  if (isLedgerDisabled()) return [];
  const similar = findSimilarEvolutionPatterns(currentSymptom);
  const hypotheses: DefectHypothesis[] = [];
  for (const m of similar) {
    if (m.defectChain.length > currentChainLength) {
      const nextLayer = m.defectChain[currentChainLength];
      hypotheses.push({
        hypothesis: `${nextLayer.adr}: ${nextLayer.defect}`,
        confidence: m.similarity,
        basedOn: m.evolutionId,
      });
    }
  }
  return hypotheses;
}

export function getEvolutionRecord(evolutionId: string): DefectEvolutionRecord | null {
  if (isLedgerDisabled()) return null;
  return loadStore().records.find(r => r.evolutionId === evolutionId) ?? null;
}

export function getAllEvolutionRecords(): DefectEvolutionRecord[] {
  if (isLedgerDisabled()) return [];
  return [...loadStore().records];
}

/** 진단 — 분류 통계. */
export function summarizeDefectEvolution(): {
  total: number;
  inProgress: number;
  resolved: number;
  abandoned: number;
  averageLayers: number;
  longestChain: { evolutionId: string; layers: number } | null;
} {
  if (isLedgerDisabled()) {
    return { total: 0, inProgress: 0, resolved: 0, abandoned: 0, averageLayers: 0, longestChain: null };
  }
  const records = loadStore().records;
  let inProgress = 0, resolved = 0, abandoned = 0, totalLayers = 0;
  let longest: { evolutionId: string; layers: number } | null = null;
  for (const r of records) {
    if (r.status === 'IN_PROGRESS') inProgress++;
    else if (r.status === 'RESOLVED') resolved++;
    else abandoned++;
    totalLayers += r.totalLayers;
    if (!longest || r.totalLayers > longest.layers) {
      longest = { evolutionId: r.evolutionId, layers: r.totalLayers };
    }
  }
  return {
    total: records.length,
    inProgress,
    resolved,
    abandoned,
    averageLayers: records.length === 0 ? 0 : totalLayers / records.length,
    longestChain: longest,
  };
}

/**
 * ADR-0260: 본 세션 (#622~#630) 9 PR 사슬 첫 evolution record 시드.
 * 모듈 로드 시 자동 호출 — ledger 가 비어있으면 1회 영속, 이후 호출 idempotent.
 */
export const SESSION_2026_05_06_INCIDENT: DefectEvolutionRecord = {
  evolutionId: 'INC-2026-05-06-001',
  initialSymptom: 'KOSPI +5% 강세장에 신규 매수 0건 — gate1Pass 카운터 영구 0 + Yahoo stale 데이터 + KRX cooldown 모순',
  userDiagnosticHints: [
    '신규매수가 전혀 일어나지 않고 있음',
    '조회시점이 이상함',
    '57100원은 2025년 12월 가격',
    '코스피 종목은 정상인가?',
    '점심시간 빈 스캔 임계 조정 권유 잘못된거 아닌가',
    '코스닥 12종목 stale base 패턴',
    '추가적인 문제점들 분석',
  ],
  defectChain: [
    { layer: 1, adr: 'ADR-0211', pr: 'PR #622', defect: 'gate1Pass 카운터 영구 0 → R3 sanity false positive latch', patchedAt: '2026-05-06T00:00:00.000Z' },
    { layer: 2, adr: 'ADR-0221', pr: 'PR #623', defect: 'Yahoo prevClose stale (휴장 클러스터) → KIS 1차 출처 미사용', revealedAfterPatchOf: 'ADR-0211', patchedAt: '2026-05-06T01:00:00.000Z' },
    { layer: 3, adr: 'ADR-0231', pr: 'PR #624', defect: '5+ 운영 경로 ${code}.KS ?? .KQ brute-force 패턴 중복', revealedAfterPatchOf: 'ADR-0221', patchedAt: '2026-05-06T02:00:00.000Z' },
    { layer: 4, adr: 'ADR-0234', pr: 'PR #625', defect: 'Yahoo meta.symbol 교차검증 부재 → 잘못된 종목 데이터 통과', revealedAfterPatchOf: 'ADR-0231', patchedAt: '2026-05-06T03:00:00.000Z' },
    { layer: 5, adr: 'ADR-0235', pr: 'PR #626', defect: 'closeTimestamps 7일 stale 검증 부재 + 매수창 정책 불일치', revealedAfterPatchOf: 'ADR-0234', patchedAt: '2026-05-06T04:00:00.000Z' },
    { layer: 6, adr: 'ADR-0237', pr: 'PR #627', defect: 'volumeClock BLOCKED 구간 빈 스캔 false positive 경고 (점심시간 임계 조정 권유)', revealedAfterPatchOf: 'ADR-0235', patchedAt: '2026-05-06T05:00:00.000Z' },
    { layer: 7, adr: 'ADR-0241', pr: 'PR #628', defect: 'nullish ?? 폴백 — .KS STALE_BASE 응답 시 .KQ fallback 미작동 (코스닥 12종목)', revealedAfterPatchOf: 'ADR-0231', patchedAt: '2026-05-06T06:00:00.000Z' },
    { layer: 8, adr: 'ADR-0251+0252', pr: 'PR #629', defect: 'KRX off-hours 400 카운터 누적 cooldown 모순 + RECOMMENDATION_RETURN 영업일 grace 미적용', revealedAfterPatchOf: 'ADR-0241', patchedAt: '2026-05-06T07:00:00.000Z' },
    { layer: 9, adr: 'ADR-0255+0256+0259', pr: 'PR #630', defect: '데이터 출처 신뢰도 진단 인프라 + KRX 시간대 게이팅 + cooldown probe 부재', revealedAfterPatchOf: 'ADR-0251+0252', patchedAt: '2026-05-06T08:00:00.000Z' },
  ],
  totalLayers: 9,
  startedAt: '2026-05-06T00:00:00.000Z',
  resolvedAt: '2026-05-06T08:00:00.000Z',
  status: 'RESOLVED',
};

/**
 * 초기 시드 — ledger 비어있을 때 1회 자동 영속.
 * 이후 호출 idempotent (evolutionId 중복 시 덮어쓰기).
 */
export function seedFirstIncidentIfEmpty(): boolean {
  if (isLedgerDisabled()) return false;
  const records = getAllEvolutionRecords();
  if (records.length > 0) return false;
  recordDefectEvolution(SESSION_2026_05_06_INCIDENT);
  return true;
}

/** 테스트 격리. */
export function __resetDefectEvolutionLedgerForTests(): void {
  _store = null;
}
