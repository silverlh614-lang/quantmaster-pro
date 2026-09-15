// @vitest-environment jsdom
// @responsibility Verify visible disclosure coverage with original provenance.
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PaperNewsFactsPanel } from './PaperNewsFactsPanel';
import { PaperNewsDetails } from './PaperNewsDetails';
import { summarizePaperNews } from '../../utils/paperNews';

afterEach(cleanup);
describe('factual news presentation', () => {
  it('shows partial collection without implying an empty news feed', () => {
    render(<PaperNewsFactsPanel status={{ state: 'PARTIAL', checkedAt: '2026-09-18T01:00:00Z', lastSuccessAt: null,
      fromDate: '2026-09-15', toDate: '2026-09-18', pages: 2, fetchedCount: 120, linkedCount: 118, unlinkedCount: 2, issue: 'DART 통신 실패' }}
      study={{ recordedCount: 1, unrecordedCount: 1134, groups: [{ key: 'CONTRACT', label: '판매·공급 계약', observationCount: 1,
        entryDateCount: 1, flowCount: 1, meanForeignPctVolume: 0, meanInstitutionPctVolume: -5,
        outcomes: [{ horizon: 1, label: 'D1', count: 0, meanNetReturnPct: null, winRatePct: null }] }] }} />);
    expect(screen.getByText('상장기업 공시 수집: 일부 자료 미확인')).toBeTruthy();
    expect(screen.getByText(/종목 연결 118건 · 미연결 2건/)).toBeTruthy();
    expect(screen.getByText(/DART 통신 실패 · 기존 기록으로 관측을 계속/)).toBeTruthy();
    expect(screen.getByText('0.00% / -5.00%')).toBeTruthy();
    expect(screen.getByText('집계 대기')).toBeTruthy();
    expect(screen.getByRole('table', { name: '공시 사건별 수급과 후속 수익률' })).toBeTruthy();
  });
  it('shows filing date, first observation and a verified original link separately from price impact', () => {
    const at = '2026-09-18T01:00:00Z';
    const item = { id: 'dart:20260918000001', headline: '[기재정정]단일판매ㆍ공급계약체결', source: 'DART', observedAt: at };
    const facts = { version: 'news-facts-v1', recordedAt: at, relationship: 'DIRECT', event: 'CONTRACT', filingStatus: 'AMENDED',
      receiptNo: '20260918000001', filedDate: '2026-09-18', firstSeenAt: at, linkMethod: 'DART_STOCK_CODE',
      sourceUrl: 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260918000001' } as const;
    render(<PaperNewsDetails summary={summarizePaperNews([{ ...item, facts }], at)} />);
    expect(screen.getByText('해당 기업 직접 공시 · 판매·공급 계약 · 정정·변경 공시')).toBeTruthy();
    expect(screen.getByText(/접수일 2026-09-18 · 최초 확인/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'DART 원문 · 20260918000001', hidden: true }).getAttribute('href')).toBe(facts.sourceUrl);
    expect(screen.getByText(/규모·조건은 원문 확인이 필요/)).toBeTruthy();
  });
});
