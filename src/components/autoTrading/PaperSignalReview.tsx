// @responsibility Display frozen entry signal profitability with matched comparison evidence.
import React, { useMemo, useState } from 'react';
import type { PaperStrategyScreenView, PaperStrategyEdge } from '../../types/paperStrategy';
import { PAPER_ADAPTIVE_REASON_LABELS, paperAdaptiveRuleLabel } from '../../types/paperAdaptive';
import { buildSignalReview, tradePurpose, tradePurposeLabels } from '../../utils/paperTradeReview';

const pct = (value: number | null, unit = '%') => value === null ? '집계 대기' : `${value > 0 ? '+' : ''}${value.toFixed(2)}${unit}`;
const edge = (value?: PaperStrategyEdge) => value ? `${pct(value.edgePct, '%p')} · ${value.tradeCount}건 / ${value.dateCount}일` : '비교 자료 미조회';
export function PaperSignalReview({ view, onSelect }: { view: PaperStrategyScreenView; onSelect: (key: string) => void }) {
  const [purpose, setPurpose] = useState('VALIDATED');
  const [page, setPage] = useState(0);
  const signals = useMemo(() => buildSignalReview(view.trades.filter(trade => tradePurpose(trade) === purpose), view.adaptive), [view.trades, view.adaptive, purpose]);
  const comparisons = useMemo(() => new Map(view.selection?.adaptive?.signals?.map(row => [row.key, row])), [view.selection]);
  const index = Math.min(page, Math.max(0, Math.ceil(signals.length / 8) - 1));
  if (view.trades.length !== view.totalCount) return <p role="status">신호별 성과 · 전체 원장 미조회로 집계를 보류합니다.</p>;
  return <section aria-label="신호별 수익성" className="space-y-4 rounded-xl border border-sky-500/30 p-4">
    <h4 className="font-semibold text-sky-200">어떤 신호가 이익을 냈나</h4>
    <p className="text-xs text-slate-400">실제 가상 진입이 있었던 신호를 진입 구간·비교 기간·수식 버전별로 묶습니다. 청산 평균 순수익률 내림차순이며, 미래 성과나 통계적 유의성 순위가 아닙니다.</p>
    <div className="workspace-filters"><select aria-label="신호 성과 매수 목적" value={purpose} onChange={event => { setPurpose(event.target.value); setPage(0); }}>
      {Object.entries(tradePurposeLabels).map(([key, label]) => <option key={key} value={key}>{label}{key === 'EXPLORATION' ? ' · 검증 전' : ''}</option>)}
    </select><span className="text-xs">{signals.length}개 신호</span></div>
    <p className="text-xs text-slate-400">청산 평균은 거래마다 같은 비중이며 보유·결과 미확인은 제외합니다. 종목 선택 효과는 동일 진입일 미매수·미보유 후보와 D5 관측 수익을 비교하고, 매도 효과는 같은 거래를 D5까지 보유한 경우와 비교합니다. 두 효과는 비교 가능한 진입일마다 같은 비중으로 계산합니다.</p>
    {!signals.length && <p>선택한 목적의 진입 신호 기록이 없습니다.</p>}
    <div className="grid gap-3 lg:grid-cols-2">{signals.slice(index * 8, index * 8 + 8).map(row => {
      const comparison = comparisons.get(row.key);
      return <article key={row.key} aria-label={`${row.label} 신호 성과`} className="space-y-2 rounded-lg bg-slate-900/50 p-3 text-xs">
        <h5 className="font-semibold">{row.label}</h5>
        <p>{tradePurposeLabels[row.purpose]} · {row.status} · {row.version}</p>
        {row.bornAt && <p>수식 등록 {new Date(row.bornAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</p>}
        <p className="text-base font-semibold">청산 평균 순수익률 {pct(row.meanNetReturnPct)}{!row.complete && ' · 잠정'}</p>
        <p>평균 이익 {pct(row.meanWinPct)} · 평균 손실 {pct(row.meanLossPct)} · 승률 {pct(row.winRatePct)}</p>
        <p>진입 {row.totalCount}건 / {row.dateCount}일 · 청산 {row.closedCount}건 / 진입 {row.closedDateCount}일 · 보유 {row.openCount} · 결과 미확인 {row.unknownCount}</p>
        <p>종목 선택 효과 {edge(comparison?.entry)}</p><p>매도 효과 {edge(comparison?.exit)}</p>
        <details><summary>매도·비용 설정별 성과 ({row.settings.length}종)</summary>
          <p>위 신호 평균에는 아래 설정의 거래가 함께 포함됩니다.</p>
          {row.settings.map(setting => <div key={setting.key} className="my-2 border-t border-slate-700 pt-2">
            <p>{setting.exitLabel}</p><p>{setting.costLabel}</p>
            <p>청산 평균 {pct(setting.meanNetReturnPct)} · 청산 {setting.closedCount}건 / 진입 {setting.dateCount}일 · 보유 {setting.openCount}건</p>
          </div>)}
        </details>
        <details><summary>최근 연결 변화와 이후 진입 결과</summary>
          {row.change && row.afterChange ? <>
            <p>{new Date(row.change.at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} · {PAPER_ADAPTIVE_REASON_LABELS[row.change.reason]}</p>
            <p>{row.change.from ? paperAdaptiveRuleLabel(row.change.from) : '미연결'} → {row.change.to ? paperAdaptiveRuleLabel(row.change.to) : '미연결'}</p>
            <p>변경 시각 이후 진입 {row.afterChange.totalCount}건 · 청산 {row.afterChange.closedCount}건 · 보유 {row.afterChange.openCount}건 · 청산 평균 {pct(row.afterChange.meanNetReturnPct)}</p>
          </> : <p>보관된 연결 변경 기록이 없습니다.</p>}
          <p>보관 중인 가장 최근 변경 기준입니다. 변경 효과의 인과 검증이나 어제 전체 상태의 복원은 아닙니다.</p>
        </details>
        <button type="button" className="underline" onClick={() => onSelect(row.key)}>이 신호의 원본 거래 보기</button>
      </article>;
    })}</div>
    {signals.length > 8 && <div className="workspace-pagination"><span>{index + 1} / {Math.ceil(signals.length / 8)}</span>
      <button type="button" disabled={!index} onClick={() => setPage(index - 1)}>이전 신호</button>
      <button type="button" disabled={(index + 1) * 8 >= signals.length} onClick={() => setPage(index + 1)}>다음 신호</button></div>}
  </section>;
}
