// @responsibility Present searchable documentation without starting server work.
import React, { useState } from 'react';
import { ArrowRight, BookOpen, Download, Search } from 'lucide-react';
import { PAPER_MANUAL, PAPER_MANUAL_REVIEWED_AT, manualSectionText, paperManualText, type ManualBlock } from '../content/paperManual';
import { useSettingsStore } from '../stores/useSettingsStore';
import { PaperIndicatorPlayground } from '../components/autoTrading/PaperIndicatorPlayground';
import '../styles/paperManual.css';

const steps = [
  { id: 'observation', title: '관측', text: '가격과 근거 수집' }, { id: 'research', title: '연구', text: '지표 만들고 비교' },
  { id: 'buy', title: '추천', text: '08:30 후보 안내' }, { id: 'buy', title: '가상 매수', text: '장중 조건 재확인' },
  { id: 'sell', title: '가상 매도', text: '가격·근거로 판단' }, { id: 'research', title: '다음 학습', text: '결과로 규칙 개선' },
];
function ManualBlockContent({ block }: { block: ManualBlock }) {
  return <><div className="manual-prose">{block.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}</div>
    {block.items && <ul>{block.items.map(item => <li key={item}>{item}</li>)}</ul>}
    {block.table && <div className="manual-table-wrap" role="region" aria-label={block.title} tabIndex={0}><table>
      <thead><tr>{block.table.headers.map(header => <th scope="col" key={header}>{header}</th>)}</tr></thead>
      <tbody>{block.table.rows.map(row => <tr key={row[0]}>{row.map((value, index) => index === 0
        ? <th scope="row" key={index}>{value}</th> : <td key={index}>{value}</td>)}</tr>)}</tbody>
    </table></div>}</>;
}
export function PaperManualPage() {
  const [selected, setSelected] = useState('overview'), [query, setQuery] = useState('');
  const setView = useSettingsStore(state => state.setView);
  const needle = query.trim().toLocaleLowerCase();
  const results = needle ? PAPER_MANUAL.filter(section => manualSectionText(section).toLocaleLowerCase().includes(needle))
    .map(section => ({ ...section, blocks: `${section.title} ${section.summary}`.toLocaleLowerCase().includes(needle)
      ? section.blocks : section.blocks.filter(block => manualSectionText({ ...section, title: '', summary: '', blocks: [block] }).toLocaleLowerCase().includes(needle)) }))
    : PAPER_MANUAL.filter(section => section.id === selected);
  const choose = (id: string) => { setSelected(id); setQuery(''); };
  const download = () => {
    const url = URL.createObjectURL(new Blob([paperManualText()], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `QuantMaster-사용설명서-${PAPER_MANUAL_REVIEWED_AT}.txt`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <div className="workspace-page manual-page">
    <header className="manual-hero"><div><span className="manual-eyebrow"><BookOpen size={16} aria-hidden="true" /> 원리를 이해하고 기록으로 확인하기</span>
      <h1>시스템 사용 설명서</h1><p>지표가 움직이는 이유부터 추천·가상 매매·학습까지.<br />궁금한 단계부터 읽고, 숫자를 직접 바꿔 보세요.</p></div>
      <div className="manual-meta"><span>내용 검토 {PAPER_MANUAL_REVIEWED_AT}</span><span>현재 구현 기준 · 모든 일정 한국 시간</span>
        <button type="button" className="workspace-button" onClick={download}><Download size={16} aria-hidden="true" />전체 설명서 저장</button></div>
    </header>
    <nav className="manual-flow" aria-label="시스템 작동 흐름">{steps.map((step, index) => <button type="button" key={step.title} onClick={() => choose(step.id)}>
      <span className="manual-step-index">0{index + 1}</span><strong>{step.title}</strong><span>{step.text}</span></button>)}</nav>
    <button type="button" className="manual-try-banner" onClick={() => choose('indicators')}><span><strong>지표가 왜 오르고 내릴까요?</strong>
      <small>가격·거래량·발명 지표를 직접 움직여 보기</small></span><ArrowRight size={21} aria-hidden="true" /></button>
    <div className="manual-search"><Search size={18} aria-hidden="true" /><label className="sr-only" htmlFor="manual-search">설명서 검색</label>
      <input id="manual-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="예: RSI, 매도, 1분, 텔레그램" />
      {query && <button type="button" onClick={() => setQuery('')}>검색 지우기</button>}</div>
    <div className="manual-layout"><nav className="manual-toc" aria-label="설명서 카테고리">{PAPER_MANUAL.map((section, index) =>
      <button type="button" key={section.id} aria-current={!needle && selected === section.id ? 'true' : undefined} onClick={() => choose(section.id)}>
        <span>{String(index + 1).padStart(2, '0')}</span>{section.title}</button>)}</nav>
      <div className="manual-content"><p className="manual-results" role="status">{needle ? `“${query.trim()}” 검색 · ${results.length}개 카테고리` : '카테고리를 선택하거나 궁금한 내용을 검색하세요.'}</p>
        {!results.length && <div className="manual-empty"><h2>일치하는 설명이 없습니다.</h2><p>짧은 지표 이름이나 ‘매수’, ‘검증’, ‘뉴스’로 찾아보세요.</p></div>}
        {results.map(section => <section key={`${section.id}:${needle}`} className="manual-section" aria-labelledby={`manual-${section.id}`}>
          <header><span className="manual-eyebrow">사용 설명서</span><h2 id={`manual-${section.id}`}>{section.title}</h2><p>{section.summary}</p></header>
          {section.id === 'indicators' && <PaperIndicatorPlayground />}
          {section.blocks.map(block => section.id === 'glossary' || section.id === 'faq'
            ? <details className="manual-block" key={block.title} open={needle ? true : undefined}><summary>{block.title}</summary><ManualBlockContent block={block} /></details>
            : <article className="manual-block" key={block.title}><h3>{block.title}</h3><ManualBlockContent block={block} /></article>)}
          {section.related && <button type="button" className="manual-related" onClick={() => setView(section.related!.view)}>{section.related.label}<ArrowRight size={16} aria-hidden="true" /></button>}
        </section>)}
      </div>
    </div>
  </div>;
}
