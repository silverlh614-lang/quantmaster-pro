// @responsibility Read frozen factual news provenance without reclassification.
import type { PaperNewsObservation } from '../types/paperExperiment';
import { PAPER_NEWS_EVENT_LABELS, PAPER_NEWS_FILING_LABELS, PAPER_NEWS_RELATION_LABELS, type PaperNewsFacts } from '../types/paperNewsFacts';

export function readPaperNewsFacts(item: Pick<PaperNewsObservation, 'id' | 'source' | 'observedAt' | 'facts'>, asOf: string): PaperNewsFacts | undefined {
  const facts = item.facts;
  const observed = Date.parse(item.observedAt);
  if (!facts || facts.version !== 'news-facts-v1' || !Object.hasOwn(PAPER_NEWS_EVENT_LABELS, facts.event)
    || !Object.hasOwn(PAPER_NEWS_RELATION_LABELS, facts.relationship) || !Object.hasOwn(PAPER_NEWS_FILING_LABELS, facts.filingStatus)
    || !(Date.parse(facts.firstSeenAt) <= observed && observed <= Date.parse(facts.recordedAt) && Date.parse(facts.recordedAt) <= Date.parse(asOf))) return undefined;
  if (facts.relationship === 'DIRECT' && (item.source !== 'DART' || !/^\d{14}$/.test(facts.receiptNo ?? '')
    || item.id !== `dart:${facts.receiptNo}` || facts.sourceUrl !== `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${facts.receiptNo}`
    || !/^\d{4}-\d{2}-\d{2}$/.test(facts.filedDate ?? '') || typeof facts.linkMethod !== 'string'
    || !Number.isFinite(Date.parse(`${facts.filedDate}T00:00:00+09:00`))
    || new Date(`${facts.filedDate}T00:00:00Z`).toISOString().slice(0, 10) !== facts.filedDate
    || Date.parse(`${facts.filedDate}T00:00:00+09:00`) > Date.parse(facts.firstSeenAt))) return undefined;
  return facts;
}
