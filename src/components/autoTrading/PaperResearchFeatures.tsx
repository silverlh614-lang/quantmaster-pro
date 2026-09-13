// @responsibility Display held-out condition comparisons.
import React from 'react';
import type { ResearchFeatureStudy } from '../../types/paperResearch';

const percent = (value: number | null, unit = '%') => value === null ? '비교 대기' : `${value.toFixed(2)}${unit}`;
const bucket = (value: string | null) => value === null ? '선택 대기' : ({ LOWER: '학습 중앙값 이하', UPPER: '학습 중앙값 초과',
  BREAKOUT_CONFIRMED: '돌파', NEAR_BREAKOUT: '돌파 근접', PULLBACK_ENTRY: '눌림목', OVEREXTENDED: '과열',
  NOT_CONFIRMED: '기타 가격 위치', UNCLASSIFIED: '학습 구간 부족' } as Record<string, string>)[value] ?? value;
const status = (value: ResearchFeatureStudy['status']) => ({ EVALUATED: '후반 비교 완료', MISSING_INPUT: '입력 자료 없음',
  NO_TRAIN_VARIATION: '학습 구간 비교 불가', NO_TEST_MATCH: '후반 해당 표본 없음' })[value];

export function PaperResearchFeatures({ studies, notes }: { studies: ResearchFeatureStudy[]; notes: string[] }) {
  return <div className="space-y-3 border-t border-slate-700 pt-3">
    <p className="font-semibold text-slate-200">기존 Gate 조건별 확장 연구</p>
    <p className="text-xs text-slate-400">조건 하나씩 비교합니다. 후반 비교 차이는 동일 날짜·뉴스/추세·보유기간을 맞춘 대조군 대비 %p입니다. 탐색 결과는 매매에 자동 적용되지 않습니다.</p>
    <div className="overflow-x-auto"><table className="w-full text-left text-sm">
      <caption className="py-2 text-left text-slate-300">조건 선택 후 후반 기간 검증</caption>
      <thead><tr>{['조건', '가용 / 결손', '선택 구간·기간', '후반 표본·종목·진입일', '조건 적용', '대조군', '비교 차이', '상태'].map(text => <th className="p-2" key={text}>{text}</th>)}</tr></thead>
      <tbody>{studies.map(item => <tr key={item.feature}>
        <td className="p-2">{item.label}</td><td className="p-2">{item.availableCount} / {item.missingCount}</td>
        <td className="p-2">{bucket(item.selectedGroup)}{item.selectedHorizon !== null ? ` · D${item.selectedHorizon}` : ''}</td>
        <td className="p-2">{item.testCount}건 · {item.testSymbolCount}종목 · {item.testDateCount}일</td>
        <td className="p-2">{percent(item.matchedSelectedMeanPct)}</td><td className="p-2">{percent(item.matchedBaselineMeanPct)}</td>
        <td className="p-2">{percent(item.matchedDifferencePct, '%p')}</td><td className="p-2">{status(item.status)}</td>
      </tr>)}</tbody>
    </table></div>
    <details className="text-xs text-slate-400"><summary className="cursor-pointer py-2">조건별 구간·전체 성과·학습 범위</summary>
      {studies.map(item => <div key={item.feature} className="space-y-1 py-2">
        <p>{item.label} · 후반 시작 {item.splitDate ?? '미정'} · 학습 {item.trainingCount}건 · 후반 가용 {item.testAvailableCount}건</p>
        <p>선택 구간의 학습 표본 {item.selectedTrainingCount}건 · 대조 날짜/그룹 {item.matchedGroupCount}개{item.threshold === null ? '' : ` · 학습 중앙값 ${item.threshold.toFixed(3)}${item.feature === 'volumeRatio20d' ? '배' : '%'}`}</p>
        <p>선택 표본의 단순 평균: {percent(item.testMeanNetReturnPct)} · 위 표는 날짜/그룹을 동일 가중한 평균입니다.</p>
        {item.groups.map(group => <p key={group.group}>{bucket(group.group)}: {group.count}건 · {group.horizons.map(h => `D${h.horizon} ${percent(h.meanNetReturnPct)}`).join(' / ')}</p>)}
      </div>)}
    </details>
    {notes.map(note => <p key={note} className="text-xs text-slate-400">{note}</p>)}
  </div>;
}
