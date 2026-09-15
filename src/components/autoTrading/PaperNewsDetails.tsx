// @responsibility Display recorded news direction with its evidence.
import React from 'react';
import type { PaperNewsSummary } from '../../types/paperExperiment';
import { PAPER_NEWS_LABELS } from '../../utils/paperNews';
import { PAPER_NEWS_EVENT_LABELS, PAPER_NEWS_FILING_LABELS, PAPER_NEWS_RELATION_LABELS } from '../../types/paperNewsFacts';
import { readPaperNewsFacts } from '../../utils/paperNewsFacts';

export function PaperNewsDetails({ summary }: { summary?: PaperNewsSummary }) {
  if (!summary) return <p className="text-xs text-slate-400">뉴스 방향 미평가 · 다음 관측부터 확인</p>;
  return (
    <details className="rounded-lg border border-slate-700/60 p-3 text-xs text-slate-300">
      <summary className="cursor-pointer font-medium">뉴스 평가 · {PAPER_NEWS_LABELS[summary.direction]}{summary.totalCount ? ` · ${summary.totalCount}건` : ''}</summary>
      <div className="mt-3 space-y-3">
        <p>기준 {new Date(summary.asOf).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false })} KST · 최근 {summary.lookbackHours}시간</p>
        {summary.totalCount > 0 && <p>호재 {summary.counts.POSITIVE} · 악재 {summary.counts.NEGATIVE} · 혼재 {summary.counts.MIXED} · 중립 {summary.counts.NEUTRAL} · 판단 불가 {summary.counts.UNKNOWN}</p>}
        {summary.evidence.map(item => { const facts = readPaperNewsFacts(item, summary.asOf); return <div key={`${item.source}:${item.id}`} className="space-y-1 border-t border-slate-700/60 pt-2">
          <p className="font-medium text-slate-200">{PAPER_NEWS_LABELS[item.direction]} · {item.headline}</p>
          {facts && <>
            <p>{PAPER_NEWS_RELATION_LABELS[facts.relationship]}{facts.relationship === 'DIRECT' ? ` · ${PAPER_NEWS_EVENT_LABELS[facts.event]}` : ''} · {PAPER_NEWS_FILING_LABELS[facts.filingStatus]}</p>
            <p>접수일 {facts.filedDate ?? '미확인'} · 최초 확인 {new Date(facts.firstSeenAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false })} KST</p>
            {facts.sourceUrl && facts.relationship === 'DIRECT' && <a className="text-sky-300 underline" href={facts.sourceUrl} target="_blank" rel="noopener noreferrer">DART 원문 · {facts.receiptNo}</a>}
          </>}
          <p>{item.reason}</p><p className="text-slate-400">출처 {item.source} · 관측 {new Date(item.observedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false })} KST</p>
        </div>; })}
        <p className="text-slate-400">사건 유형은 공시 제목 기준입니다. 접수 확인은 계약 이행이나 주가 상승의 보장이 아닙니다. 규모·조건은 원문 확인이 필요하며, 최초 확인 시각은 실제 발표 시각과 다를 수 있습니다.</p>
        <p className="text-slate-400">호악재가 함께 확인되면 혼재, 그 밖에 미평가가 섞이면 판단 불가로 남깁니다. 진입 당시 기록을 이후 결과로 바꾸지 않습니다.</p>
        <p className="text-slate-400">수집된 자료 안에서의 평가이며 뉴스 미관측이 뉴스 부재를 뜻하지 않습니다.</p>
      </div>
    </details>
  );
}
