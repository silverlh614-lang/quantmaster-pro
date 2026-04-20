/**
 * reflectionBudget.ts — Reflection Budget Governor (#15).
 *
 * 규칙:
 *   - 예산 0~70%   : FULL       — 매일 4~6회 Gemini 호출.
 *   - 예산 70~90% : REDUCED_EOD — 격일 (어제 실행했으면 오늘 skip).
 *   - 예산 90~100%: REDUCED_MWF — 월·수·금만.
 *   - 예산 100%+  : TEMPLATE_ONLY — 로컬 RAG 템플릿 기반, Gemini 호출 0.
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
  // Silence Monday — 다른 규칙에 우선.
  if (kstWeekdayForDate(dateKst) === 1) return 'SILENCE_MONDAY';

  const budget = getBudgetState();
  const pct = Number.isFinite(budget.pctUsed) ? budget.pctUsed : 0;

  if (pct >= 100) return 'TEMPLATE_ONLY';
  if (pct >= 90) {
    // MWF 축소
    return MWF_DOWS.has(kstWeekdayForDate(dateKst)) ? 'REDUCED_MWF' : 'TEMPLATE_ONLY';
  }
  if (pct >= 70) {
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
