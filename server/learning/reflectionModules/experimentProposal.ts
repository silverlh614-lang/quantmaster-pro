/**
 * experimentProposal.ts — Automatic Experiment Proposal (#12).
 *
 * 반성 결과에서 "내일 테스트해볼 변경" 을 자동 제안.
 *
 * 트랙:
 *   - 🟡 YELLOW_AUTO  : 가중치 감쇠 등 낮은 위험 실험. 24h 내 참뮌 응답 없으면 자동 시작.
 *   - 🔴 RED_APPROVE  : Gate 1 계층 변경 등 고위험. 반드시 명시 승인.
 *
 * 소스:
 *   - conditionConfession 만성 조건 → 가중치 -15% 감쇠 실험 제안 (🟡)
 *   - Sharpe 급락 경보 → 샘플 50% 감쇠 실험 (🟡)
 *   - 새 조건 도입 / Gate 순서 변경 → 🔴
 *
 * 승격:
 *   - YELLOW_AUTO + autoStartAt 경과 → state = AUTO_STARTED
 *   - RED_APPROVE 는 사람 개입 전까지 AWAIT_APPROVAL 유지.
 */

import {
  loadExperimentProposals,
  upsertExperimentProposal,
} from '../../persistence/reflectionRepo.js';
import type {
  ConditionConfessionEntry,
  ExperimentProposal,
} from '../reflectionTypes.js';

const AUTO_START_DELAY_HOURS = 24;

function nowIso(): string { return new Date().toISOString(); }
function addHoursIso(iso: string, hours: number): string {
  const d = new Date(iso);
  d.setUTCHours(d.getUTCHours() + hours);
  return d.toISOString();
}

function newProposalId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export interface ProposalInputs {
  /** 오늘 만성 조건 (#6) */
  chronicConditions: number[];
  /** 오늘 참회록 상위 (#6) */
  confession: ConditionConfessionEntry[];
  /** 손절 비율 (오늘 HIT_STOP / 전체 종결) — 0~1 */
  lossRatio: number;
  /** 오늘 폐업/정지된 조건 (#6 연속 3일 만성 도달 등) */
  suspendedConditions?: number[];
}

/**
 * 오늘 데이터로 새 실험 제안들을 생성하고 레지스터에 upsert.
 * 기존 동일 ID 는 중복 등록되지 않는다 (일일 멱등성 보장).
 * @returns 방금 생성/갱신된 제안 목록.
 */
export function proposeExperiments(inputs: ProposalInputs): ExperimentProposal[] {
  const now = nowIso();
  const autoStartAt = addHoursIso(now, AUTO_START_DELAY_HOURS);
  const out: ExperimentProposal[] = [];

  // 🟡 만성 조건 가중치 감쇠
  for (const condId of inputs.chronicConditions) {
    const id = `exp_w_decay_c${condId}_${now.slice(0, 10)}`;
    const proposal: ExperimentProposal = {
      id,
      proposedAt: now,
      hypothesis: `조건 ${condId} 가중치 -15% 감쇠 시 승률 상승 예상`,
      rationale: '3일 연속 참회록 등재 — 음수 기여 시그널',
      method: 'A/B — 새 Shadow 신호 중 50%만 감쇠 적용',
      terminationCondition: '5건 누적 후 통계 비교 (Welch t-test p<0.10)',
      track: 'YELLOW_AUTO',
      state: 'PROPOSED',
      autoStartAt,
    };
    upsertExperimentProposal(proposal);
    out.push(proposal);
  }

  // 🔴 손절 비율 과다 — Gate 1 최소 조건 상향 제안 (예: Gate 1 threshold +0.05)
  if (inputs.lossRatio >= 0.6 && inputs.confession.length >= 2) {
    const id = `exp_gate1_raise_${now.slice(0, 10)}`;
    const proposal: ExperimentProposal = {
      id,
      proposedAt: now,
      hypothesis: 'Gate 1 통과 기준 +0.05 상향 시 손절 비율 감소 예상',
      rationale: `오늘 손절 비율 ${(inputs.lossRatio * 100).toFixed(1)}% + 참회 조건 ${inputs.confession.length}건`,
      method: 'Gate 1 최소 스코어 임계값 0.60 → 0.65 변경',
      terminationCondition: '7 영업일 누적 후 승률·Sharpe 비교',
      track: 'RED_APPROVE',
      state: 'AWAIT_APPROVAL',
    };
    upsertExperimentProposal(proposal);
    out.push(proposal);
  }

  return out;
}

/**
 * autoStartAt 경과한 YELLOW_AUTO 제안을 AUTO_STARTED 로 승격.
 * Phase 4 MVP: 상태만 전환한다. 실제 A/B 파라미터 적용은 Phase 5 에서 conditionAuditor 와 통합.
 */
export function promoteYellowExperiments(nowDate: Date = new Date()): ExperimentProposal[] {
  const now = nowDate.toISOString();
  const all = loadExperimentProposals();
  const promoted: ExperimentProposal[] = [];
  for (const p of all) {
    if (p.track !== 'YELLOW_AUTO') continue;
    if (p.state !== 'PROPOSED') continue;
    if (!p.autoStartAt || p.autoStartAt > now) continue;
    p.state = 'AUTO_STARTED';
    upsertExperimentProposal(p);
    promoted.push(p);
  }
  return promoted;
}
