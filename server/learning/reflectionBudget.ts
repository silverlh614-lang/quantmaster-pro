// @responsibility reflectionBudget 학습 엔진 모듈
/**
 * reflectionBudget.ts — Reflection Budget Governor (#15).
 *
 * 규칙 (예산 $20/월 기준 재조정 — 2026-04 업데이트):
 *   - 예산 0~85%  : FULL         — 매일 4~6회 Gemini 호출 (기본 모드).
 *   - 예산 85~95% : REDUCED_EOD  — 격일 (어제 실행했으면 오늘 skip).
 *   - 예산 95~100%: REDUCED_MWF  — 월·수·금만.
 *   - 예산 100%+  : TEMPLATE_ONLY — 로컬 RAG 템플릿 기반, Gemini 호출 0.
 *
 * 변경 이력:
 *   - 이전(예산 $5): 70% / 90% / 100% 임계값 → 월말 보호 과민 반응.
 *   - 현재(예산 $20): 85% / 95% / 100% 임계값 → FULL 가동 기간 연장.
 *     월말 L4 캘리브레이션은 pctUsed 85% 도달해도 예산 $3 여유 확보됨.
 *
 * Silence Monday:
 *   - 기본 비활성화 (SILENCE_MONDAY=false). 예산 여유로 매일 풀 반성 가동.
 *   - 주간 인지 과부하 시 SILENCE_MONDAY=true 로 재활성화 가능.
 *
 * 예산 소스:
 *   전역 Gemini 월 예산(geminiClient.ts::getBudgetState) 의 pctUsed 를 우선 사용.
 *   반성 엔진 자체 호출량만의 별도 회계는 reflectionRepo 의 reflection-budget.json 에 저장.
 *
 * 왜 두 개?
 *   - 전역 예산은 시스템 전체(스크리너·매크로 등)를 포함.
 *   - 반성 엔진은 "필수 소비"가 아니라 "성장 소비"이므로 전체 예산이 타이트할 때
 *     가장 먼저 절제 대상. 두 축 중 더 엄격한 모드를 채택한다.
 */

import { getBudgetState } from '../clients/geminiClient.js';
import {
  loadReflectionBudget,
  saveReflectionBudget,
  type ReflectionBudgetState,
} from '../persistence/reflectionRepo.js';
import type { ReflectionMode } from './reflectionTypes.js';

const MWF_DOWS = new Set([1, 3, 5]); // Mon, Wed, Fri (KST)

function kstWeekdayForDate(yyyymmdd: string): number {
  // 'YYYY-MM-DD' as UTC midnight → convert to KST calendar day
  // KST = UTC+9. 날짜 문자열 자체가 KST 기준이라고 전제 (nightlyReflectionEngine 에서 보장).
  const [y, m, d] = yyyymmdd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * 오늘 실행 모드를 결정한다.
 * @param dateKst YYYY-MM-DD (KST 기준)
 */
export function decideReflectionMode(dateKst: string): ReflectionMode {
  // Silence Monday — 기본 비활성화. SILENCE_MONDAY=true 면 재활성화.
  // 예산 $20 기준으로는 매일 풀 가동이 비용 감당 가능하므로 기본 OFF.
  const silenceMondayEnabled = (process.env.SILENCE_MONDAY ?? 'false').toLowerCase() === 'true';
  if (silenceMondayEnabled && kstWeekdayForDate(dateKst) === 1) return 'SILENCE_MONDAY';

  const budget = getBudgetState();
  const pct = Number.isFinite(budget.pctUsed) ? budget.pctUsed : 0;

  // 임계값 완화 (예산 $20 기준): 70/90/100 → 85/95/100
  if (pct >= 100) return 'TEMPLATE_ONLY';
  if (pct >= 95) {
    // MWF 축소
    return MWF_DOWS.has(kstWeekdayForDate(dateKst)) ? 'REDUCED_MWF' : 'TEMPLATE_ONLY';
  }
  if (pct >= 85) {
    // 격일 — 어제 실행했으면 skip → TEMPLATE_ONLY
    const state = loadReflectionBudget();
    if (state.lastReflectionDate) {
      const yesterday = shiftDate(dateKst, -1);
      if (state.lastReflectionDate === yesterday) return 'TEMPLATE_ONLY';
    }
    return 'REDUCED_EOD';
  }
  return 'FULL';
}

function shiftDate(yyyymmdd: string, days: number): string {
  const [y, m, d] = yyyymmdd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/**
 * 모드별 Gemini 호출 상한.
 *   FULL         = 메인(1) + 페르소나(4) + 5-Why 1거래(5) + 서사(1) = 11. 여유 1 포함 12.
 *   REDUCED_EOD  = 메인(1) + 페르소나(4) + 서사(1) = 6. 5-Why 생략 허용.
 *   REDUCED_MWF  = 메인(1) + 서사(1) + 페르소나 2명 = 4. 최소 기능.
 *   TEMPLATE_ONLY / SILENCE_MONDAY = 0.
 */
export function maxGeminiCalls(mode: ReflectionMode): number {
  switch (mode) {
    case 'FULL':           return 12;
    case 'REDUCED_EOD':    return 6;
    case 'REDUCED_MWF':    return 4;
    case 'TEMPLATE_ONLY':  return 0;
    case 'SILENCE_MONDAY': return 0;
  }
}

/** 당월 반성 엔진 소비 회계 갱신. */
export function recordReflectionCall(
  dateKst: string,
  tokensSpent: number,
): ReflectionBudgetState {
  const state = loadReflectionBudget();
  state.tokensUsed += Math.max(0, Math.round(tokensSpent));
  state.callCount += 1;
  state.lastReflectionDate = dateKst;
  saveReflectionBudget(state);
  return state;
}

/** 오늘 실행 완료 마킹 (Gemini 호출이 0건이어도 호출 — 격일 판정용). */
export function markReflectionRun(dateKst: string): void {
  const state = loadReflectionBudget();
  state.lastReflectionDate = dateKst;
  saveReflectionBudget(state);
}
