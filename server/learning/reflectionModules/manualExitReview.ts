/**
 * @responsibility 오늘 수동 청산 레코드를 일별·7일·30일 통계 스냅샷으로 구조화한다.
 *
 * manualExitReview.ts — P2 #15: 매일 19:00 반성 의무 분석.
 *
 * 수동 청산(/sell·UI 매도)이 쌓이기 시작하면 "사용자가 기계를 추월한 경향" 을 구조화한
 * 스냅샷으로 보관해야 심리 온도계·행동 경보·주간 리포트가 1-소스로 소비할 수 있다.
 *
 * 결정적 함수 (Gemini 호출 0). 오늘 집계 + 7/30 일 롤링 카운트 + 편향 평균 플래그.
 */

import type { ManualExitRecord } from '../../persistence/manualExitsRepo.js';
import type { ManualExitReview } from '../reflectionTypes.js';

export interface BuildManualExitReviewInputs {
  dateKst: string;
  today:   ManualExitRecord[];
  rolling7d:  ManualExitRecord[];
  rolling30d: ManualExitRecord[];
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(3));
}

export function buildManualExitReview(inputs: BuildManualExitReviewInputs): ManualExitReview {
  const { dateKst, today, rolling7d, rolling30d } = inputs;
  const count = today.length;

  const reasonBreakdown: Record<string, number> = {};
  for (const r of today) {
    const key = r.context.reasonCode ?? 'USER_OTHER';
    reasonBreakdown[key] = (reasonBreakdown[key] ?? 0) + 1;
  }

  const regrets = today.map((r) => r.context.biasAssessment.regretAvoidance ?? 0);
  const endows  = today.map((r) => r.context.biasAssessment.endowmentEffect ?? 0);
  const panics  = today.map((r) => r.context.biasAssessment.panicSelling ?? 0);
  const avgBias = {
    regretAvoidance: avg(regrets),
    endowmentEffect: avg(endows),
    panicSelling:    avg(panics),
  };

  // 기계 대기 규칙 괴리: activeRule 이 있는데 사용자가 먼저 닫았거나,
  // distanceToStop ≤ 0 (이미 손절선 하회 상태) 에서만 기계가 실행했어야 할 경우.
  const machineDivergenceCount = today.filter((r) => {
    const v = r.context.currentMachineVerdict;
    const activeRuleWaiting = Boolean(v.activeRule);
    const stopApproach = v.distanceToStop <= 1.5; // 1.5% 이내면 기계가 곧 집행했을 것
    return activeRuleWaiting || stopApproach;
  }).length;

  const avgDistanceToStop   = avg(today.map((r) => r.context.currentMachineVerdict.distanceToStop));
  const avgDistanceToTarget = avg(today.map((r) => r.context.currentMachineVerdict.distanceToTarget));

  const flags: string[] = [];
  if (avgBias.regretAvoidance >= 0.5) flags.push(`후회회피 ${avgBias.regretAvoidance.toFixed(2)}`);
  if (avgBias.endowmentEffect >= 0.5) flags.push(`보유효과 ${avgBias.endowmentEffect.toFixed(2)}`);
  if (avgBias.panicSelling    >= 0.5) flags.push(`패닉매도 ${avgBias.panicSelling.toFixed(2)}`);
  if (count >= 3) flags.push(`오늘 ${count}회`);
  if (rolling7d.length >= 5) flags.push(`7일 ${rolling7d.length}회`);
  if (rolling30d.length >= 7) flags.push(`30일 ${rolling30d.length}회`);

  return {
    date: dateKst,
    count,
    reasonBreakdown,
    avgBias,
    machineDivergenceCount,
    avgDistanceToStop,
    avgDistanceToTarget,
    rolling7dCount:  rolling7d.length,
    rolling30dCount: rolling30d.length,
    flags,
  };
}
