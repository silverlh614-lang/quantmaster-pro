// @responsibility Explain recommendation-to-trade application for one stock.
import React from 'react';
import { PAPER_MORNING_RESULT_LABELS, type PaperMorningPick, type PaperMorningResult } from '../../types/paperMorning';
import { paperAdaptiveRuleLabel } from '../../types/paperAdaptive';
import { PaperDetailDialog } from './PaperDetailDialog';
import { PaperRuleDetails } from './PaperRuleDetails';

const stamp = (at: string) => new Date(at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
export function PaperMorningDetail({ pick, result, onClose }: { pick: PaperMorningPick; result: PaperMorningResult; onClose: () => void }) {
  const application = result.application, policy = application?.exitPolicy, profile = policy?.profile;
  return <PaperDetailDialog title={`${pick.name} · 추천과 실제 적용`} subtitle={`${pick.symbol} · ${PAPER_MORNING_RESULT_LABELS[result.status]}`} onClose={onClose}>
    <PaperRuleDetails candidate={pick.candidate} exploration={pick.purpose === 'EXPLORATION'} observedValue={pick.ruleValue} />
    <section className="paper-detail-section"><h3>장중 매수에는 무엇이 적용됐나요?</h3>
      {result.entryAt ? <><p className="paper-detail-emphasis">{result.matchesEntryRule === true ? '추천과 같은 규칙으로 가상 매수했습니다.'
        : result.matchesEntryRule === false ? '추천과 다른 규칙으로 가상 매수했습니다.' : '진입 규칙 일치 여부를 확인할 수 없습니다.'}</p>
        <p>{result.entryPrice?.toLocaleString('ko-KR')}원 · {stamp(result.entryAt)}</p>
        <p>실제 진입 규칙: {application?.entryRule ? paperAdaptiveRuleLabel(application.entryRule) : '개별 지표 규칙 미기록 · 아래 진입 사유를 확인하세요.'}</p>
        <p>진입 사유: {result.entryReason ?? '미기록'}</p>
        <p className="paper-detail-note">진입 당시 저장한 규칙입니다. 현재 연구실에 연결된 지표와 다를 수 있습니다.</p></>
        : <><p className="paper-detail-emphasis">{result.status === 'UNSENT' ? '추천 발송이 확인되지 않았습니다.' : '이 추천에 연결된 가상 매수 기록이 없습니다.'}</p>
          <p>{result.lastDecision ? `마지막 장중 판단: ${result.lastDecision.reason} · ${stamp(result.lastDecision.decisionAt)}` : '당시 장중 판단은 미기록입니다. 현재 조건으로 과거 사유를 추정하지 않습니다.'}</p>
          <p className="paper-detail-note">추천은 후보 선정입니다. 장중의 새 관측으로 진입 조건을 다시 판단합니다.</p></>}
    </section>
    <section className="paper-detail-section"><h3>매도에는 어떤 기준을 적용하나요?</h3>
      {!result.entryAt ? <p>아직 이 추천에 연결된 거래가 없어 적용된 매도 정책이 없습니다.</p>
        : application?.exitModel === 'ADAPTIVE_OBSERVED' && profile ? <>
          <p className="paper-detail-emphasis">{policy?.origin === 'FORWARD_LEARNED' ? '후속 관측 검증으로 선택한 매도 기준' : '초기 탐색 매도 기준 · 성과 검증 전'}</p>
          <ul><li>순손실 {profile.stopLossPct}%에 도달하면 매도 판단</li>
            <li>순수익 {profile.trailingArmPct}% 이상을 관측한 뒤, 관측 고점에서 {profile.trailingDrawdownPct}%p 반납하면 매도 판단</li>
            <li>진입 근거가 서로 다른 원천에서 {profile.signalFailureCount}회 불일치하고 {profile.signalFailureMinutes}분 이상 지속되면 매도 판단</li></ul>
          <p className="paper-detail-note">유효한 새 가격을 관측할 때 판단합니다. D1·D3·D5 도달만으로 강제 매도하지 않습니다.</p></>
          : application?.exitModel === 'SCHEDULED_CLOSE' ? <p className="paper-detail-emphasis">기존 예약 청산 거래입니다. 진입 당시 정한 {stamp(application.scheduledExitAt)}의 확정 종가로 청산합니다.</p>
            : <p>진입 당시의 매도 정책 상세 기록을 확인할 수 없습니다.</p>}
      {result.exitAt && <><p>실제 가상 매도 {result.exitPrice?.toLocaleString('ko-KR')}원 · {stamp(result.exitAt)}</p>
        <p>발동 사유: {result.exitReason ?? '미기록'}</p><p>확정 순수익률 {result.netReturnPct?.toFixed(2)}% · 비용 반영</p></>}
    </section>
  </PaperDetailDialog>;
}
