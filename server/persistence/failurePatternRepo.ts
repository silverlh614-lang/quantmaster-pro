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
  /** Gate 2 통과 조건 수 (12개 기준) */
  gate2PassCount?: number | null;
  /** RS 상위 백분위 (%) — 낮을수록 강함, 예: 8 = 상위 8% */
  rsPercentile?: number | null;
  /** VKOSPI 수치 */
  vkospi?: number | null;
  /** MTF 스코어 (0-100, 없으면 null) */
  mtfScore?: number | null;
  /** 시장 레짐 문자열 (예: 'R2_BULL') */
  marketRegime?: string | null;
  /** 섹터명 */
  sector?: string | null;
  /** 기록 시각 */
  savedAt: string;
}

/**
 * 실패 패턴 TTL — savedAt 으로부터 이 일수가 지나면 active 조회에서 자동 제외.
 * 패턴 자체는 파일에 남지만 checkFailurePattern 의 매칭 후보로는 쓰이지 않아
 * "오래된 단일 사고로 학습된 패턴이 영구히 진입을 차단" 하는 회귀를 방지한다.
 * 0 이하로 설정하면 TTL 비활성 (기존 동작).
 */
const FAILURE_PATTERN_TTL_DAYS = Number(process.env.FAILURE_PATTERN_TTL_DAYS ?? '180');

/**
 * 활성 패턴만 로드 (TTL 이 지난 엔트리는 제외). 원본 파일은 건드리지 않음.
 */
export function loadFailurePatterns(): FailurePatternEntry[] {
  ensureDataDir();
  if (!fs.existsSync(FAILURE_PATTERN_FILE)) return [];
  let entries: FailurePatternEntry[] = [];
  try {
    entries = JSON.parse(fs.readFileSync(FAILURE_PATTERN_FILE, 'utf-8')) as FailurePatternEntry[];
  } catch { return []; }
  if (FAILURE_PATTERN_TTL_DAYS <= 0) return entries;
  const cutoff = Date.now() - FAILURE_PATTERN_TTL_DAYS * 24 * 3600 * 1000;
  return entries.filter(e => {
    const ts = Date.parse(e.savedAt);
    if (!Number.isFinite(ts)) return true; // savedAt 누락/손상 엔트리는 안전하게 유지
    return ts >= cutoff;
  });
}

/** TTL 무시하고 파일의 모든 엔트리 로드 (라우터 /failure-patterns/list 등 조회용). */
export function loadFailurePatternsRaw(): FailurePatternEntry[] {
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
