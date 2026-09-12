// @responsibility Display archived research results.
import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { PaperResearchView } from '../../types/paperResearch';
import { Section } from '../../ui/section';
import { PAPER_EXPERIMENT_QUERY_KEY } from '../../api/paperExperimentClient';
import { apiFetch } from '../../api/client';

const label = (group: string) => `${group.startsWith('NEWS_RECENT') ? '관측 뉴스 있음' : '뉴스 기록 미확인'} · ${group.includes('ABOVE') ? '20일선 위' : '20일선 이하'}`;
const percent = (value: number | null) => value === null ? '집계 대기' : `${value.toFixed(2)}%`;

export function PaperResearchPanel({ view }: { view?: PaperResearchView }) {
  const client = useQueryClient();
  const research = useMutation({
    mutationFn: async () => {
      const result = await apiFetch<PaperResearchView>('/api/shadow/research', { method: 'POST' });
      if (result.error) throw new Error(result.error);
      return result;
    },
    onSuccess: async () => { await client.invalidateQueries({ queryKey: PAPER_EXPERIMENT_QUERY_KEY }); },
  });
  return (
    <Section title="저장 자료 학습·연구" subtitle="원본을 보존하고 과거 가격·뉴스로 재현한 결과입니다. 새 전략의 거래 성과와 별도로 봅니다." variant="neo">
      <button type="button" disabled={research.isPending} onClick={() => research.mutate()}
        className="rounded-lg border border-sky-400/30 px-3 py-2 text-sm text-sky-200 disabled:opacity-50">
        {research.isPending ? '과거 자료 연구 중...' : '저장 자료 다시 연구'}
      </button>
      {(view?.error || research.isError) && <p role="alert" className="text-sm text-amber-200">{view?.error ?? research.error?.message}</p>}
      {!view ? <p className="text-sm text-slate-400">첫 스캔 또는 연구 실행 후 보유 자료와 재현 결과가 표시됩니다.</p> : <>
        <p className="text-sm text-slate-200">재현 {view.sampleCount}건 · {view.symbols}종목 · 뉴스 전략 학습에 사용 가능 {view.learningSampleCount}건</p>
        <p className="text-xs text-slate-400">진입일 {view.firstDate ?? '미확인'} ~ {view.lastDate ?? '미확인'} · 보관 가격 묶음 {view.seriesCount}개 · 뉴스 {view.newsCount}건</p>
        {view.sampleCount === 0 && <p className="text-sm text-amber-200">재현할 완전한 가격 자료가 아직 없습니다. 아래 원본 보유 현황과 누락 사유를 확인하세요.</p>}
        <div className="overflow-x-auto"><table className="w-full text-left text-sm">
          <caption className="py-2 text-left font-semibold text-slate-200">과거 기간별 성과</caption>
          <thead><tr>{['그룹', '표본', '진입일', 'D1', 'D3', 'D5'].map(text => <th key={text} className="p-2">{text}</th>)}</tr></thead>
          <tbody>{view.groups.map(group => <tr key={group.group}>
            <td className="p-2">{label(group.group)}</td><td className="p-2">{group.count}</td><td className="p-2">{group.entryDates}</td>
            {group.horizons.map(item => <td className="p-2" key={item.horizon}>{percent(item.meanNetReturnPct)}</td>)}
          </tr>)}</tbody>
        </table></div>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm">
          <caption className="py-2 text-left font-semibold text-slate-200">앞선 기간으로 선택하고 후반 기간에서 확인</caption>
          <thead><tr>{['그룹', '검증 시작일', '학습 / 검증', '선택 기간', '후반 순수익률', '후반 승률'].map(text => <th key={text} className="p-2">{text}</th>)}</tr></thead>
          <tbody>{view.validation.map(item => <tr key={item.group}>
            <td className="p-2">{label(item.group)}</td><td className="p-2">{item.splitDate}</td><td className="p-2">{item.trainingCount} / {item.testCount}</td>
            <td className="p-2">D{item.selectedHorizon}</td><td className="p-2">{percent(item.testMeanNetReturnPct)}</td><td className="p-2">{percent(item.testWinRatePct)}</td>
          </tr>)}</tbody>
        </table></div>
        {view.validation.length === 0 && <p className="text-xs text-slate-400">날짜를 나눠 검증할 충분한 기간이 아직 없습니다.</p>}
        <details className="text-xs text-slate-400"><summary className="cursor-pointer py-2">원본 보유 현황·계산 제외 사유</summary>
          {view.inventory.map((item, index) => <p key={`${item.file}:${index}`}>{item.file}: {item.status === 'FOUND' ? `${item.records}건` : item.status === 'MISSING' ? '파일 없음' : '읽기 오류'} {item.issue}</p>)}
          {Object.entries(view.skipped).map(([reason, count]) => <p key={reason}>{({ MISSING_PRIOR_20_CLOSES: '직전 20거래일 가격 부족', MISSING_EXACT_D1_D3_D5: '정확한 D1·D3·D5 가격 부족', UNSUPPORTED_CALENDAR_YEAR: '휴장일 달력 미등록 연도', INVALID_SERIES: '가격 묶음의 시각·종목 확인 불가', INVALID_COST_MODEL: '비용 설정 확인 불가' } as Record<string, string>)[reason] ?? reason}: {count}건</p>)}
        </details>
        {view.notes.map(note => <p key={note} className="text-xs text-slate-400">{note}</p>)}
      </>}
    </Section>
  );
}
