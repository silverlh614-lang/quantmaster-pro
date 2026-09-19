// @responsibility Display independent observation feature research.
import React, { useState } from 'react';
import { Section } from '../../ui/section';
import { PAPER_FEATURES, type PaperFeatureKey, type PaperFeatureCoverage, type PaperFeatureStudy, type PaperObservationFeatures } from '../../types/paperObservationFeatures';

const pct = (n: number | null) => n === null ? '집계 대기' : `${n.toFixed(2)}%`;
export function PaperFeatureDetails({ features }: { features?: PaperObservationFeatures }) {
  if (!features) return <div className="text-xs text-slate-400">추가 조건 미기록</div>;
  return <details className="mt-2 text-xs text-slate-300"><summary className="cursor-pointer">동시 관측 조건 보기</summary>
    <p>완료 일봉 {features.technicalDate ?? '미확인'}</p>
    <p>KIS 결산 {features.financials?.kis?.period ?? '미확인'} · 손익 {features.financials?.kis?.incomePeriod ?? '미확인'} · 유동성 {features.financials?.kis?.stabilityPeriod ?? '미확인'}</p>
    <p>DART {features.financials?.dart?.period ?? '미확인'} · {features.financials?.dart?.statement === 'CFS' ? '연결' : features.financials?.dart?.statement === 'OFS' ? '별도' : '재무제표 미확인'}</p>
    <p>재무 확인 시각 {features.financials?.observedAt ? new Date(features.financials.observedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '미확인'}</p>
    {(Object.keys(PAPER_FEATURES) as PaperFeatureKey[]).map(key => <p key={key}>{PAPER_FEATURES[key].label}: {typeof features.values[key] === 'number' ? `${features.values[key]!.toFixed(2)}${PAPER_FEATURES[key].unit}` : '미확인'}</p>)}
  </details>;
}
export function PaperFeaturePanel({ coverage, study }: { coverage?: PaperFeatureCoverage; study?: PaperFeatureStudy }) {
  const [key, setKey] = useState<PaperFeatureKey>('rsi14');
  const selected = study?.features.find(item => item.key === key);
  return <Section title="동시 관측 조건 비교">
    <p className="text-sm text-slate-300">같은 관측에 기술·실적·재무 26개 항목을 함께 기록합니다. 각 항목은 독립 연구이며 매수 필수 조건이 아닙니다.</p>
    <p className="text-xs text-slate-400">기술 지표는 최근 완료된 일봉 기준입니다. 장중 현재가 지표와 구분합니다. 재무는 출처별 결산기간을 보존하며 캐시를 순차 갱신합니다.</p>
    <details className="text-sm text-slate-300" open>
      <summary className="cursor-pointer py-3">최근 수집 확보율 · {coverage?.candidateCount ?? 0}종목</summary>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{(Object.keys(PAPER_FEATURES) as PaperFeatureKey[]).map(feature => <div key={feature} className="flex justify-between gap-3 rounded-lg bg-slate-900/40 p-2">
        <span>{PAPER_FEATURES[feature].label}</span><span className="whitespace-nowrap tabular-nums">{coverage?.available[feature] ?? 0} / {coverage?.candidateCount ?? 0}</span>
      </div>)}</div>
    </details>
    <p className="text-sm text-slate-300">진입 시점 신규 기록 {study?.recordedCount ?? 0} / 전체 {study?.totalCount ?? 0}건 · 기존 관측은 소급 보충하지 않습니다.</p>
    <div className="workspace-filters"><select aria-label="동시 관측 연구 항목" value={key} onChange={event => setKey(event.target.value as PaperFeatureKey)}>
      {(Object.keys(PAPER_FEATURES) as PaperFeatureKey[]).map(feature => <option key={feature} value={feature}>{PAPER_FEATURES[feature].label}</option>)}
    </select></div>
    <p className="text-xs text-slate-400">선택 항목 확보 {selected?.availableCount ?? 0}건 · 미기록·미확인 {selected?.missingCount ?? 0}건. 동일시장 비교는 관측군 중앙값 기준이며 시장지수 대비 수익률이 아닙니다.</p>
    <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm">
      <caption className="sr-only">지표 구간별 비용 차감 성과</caption>
      <thead><tr>{['관측 구간', '관측 / 종목 / 진입일', 'D1', 'D3', 'D5'].map(label => <th className="p-3" key={label}>{label}</th>)}</tr></thead>
      <tbody>{selected?.groups.map(group => <tr key={group.label} className="border-t border-slate-800">
        <th className="p-3 font-medium">{group.label}</th><td className="p-3">{group.count} / {group.symbolCount} / {group.entryDateCount}</td>
        {group.outcomes.map(outcome => <td className="p-3" key={outcome.horizon}>{pct(outcome.meanNetReturnPct)}
          <div className="text-xs text-slate-400">{outcome.count}건 · {outcome.entryDateCount}일 · 승률 {pct(outcome.winRatePct)}</div></td>)}
      </tr>)}</tbody>
    </table></div>
    <p className="text-xs text-slate-400">구간별 평균은 인과관계나 검증된 추천 성과가 아닙니다. 같은 날짜의 종목들은 서로 영향을 받으며, 항목을 많이 비교할수록 우연한 차이가 생길 수 있습니다. 금융업 등 업종별 재무구조도 다릅니다.</p>
  </Section>;
}
