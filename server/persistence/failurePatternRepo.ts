// server/persistence/failurePatternRepo.ts
// 반실패 패턴 DB — 손절된 포지션의 진입 스냅샷 저장소

import fs from 'fs';
import { FAILURE_PATTERN_FILE, ensureDataDir } from './paths.js';

/** 진입 당시 조건 스냅샷 — 27조건 충족 현황 + 부가 컨텍스트 */
export interface FailurePatternEntry {
  /** 고유 식별자 */
  id: string;
  /** 종목코드 */
  stockCode: string;
  /** 종목명 */
  stockName: string;
  /** 진입일 ISO 문자열 */
  entryDate: string;
  /** 손절일 ISO 문자열 */
  exitDate: string;
  /** 손실률 (%) — 음수 */
  returnPct: number;
  /** 27조건 점수 벡터 (conditionId → 점수 0-10), 코사인 유사도 기준 벡터로 사용 */
  conditionScores: Record<number, number>;
  /** Gate 1/2/3 점수 */
  gate1Score: number;
  gate2Score: number;
  gate3Score: number;
  finalScore: number;
  /** MTF 스코어 (0-100, 없으면 null) */
  mtfScore?: number | null;
  /** 시장 레짐 문자열 (예: 'R2_BULL') */
  marketRegime?: string | null;
  /** 섹터명 */
  sector?: string | null;
  /** 기록 시각 */
  savedAt: string;
}

export function loadFailurePatterns(): FailurePatternEntry[] {
  ensureDataDir();
  if (!fs.existsSync(FAILURE_PATTERN_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(FAILURE_PATTERN_FILE, 'utf-8')) as FailurePatternEntry[];
  } catch { return []; }
}

export function saveFailurePatterns(entries: FailurePatternEntry[]): void {
  ensureDataDir();
  // 최근 500건만 유지
  fs.writeFileSync(FAILURE_PATTERN_FILE, JSON.stringify(entries.slice(-500), null, 2));
}

export function appendFailurePattern(entry: FailurePatternEntry): void {
  const existing = loadFailurePatterns();
  // 동일 종목+진입일 중복 방지
  const deduped = existing.filter(
    (e) => !(e.stockCode === entry.stockCode && e.entryDate === entry.entryDate)
  );
  saveFailurePatterns([...deduped, entry]);
}
