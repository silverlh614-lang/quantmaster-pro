// @responsibility Explain observed exit policies using recorded forward evidence.
import React from 'react';
import type { PaperAdaptiveExitPolicy, PaperExitLearningState, PaperExitProfileId } from '../../types/paperAdaptiveExit';

const names: Record<PaperExitProfileId, string> = { RESPONSIVE: '빠른 대응', BALANCED: '기본 대응', PATIENT: '여유 대응' };
const reasons: Record<PaperExitLearningState['reason'], string> = {
  INSUFFICIENT_TRAINING: '학습 관측 누적 중', INSUFFICIENT_VALIDATION: '후반 검증 누적 중',
  NO_TRAINING_EDGE: '학습에서 개선 미확인', NO_VALIDATION_EDGE: '후반 검증에서 개선 미확인', FORWARD_VALIDATED: '후반 검증 통과',
};
const pct = (value: number | null) => value === null ? '미집계' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%p`;

export function PaperExitPolicyDetails({ policy }: { policy: PaperAdaptiveExitPolicy }) {
  const p = policy.profile;
  return <div className="space-y-1 rounded-lg border border-slate-700 p-3 text-xs text-slate-300" aria-label="진입 당시 매도 기준">
    <p>{names[p.id]} · {policy.origin === 'FORWARD_LEARNED' ? '후속 관측 검증으로 선택' : '초기 탐색 기준 · 검증 전'}</p>
    <p>순손실 {p.stopLossPct}% · 순수익 {p.trailingArmPct}% 도달 후 관측 고점 대비 {p.trailingDrawdownPct}%p 반납</p>
    <p>진입 근거 약화: 서로 다른 원천 {p.signalFailureCount}회 · {p.signalFailureMinutes}분 이상. 같은 완료 일봉이나 결산 자료의 재조회는 반복 횟수로 세지 않습니다.</p>
    {policy.evidence && <p>후반 검증 {policy.evidence.validation.sampleCount}건/{policy.evidence.validation.dateCount}진입일 · D5 종가 대비 평균 {pct(policy.evidence.validation.meanAdvantagePct)}</p>}
  </div>;
}

export function PaperExitLearningPanel({ state }: { state?: PaperExitLearningState }) {
  return <section className="space-y-3 rounded-xl border border-sky-400/20 bg-sky-500/5 p-4" aria-label="매도 기준 학습">
    <h4 className="text-sm font-semibold text-sky-200">매도 기준 학습</h4>
    <p className="text-xs text-slate-300">{state ? reasons[state.reason] : '첫 평가 대기'} · {state?.selectedProfileId ? `${names[state.selectedProfileId]} 채택` : '기본 대응으로 탐색'}</p>
    <p className="text-xs text-slate-400">실제 청산 뒤에도 D5 비교 관측을 이어가 세 매도 기준을 같은 거래에서 평가합니다. 학습으로 고른 기준이 후반 기간에서도 개선되면 신규 거래에 적용합니다. D5 비교 종가는 가상 거래의 매도 지시가 아닙니다.</p>
    {state && <><p className="text-xs text-slate-300">비교 완료 {state.completedTradeCount}건 · {state.completedDateCount}진입일</p>
      <div className="space-y-2 text-xs text-slate-300">{state.candidates.map(item => <p key={item.profile.id}>{names[item.profile.id]}: 학습 {item.training.sampleCount}건/{item.training.dateCount}일 · 검증 {item.validation.sampleCount}건/{item.validation.dateCount}일 · 검증 D5 대비 {pct(item.validation.meanAdvantagePct)}</p>)}</div></>}
  </section>;
}
