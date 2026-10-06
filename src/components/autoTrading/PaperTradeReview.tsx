// @responsibility Display historical trade performance with explicit evidence gaps.
import React, { useMemo, useState } from 'react';
import type { PaperStrategyTrade } from '../../types/paperStrategy';
import { buildTradeReview, tradePurpose, tradePurposeLabels, type TradePurpose } from '../../utils/paperTradeReview';

const pct = (value: number | null) => value === null ? '집계 대기' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
export function PaperTradeReview({ trades, totalCount, onSelect }: {
  trades: PaperStrategyTrade[]; totalCount: number; onSelect: (filter: { date?: string; rule?: string; purpose?: string }) => void;
}) {
  const [purpose, setPurpose] = useState('ALL');
  const [datePage, setDatePage] = useState(0), [rulePage, setRulePage] = useState(0);
  const review = useMemo(() => buildTradeReview(trades.filter(trade => purpose === 'ALL' || tradePurpose(trade) === purpose)), [trades, purpose]);
  if (trades.length !== totalCount) return <p role="status">거래 성적표 · 전체 원장 미조회로 집계를 보류합니다.</p>;
  const summary = review.summary;
  const page = (index: number, count: number) => Math.min(index, Math.max(0, Math.ceil(count / 10) - 1));
  const dateIndex = page(datePage, review.dates.length), ruleIndex = page(rulePage, review.rules.length);
  const pagination = (index: number, count: number, set: (value: number) => void, label: string) => count > 10 &&
    <div className="workspace-pagination"><span>{index + 1} / {Math.ceil(count / 10)}</span>
      <button type="button" className="workspace-button" disabled={!index} onClick={() => set(index - 1)}>이전 {label}</button>
      <button type="button" className="workspace-button" disabled={(index + 1) * 10 >= count} onClick={() => set(index + 1)}>다음 {label}</button></div>;
  return <section className="space-y-4 rounded-xl border border-slate-700/60 p-4" aria-label="거래 기록 성적표">
    <h4 className="font-semibold text-slate-200">거래 기록 성적표</h4>
    <p className="text-xs text-slate-400">원장 전체 기준 · 종목 검색과 별도 · 비용 차감 청산 수익률의 단순 평균입니다. 미청산은 승패에 포함하지 않으며 승률만으로 신호 정확도나 미래 수익을 확정하지 않습니다.</p>
    <div className="workspace-filters"><select aria-label="성적표 매수 목적" value={purpose} onChange={event => {
      setPurpose(event.target.value); setDatePage(0); setRulePage(0);
    }}><option value="ALL">전체 목적</option>{Object.entries(tradePurposeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
    <p className="text-sm">진입 {summary.totalCount}건 · 보유 {summary.openCount}건 · 청산 {summary.closedCount}건 · 결과 미확인 {summary.unknownCount}건</p>
    <p className="text-sm">승 {summary.winCount} · 패 {summary.lossCount} · 무 {summary.flatCount} · 승률 {pct(summary.winRatePct)} · 청산 평균 {pct(summary.meanNetReturnPct)}</p>
    <p className="text-sm">이익 거래 평균 {pct(summary.meanWinPct)} · 손실 거래 평균 {pct(summary.meanLossPct)}</p>
    <p className="text-xs text-amber-200">가격 경로 미기록 {summary.missingPathCount}건 · 중간부터 추적 {summary.partialPathCount}건. 경로가 있어도 모든 시점의 가격 수집을 보장하지 않습니다.</p>
    {!summary.totalCount && <p>선택한 목적의 거래 기록이 없습니다.</p>}
    <h5 className="font-semibold">진입일별 결과</h5>
    <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>
      {['진입일', '진행 상태', '진입 / 청산 / 보유 / 미확인', '청산 승률', '청산 평균'].map(label => <th className="p-2" key={label}>{label}</th>)}
    </tr></thead><tbody>{review.dates.slice(dateIndex * 10, dateIndex * 10 + 10).map(row => <tr key={row.date}>
      <td className="p-2"><button type="button" className="underline" onClick={() => onSelect({ date: row.date, purpose })}>{row.date} 거래 보기</button></td>
      <td className="p-2">{row.complete ? '청산 완료' : '잠정 · 진행/미확인'}</td><td className="p-2">{row.totalCount} / {row.closedCount} / {row.openCount} / {row.unknownCount}</td>
      <td className="p-2">{pct(row.winRatePct)}</td><td className="p-2">{pct(row.meanNetReturnPct)}</td></tr>)}</tbody></table></div>
    {pagination(dateIndex, review.dates.length, setDatePage, '진입일')}
    <h5 className="font-semibold">진입 당시 지표·버전별 결과</h5>
    <p className="text-xs text-slate-400">진입 구간·비교 기간·수식 생성 회차·매도 설정·비용이 다르면 분리합니다. 표본 수와 서로 다른 진입일 수를 함께 확인하세요. D5 차이는 비교 종가가 기록된 동일 거래만 대상으로 하며, 다른 종목 대비 우위나 최적 매도 성과를 뜻하지 않습니다.</p>
    <div className="grid gap-3 lg:grid-cols-2">{review.rules.slice(ruleIndex * 10, ruleIndex * 10 + 10).map(row => <article key={row.key} className="space-y-2 rounded-lg bg-slate-900/40 p-3 text-xs">
      <button type="button" className="text-left font-semibold underline" onClick={() => onSelect({ rule: row.key })}>{row.label} 거래 보기</button>
      <p>{tradePurposeLabels[row.purpose as TradePurpose]} · {row.version}</p>
      {row.bornAt && <p>수식 등록 {new Date(row.bornAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</p>}
      <details><summary>당시 매도·비용 설정</summary><p>{row.exitLabel}</p><p>{row.costLabel}</p></details>
      <p>진입 {row.totalCount}건 / {row.dateCount}일 · 청산 {row.closedCount} · 보유 {row.openCount} · 미확인 {row.unknownCount}</p>
      <p>승률 {pct(row.winRatePct)} · 청산 평균 {pct(row.meanNetReturnPct)}{!row.complete && ' · 잠정'}</p>
      <p>평균 이익 {pct(row.meanWinPct)} · 평균 손실 {pct(row.meanLossPct)}</p>
      <p>D5 보유 대비 청산 수익 차이 {row.d5DifferencePct === null ? '집계 대기' : `${row.d5DifferencePct.toFixed(2)}%p`} · 비교 완료 {row.d5Count}/{row.closedCount}건</p>
    </article>)}</div>
    {pagination(ruleIndex, review.rules.length, setRulePage, '지표')}
  </section>;
}
