// @responsibility Display recorded news direction with its evidence.
import React from 'react';
import type { PaperNewsSummary } from '../../types/paperExperiment';
import { PAPER_NEWS_LABELS } from '../../utils/paperNews';

export function PaperNewsDetails({ summary }: { summary?: PaperNewsSummary }) {
  if (!summary) return <p className="text-xs text-slate-400">뉴스 방향 미평가 · 다음 관측부터 확인</p>;
  return (
    <details className="rounded-lg border border-slate-700/60 p-3 text-xs text-slate-300">
      <summary className="cursor-pointer font-medium">뉴스 평가 · {PAPER_NEWS_LABELS[summary.direction]}{summary.totalCount ? ` · ${summary.totalCount}건` : ''}</summary>
      <div className="mt-3 space-y-3">
        <p>기준 {new Date(summary.asOf).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false })} KST · 최근 {summary.lookbackHours}시간</p>
        {summary.totalCount > 0 && <p>호재 {summary.counts.POSITIVE} · 악재 {summary.counts.NEGATIVE} · 혼재 {summary.counts.MIXED} · 중립 {summary.counts.NEUTRAL} · 판단 불가 {summary.counts.UNKNOWN}</p>}
        {summary.evidence.map(item => <div key={`${item.source}:${item.id}`} className="space-y-1 border-t border-slate-700/60 pt-2">
          <p className="font-medium text-slate-200">{PAPER_NEWS_LABELS[item.direction]} · {item.headline}</p>
          <p>{item.reason}</p><p className="text-slate-400">출처 {item.source} · 관측 {new Date(item.observedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false })} KST</p>
        </div>)}
        <p className="text-slate-400">공시 제목의 단서로 추정하며 본문·규모·주가 반영 여부는 미검증입니다. 각 분류의 최근 근거를 보여 줍니다. 호악재가 함께 확인되면 혼재, 그 밖에 미평가가 섞이면 판단 불가로 남깁니다.</p>
        <p className="text-slate-400">수집된 자료 안에서의 평가이며 뉴스 미관측이 뉴스 부재를 뜻하지 않습니다.</p>
      </div>
    </details>
  );
}
