// @responsibility DART 공시본문 정량사실 추출
import { missingFact, originalFact, parsedFact } from './dartDataConfidence.js';
import type { DartDisclosureRecord, DartExtractedFact, DartReason } from './dartPreNewsTypes.js';

export interface DartParseResult {
  facts: DartExtractedFact[];
  missingData: string[];
  providerIssue: boolean;
  reasons: DartReason[];
}

function normalizeAmount(raw: string): number | undefined {
  const cleaned = raw.replace(/[,\s]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

function findNumberAfter(text: string, labels: string[]): number | undefined {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`${escaped}[^0-9]{0,30}([0-9][0-9,]{3,})`);
    const m = text.match(re);
    if (m?.[1]) return normalizeAmount(m[1]);
  }
  return undefined;
}

function findPercentAfter(text: string, labels: string[]): number | undefined {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`${escaped}[^0-9]{0,30}([0-9]+(?:\\.[0-9]+)?)\\s*%`);
    const m = text.match(re);
    if (m?.[1]) return Number(m[1]);
  }
  return undefined;
}

function findDateRange(text: string): string | undefined {
  const m = text.match(/(20\d{2}[.\-/년]\s*\d{1,2}[.\-/월]\s*\d{1,2}일?).{0,30}(20\d{2}[.\-/년]\s*\d{1,2}[.\-/월]\s*\d{1,2}일?)/);
  return m ? `${m[1]} ~ ${m[2]}` : undefined;
}

export function parseDartDisclosureFacts(disclosure: DartDisclosureRecord): DartParseResult {
  const facts: DartExtractedFact[] = [
    originalFact('disclosureId', 'DART 접수번호', disclosure.disclosureId),
    originalFact('disclosureTitle', '공시 제목', disclosure.disclosureTitle),
    originalFact('receivedAt', '공시 접수시각', disclosure.receivedAt),
    originalFact('corpName', '회사명', disclosure.corpName),
  ];
  const missingData: string[] = [];
  const reasons: DartReason[] = [];

  if (!disclosure.bodyText?.trim()) {
    facts.push(missingFact('bodyText', '공시 본문'));
    missingData.push('bodyText');
    reasons.push('DATA_DART_FIELD_MISSING');
    return { facts, missingData, providerIssue: false, reasons };
  }

  try {
    const text = disclosure.bodyText.replace(/\s+/g, ' ');
    const contractAmount = findNumberAfter(text, ['계약금액', '계약 금액', '처분금액', '취득금액', '투자금액', '발행금액']);
    const salesRatio = findPercentAfter(text, ['매출액대비', '최근매출액대비', '자기자본대비', '대비']);
    const dateRange = findDateRange(text);

    if (contractAmount !== undefined) facts.push(parsedFact('amount', '본문 추출 금액', contractAmount, 'KRW'));
    else {
      facts.push(missingFact('amount', '본문 추출 금액'));
      missingData.push('amount');
    }

    if (salesRatio !== undefined) facts.push(parsedFact('salesRatio', '매출/자본 대비 비율', salesRatio, '%'));
    else {
      facts.push(missingFact('salesRatio', '매출/자본 대비 비율'));
      missingData.push('salesRatio');
    }

    if (dateRange !== undefined) facts.push(parsedFact('contractPeriod', '계약/투자 기간', dateRange));
    else missingData.push('contractPeriod');

    return { facts, missingData, providerIssue: false, reasons };
  } catch {
    facts.push(missingFact('parser', '본문 파서 결과'));
    missingData.push('parser');
    reasons.push('PROVIDER_DART_PARSER_FAILED');
    return { facts, missingData, providerIssue: true, reasons };
  }
}
