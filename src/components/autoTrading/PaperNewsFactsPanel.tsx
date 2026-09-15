// @responsibility Display disclosure collection coverage with frozen event outcomes.
import React from 'react';
import type { PaperDisclosureStatus, PaperNewsFactsStudy } from '../../types/paperNewsFacts';
import { Section } from '../../ui/section';
const percent = (value: number | null) => value !== null && Number.isFinite(value) ? `${value.toFixed(2)}%` : '집계 대기';
export function PaperNewsFactsPanel({ status, study }: { status?: PaperDisclosureStatus; study?: PaperNewsFactsStudy }) {
  return <Section title="공시 사건별 관측" subtitle="기업 직접 공시와 간접 자료를 구분하고, 진입 당시 사건 유형으로 이후 성과를 비교합니다." variant="neo">
    {status ? <div className="space-y-1 text-sm text-slate-300">
      <p>상장기업 공시 수집: {status.state === 'COMPLETE' ? '조회 완료' : status.state === 'PARTIAL' ? '일부 자료 미확인' : '조회 확인 필요'}</p>
      <p>접수일 {status.fromDate} ~ {status.toDate} · {status.pages}페이지 · {status.fetchedCount}건 · 종목 연결 {status.linkedCount}건 · 미연결 {status.unlinkedCount}건</p>
      <p>확인 {new Date(status.checkedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false })} KST</p>
      {status.issue && <p className="text-amber-200">{status.issue} · 기존 기록으로 관측을 계속합니다.</p>}
      <p className="text-xs text-slate-400">전체 상장기업 조회 범위의 수집 건수입니다. 현재 관측 대상 종목에 해당하는 자료를 연결합니다.</p>
    </div> : <p className="text-sm text-slate-400">다음 공시 수집부터 조회 범위를 확인할 수 있습니다.</p>}
    {study && <>
      <p className="text-sm text-slate-300">사건 정보가 저장된 기본 관측 {study.recordedCount}건 · 사건 정보가 없는 관측 {study.unrecordedCount}건</p>
      <div className="overflow-x-auto"><table className="w-full min-w-[780px] text-left text-sm text-slate-200">
        <caption className="sr-only">공시 사건별 수급과 후속 수익률</caption>
        <thead><tr>{['사건·자료 유형', '관측 / 진입일', '진입 전일 외국인 / 기관 수급', 'D1', 'D3', 'D5'].map(label => <th className="p-3" key={label}>{label}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-800">{study.groups.map(group => <tr key={group.key}>
          <th className="p-3 font-medium">{group.label}</th><td className="p-3">{group.observationCount}건 / {group.entryDateCount}일</td>
          <td className="p-3">{percent(group.meanForeignPctVolume)} / {percent(group.meanInstitutionPctVolume)}<div className="text-xs text-slate-400">거래량 대비 평균 · {group.flowCount}건</div></td>
          {group.outcomes.map(outcome => <td className="p-3" key={outcome.horizon}>{percent(outcome.meanNetReturnPct)}<div className="text-xs text-slate-400">{outcome.count}건</div></td>)}
        </tr>)}</tbody>
      </table></div>
      <p className="text-xs text-slate-400">같은 관측에 여러 사건이 있으면 각 유형에 포함됩니다. 정정·철회는 별도 유형입니다. 단순 평균 비교이며 사건의 인과 효과를 입증하지 않습니다. 과거 진입에 새 사건 분류를 소급하지 않습니다.</p>
    </>}
  </Section>;
}
