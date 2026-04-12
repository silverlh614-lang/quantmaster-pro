/**
 * failurePatternDB.ts — 반실패 학습 패턴 DB (Anti-Failure Intelligence)
 *
 * 핵심 개념:
 *   손절된 모든 포지션의 진입 시점 신호 패턴을 실패 패턴 DB로 구축하고,
 *   유사 패턴이 재발할 때 자동으로 경고하는 역방향 학습 엔진.
 *
 * 알고리즘:
 *   1. 손절 시 해당 종목의 진입 당시 스냅샷(27조건 충족 현황, MTF 스코어,
 *      섹터 에너지, 시장 레짐)을 JSON으로 DB 저장.
 *   2. 새 종목이 스크리닝될 때 과거 실패 패턴 DB와 코사인 유사도를 계산.
 *   3. 유사도 85% 이상이면 "이 진입 패턴은 과거 X번 중 Y번 손절됨" 경고 첨부.
 *
 * 핵심 통찰: 성공 패턴을 따라가는 것보다 실패 패턴을 피하는 것이 승률 개선에 더 빠르다.
 */

import {
  type FailurePatternEntry,
  loadFailurePatterns,
  appendFailurePattern,
} from '../persistence/failurePatternRepo.js';

export type { FailurePatternEntry };

// ─── 유사도 임계값 ─────────────────────────────────────────────────────────────

const SIMILARITY_THRESHOLD = 0.85; // 85% 이상이면 경고

// ─── 벡터 연산 ────────────────────────────────────────────────────────────────

/**
 * conditionScores Record를 고정 차원 벡터로 변환 (조건 ID 1~27).
 * 없는 조건은 0으로 채운다.
 */
function toVector(scores: Record<number, number>): number[] {
  const vec: number[] = [];
  for (let id = 1; id <= 27; id++) {
    vec.push(scores[id] ?? 0);
  }
  return vec;
}

/**
 * 두 벡터의 코사인 유사도를 계산한다.
 * 영벡터가 포함되면 0을 반환한다.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ─── 핵심 공개 API ──────────────────────────────────────────────────────────────

export interface FailureWarning {
  /** 유사 실패 패턴 발견 여부 */
  hasWarning: boolean;
  /** 유사 패턴 수 */
  similarCount: number;
  /** 총 조회 패턴 수 */
  totalChecked: number;
  /** 최고 유사도 (0~1) */
  maxSimilarity: number;
  /** 경고 메시지 */
  message: string;
  /** 유사 패턴 중 가장 최근 손절 종목 */
  topMatches: Array<{
    stockName: string;
    stockCode: string;
    similarity: number;
    returnPct: number;
    exitDate: string;
  }>;
}

/**
 * 신규 진입 후보의 조건 벡터와 실패 패턴 DB를 비교하여 경고를 반환한다.
 *
 * @param candidateScores - 신규 후보의 27조건 점수 Record
 * @param patterns - (선택) 외부에서 주입하는 패턴 배열 (기본: 파일 로드)
 */
export function checkFailurePattern(
  candidateScores: Record<number, number>,
  patterns?: FailurePatternEntry[],
): FailureWarning {
  const db = patterns ?? loadFailurePatterns();

  if (db.length === 0) {
    return {
      hasWarning: false,
      similarCount: 0,
      totalChecked: 0,
      maxSimilarity: 0,
      message: '실패 패턴 DB 없음 — 손절 기록이 쌓이면 자동 경고가 활성화됩니다.',
      topMatches: [],
    };
  }

  const candidateVec = toVector(candidateScores);

  const matches = db
    .map((entry) => ({
      entry,
      similarity: cosineSimilarity(candidateVec, toVector(entry.conditionScores)),
    }))
    .filter((m) => m.similarity >= SIMILARITY_THRESHOLD)
    .sort((a, b) => b.similarity - a.similarity);

  const maxSimilarity = matches.length > 0 ? matches[0].similarity : 0;

  const topMatches = matches.slice(0, 3).map((m) => ({
    stockName: m.entry.stockName,
    stockCode: m.entry.stockCode,
    similarity: parseFloat((m.similarity * 100).toFixed(1)),
    returnPct: m.entry.returnPct,
    exitDate: m.entry.exitDate.slice(0, 10),
  }));

  const hasWarning = matches.length > 0;

  let message: string;
  if (!hasWarning) {
    message = `실패 패턴 DB ${db.length}건 중 유사 패턴 없음 — 진입 패턴 안전.`;
  } else {
    const topMatch = topMatches[0];
    message =
      `⚠️ 이 진입 패턴은 과거 ${db.length}건 중 ${matches.length}건 손절됨 ` +
      `(최고 유사도 ${topMatch.similarity}%). ` +
      `최근 사례: ${topMatch.stockName} (${topMatch.returnPct.toFixed(1)}% 손절, ${topMatch.exitDate})`;
  }

  return {
    hasWarning,
    similarCount: matches.length,
    totalChecked: db.length,
    maxSimilarity: parseFloat((maxSimilarity * 100).toFixed(1)),
    message,
    topMatches,
  };
}

/**
 * 손절된 포지션의 진입 스냅샷을 실패 패턴 DB에 저장한다.
 */
export function saveFailureSnapshot(entry: FailurePatternEntry): void {
  appendFailurePattern(entry);
  console.log(
    `[FailureDB] 저장: ${entry.stockName} (${entry.returnPct.toFixed(1)}%) → DB 업데이트`
  );
}

/**
 * 현재 저장된 실패 패턴 수를 반환한다.
 */
export function getFailurePatternCount(): number {
  return loadFailurePatterns().length;
}
