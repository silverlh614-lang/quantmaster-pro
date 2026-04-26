// @responsibility experimentalConditionRepo 영속화 저장소 모듈
/**
 * experimentalConditionRepo.ts — 아이디어 6 (Phase 3): Gemini 제안 조건의 A/B 레지스터.
 *
 * conditionAuditor.proposeNewConditions() 가 Gemini 로부터 JSON 구조화 후보를
 * 받으면 이 저장소에 PROPOSED 상태로 기록한다. L4 말미에 backtest 단계가
 * 실행되어 lift/표본 기준에 따라 BACKTESTED_PASSED / BACKTESTED_FAILED 로
 * 전이하고, 수동 승인 시에만 ACTIVE 가 된다.
 *
 * 파일 포맷: JSON 배열, 최근 100건 보관.
 */

import fs from 'fs';
import { EXPERIMENTAL_CONDITIONS_FILE, ensureDataDir } from './paths.js';

export type ExperimentalStatus =
  | 'PROPOSED'
  | 'BACKTESTED_PASSED'
  | 'BACKTESTED_FAILED'
  | 'ACTIVE'
  | 'REJECTED';

export interface ExperimentalCondition {
  id: string;
  /** Gemini 제안 한글/영문 조건명 */
  name: string;
  /** 어떤 데이터 소스로 측정 가능한지 (예: 'DART', 'KIS', 'YAHOO') */
  dataSource: string;
  /** Gemini 가 제안한 수치 임계값 — 수식형은 formula 에 기록 */
  threshold?: number;
  /** 수식/조건식 (예: "OCF/NetIncome > 1.2") */
  formula?: string;
  /** 제안 근거 요약 */
  rationale: string;
  /** PROPOSED 시각 ISO */
  proposedAt: string;
  status: ExperimentalStatus;
  /** Gemini 가 양성으로 분류한 과거 WIN 거래 stockCode 목록 */
  passingWinCodes?: string[];
  /** Gemini 가 양성으로 분류한 과거 LOSS/EXPIRED 거래 stockCode 목록 */
  passingLossCodes?: string[];
  /** 백테스트 결과 */
  backtestResult?: {
    precision:     number;  // TP / (TP + FP)
    lift:          number;  // precision / baselineWinRate
    sampleSize:    number;  // TP + FP
    baselineWR:    number;  // 전체 WIN 률
    decidedAt:     string;
  };
}

export function loadExperimentalConditions(): ExperimentalCondition[] {
  ensureDataDir();
  if (!fs.existsSync(EXPERIMENTAL_CONDITIONS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(EXPERIMENTAL_CONDITIONS_FILE, 'utf-8')) as ExperimentalCondition[];
  } catch {
    return [];
  }
}

export function saveExperimentalConditions(list: ExperimentalCondition[]): void {
  ensureDataDir();
  fs.writeFileSync(
    EXPERIMENTAL_CONDITIONS_FILE,
    JSON.stringify(list.slice(-100), null, 2),
  );
}

export function appendExperimentalCondition(c: ExperimentalCondition): void {
  const list = loadExperimentalConditions();
  list.push(c);
  saveExperimentalConditions(list);
}

export function updateExperimentalCondition(
  id: string,
  patch: Partial<ExperimentalCondition>,
): boolean {
  const list = loadExperimentalConditions();
  const idx = list.findIndex((c) => c.id === id);
  if (idx < 0) return false;
  list[idx] = { ...list[idx], ...patch };
  saveExperimentalConditions(list);
  return true;
}
