// @responsibility Present the autonomous research lifecycle.
import React from 'react';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { PAPER_ADAPTIVE_REASON_LABELS, type PaperAdaptiveCandidate, type PaperAdaptiveRule, type PaperAdaptiveState } from '../../types/paperAdaptive';
import { PAPER_FEATURES, type PaperFeatureKey } from '../../types/paperObservationFeatures';
import { PAPER_INVENTED_FEATURE_CUTS, paperIndicatorFormulaLabel } from '../../types/paperIndicatorFormula';
import '../../styles/paperResearchBoard.css';

const featureNames: Record<PaperFeatureKey, string> = {
  rsi14: 'RSI 14', rsiChange5: 'RSI 변화', volumeRatio20: '거래량 비율', turnover20: '평균 거래대금',
  return20: '20일 수익률', peerRelative20: '관측군 대비 수익률', ma20Gap: '20일선 이격', ma60Gap: '60일선 이격',
  ma20Slope5: '20일선 기울기', high20Gap: '20일 고가 이격', gapPct: '시가 갭', atr14Pct: '가격 변동폭',
  adx14: '추세 강도', macdHistogramPct: 'MACD 히스토그램', bollingerB: '볼린저 위치', stochasticK14: '스토캐스틱',
  per: 'PER', pbr: 'PBR', revenueGrowth: '매출 성장률', operatingMargin: '영업이익률', netMargin: '순이익률',
  roe: 'ROE', debtRatio: '부채비율', currentRatio: '유동비율', operatingCashFlowSign: '영업현금흐름 부호', equityRatio: '자기자본 비율',
};
const number = (value: number | undefined) => value === undefined ? '—' : value.toLocaleString('ko-KR');
const percent = (value: number | null, unit = '%') => value === null ? '집계 대기' : `${value > 0 ? '+' : ''}${value.toFixed(2)}${unit}`;
const time = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('ko-KR', {
  timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
}) : '시각 미확인';

function ruleName(rule: PaperAdaptiveRule): string {
  const formula = rule.invention?.formula;
  if (!formula) return featureNames[rule.feature as PaperFeatureKey] ?? '지표';
  const left = featureNames[formula.left.feature], right = featureNames[formula.right.feature];
  return formula.operation === 'MEAN' ? `${left} · ${right} 평균`
    : `${left} ${formula.operation === 'PRODUCT' ? '×' : '−'} ${right}`;
}
function ruleRange(rule: PaperAdaptiveRule): string {
  const definition = rule.invention ? { cuts: PAPER_INVENTED_FEATURE_CUTS, unit: '' }
    : PAPER_FEATURES[rule.feature as PaperFeatureKey];
  const cuts: readonly number[] = definition.cuts;
  const lower = cuts[rule.bucket - 1], upper = cuts[rule.bucket];
  return lower === undefined ? `${upper}${definition.unit} 미만`
    : upper === undefined ? `${lower}${definition.unit} 이상` : `${lower} 이상 · ${upper}${definition.unit} 미만`;
}

function ActiveRule({ candidate }: { candidate: PaperAdaptiveCandidate }) {
  const { rule, validation } = candidate, invention = rule.invention;
  return <li className={`lab-board-rule${invention ? ' lab-board-rule-invented' : ''}`}>
    <div className="lab-board-rule-heading">
      <div className="lab-board-rule-tags"><span>{invention ? '발명 지표' : '기본 지표'}</span><span>D{rule.horizon}</span></div>
      <h4>{ruleName(rule)}</h4>
      <p>{ruleRange(rule)} · {rule.horizon}거래일 보유</p>
    </div>
    <dl className="lab-board-rule-stats">
      <div><dt>평균 순수익률</dt><dd>{percent(validation.meanNetReturnPct)}</dd></div>
      <div><dt>일당 대조군 차이</dt><dd>{percent(validation.meanDailyExcessPct, '%p')}</dd></div>
    </dl>
    <div className="lab-board-rule-evidence"><span>{invention ? '생성 후 검증' : '후반 검증'}</span>
      <span>{number(validation.sampleCount)}건 · {number(validation.dateCount)}진입일 · {number(validation.symbolCount)}종목</span></div>
    {invention && <details className="lab-board-formula"><summary>수식 보기</summary>
      <div><p>{paperIndicatorFormulaLabel(invention.formula)}</p>
        <p>{[invention.formula.left, invention.formula.right].map(operand =>
          `N(${featureNames[operand.feature]}) = (값 − ${operand.center}) / ${operand.scale}`).join(' · ')}. 각 값은 −3~3으로 제한합니다.</p>
        <p>생성 <time dateTime={invention.createdAt}>{time(invention.createdAt)} KST</time> · 생성 이후 새 관측으로 검증한 결과입니다.</p>
      </div>
    </details>}
  </li>;
}

function changeLabel(change: PaperAdaptiveState['changes'][number]) {
  if (change.reason === 'FORWARD_OBSERVATION' && !change.from && change.to) return { label: '지표 생성', tone: 'invented' };
  if (change.reason === 'DISCOVERY_RETIRED') return { label: '연구 종료', tone: 'muted' };
  if (change.from && change.to) return { label: '규칙 교체', tone: 'active' };
  return change.to ? { label: '매수 연결', tone: 'active' } : { label: '연결 해제', tone: 'muted' };
}

export function PaperResearchBoard({ state, unavailable = false }: { state?: PaperAdaptiveState; unavailable?: boolean }) {
  const setView = useSettingsStore(value => value.setView);
  const current = unavailable ? undefined : state;
  const active = current?.candidates.filter(item => item.active);
  const discovery = current?.discovery;
  const pending = discovery ? current!.candidates.filter(item => item.rule.invention && item.reason === 'FORWARD_OBSERVATION').length : undefined;
  const changes = [...(state?.changes ?? [])].reverse().sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5);
  const stages = [
    { label: '기본 지표', value: Object.keys(PAPER_FEATURES).length, note: '정의된 연구 재료', tone: 'base' },
    { label: '검토한 수식', value: discovery?.attemptedIds.length, note: discovery ? `이번 ${discovery.round}차 탐색` : '연구 기록 확인 대기', tone: 'research' },
    { label: '새 관측으로 검증', value: pending, note: discovery ? '생성 후 관측 중인 지표' : '연구 기록 확인 대기', tone: 'invented' },
    { label: '매수에 채택', value: active?.length, note: current ? `최대 ${current.policy.maxActiveRules}개 · 독립 판단` : '채택 상태 확인 대기', tone: 'active' },
  ];
  return <section className="lab-board" aria-labelledby="lab-board-title">
    <header className="lab-board-heading">
      <div><span className="lab-board-eyebrow">AUTONOMOUS RESEARCH</span><h2 id="lab-board-title">자율 연구실</h2>
        <p>지표를 조합하고, 새 관측으로 검증해 매수 판단에 연결합니다.</p></div>
      <div className="lab-board-evaluation">
        <span className={`lab-board-round${unavailable ? ' lab-board-round-unavailable' : ''}`}>{unavailable ? '상태 확인 필요' : discovery ? `탐색 ${discovery.round}차` : '연구 기록 대기'}</span>
        {state && <span><time dateTime={state.evaluatedAt}>{time(state.evaluatedAt)}</time> KST {unavailable ? '저장 기록' : '평가'}</span>}
      </div>
    </header>
    {unavailable && <p role="alert" className="lab-board-alert">연구 상태를 불러오지 못했습니다. 현재 채택 지표는 다시 확인되면 표시합니다.</p>}
    <ol className="lab-board-pipeline" aria-label="자율 연구 단계">
      {stages.map((stage, index) => <li className={`lab-board-stage lab-board-stage-${stage.tone}`} key={stage.label}>
        <div className="lab-board-stage-heading"><span className="lab-board-stage-index">0{index + 1}</span><h3>{stage.label}</h3></div>
        <strong aria-label={`${stage.label} ${stage.value === undefined ? '확인 대기' : `${stage.value}개`}`}>{number(stage.value)}{stage.value !== undefined && <small>개</small>}</strong>
        <p>{stage.note}</p>{index < stages.length - 1 && <ArrowRight size={14} className="lab-board-stage-arrow" aria-hidden="true" />}
      </li>)}
    </ol>
    <div className="lab-board-body">
      <div className="lab-board-connections">
        <div className="lab-board-section-heading"><h3>매수에 연결된 지표</h3>{active && <span>현재 {active.length}개</span>}</div>
        {active?.length ? <ul className="lab-board-rule-list" aria-label="현재 채택 지표">{active.slice(0, 3).map(candidate =>
          <ActiveRule key={candidate.rule.feature} candidate={candidate} />)}</ul>
          : <div className="lab-board-empty">
            <span className="lab-board-empty-line" aria-hidden="true"><i /><i /><i /></span>
            <h4>{unavailable ? '채택 상태를 확인할 수 없습니다' : current ? '아직 연결된 지표가 없습니다' : '첫 연구 결과를 기다립니다'}</h4>
            <p>{unavailable ? '저장된 변경 이력과 현재 상태를 구분해 확인하세요.' : '매수를 기다리는 동안에도 기본 관측과 성과 누적은 이어집니다.'}</p>
          </div>}
        <button type="button" className="lab-board-link" onClick={() => setView('PAPER_STRATEGY')}>전체 지표와 채택 근거 <ArrowUpRight size={15} aria-hidden="true" /></button>
      </div>
      <aside className="lab-board-history" aria-label={unavailable ? '저장된 연구 변경 이력' : '최근 연구 변경 이력'}>
        <div className="lab-board-section-heading"><h3>{unavailable ? '저장된 변경 이력' : '최근 연구 기록'}</h3><span>최근 {changes.length}건</span></div>
        {changes.length ? <ol className="lab-board-timeline">{changes.map((change, index) => {
          const event = changeLabel(change), rule = change.to ?? change.from;
          return <li className={`lab-board-event lab-board-event-${event.tone}`} key={`${change.at}:${change.feature}:${index}`}>
            <div className="lab-board-event-heading"><span>{event.label}</span><time dateTime={change.at}>{time(change.at)}</time></div>
            <p>{rule ? ruleName(rule) : '지표'}</p><small>{PAPER_ADAPTIVE_REASON_LABELS[change.reason]}</small>
          </li>;
        })}</ol> : <div className="lab-board-history-empty"><p>아직 연구 변경 기록이 없습니다.</p><span>지표 생성과 연결·해제 시점이 이곳에 쌓입니다.</span></div>}
      </aside>
    </div>
  </section>;
}
