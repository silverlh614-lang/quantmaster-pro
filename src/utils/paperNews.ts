// @responsibility Summarize contemporaneously recorded news assessments.
import type { PaperNewsDirection, PaperNewsGroup, PaperNewsObservation, PaperNewsSummary } from '../types/paperExperiment';
import { readPaperNewsFacts } from './paperNewsFacts';

export const PAPER_NEWS_VERSION = 'headline-rules-v1' as const;
export const PAPER_NEWS_LOOKBACK_HOURS = 72;
export const PAPER_NEWS_LABELS: Record<PaperNewsGroup, string> = {
  POSITIVE: '호재 추정', NEGATIVE: '악재 추정', NEUTRAL: '중립', MIXED: '호악재 혼재',
  UNKNOWN: '판단 불가', NO_NEWS: '최근 뉴스 미관측',
};
const DIRECTIONS: PaperNewsDirection[] = ['NEGATIVE', 'MIXED', 'POSITIVE', 'NEUTRAL', 'UNKNOWN'];

/** Read saved assessments only. Never classify old headlines using today's rules. */
export function summarizePaperNews(news: PaperNewsObservation[], asOf: string, lookbackHours = PAPER_NEWS_LOOKBACK_HOURS): PaperNewsSummary {
  const cutoff = Date.parse(asOf);
  const counts: PaperNewsSummary['counts'] = { POSITIVE: 0, NEGATIVE: 0, NEUTRAL: 0, MIXED: 0, UNKNOWN: 0 };
  const summary: PaperNewsSummary = { asOf, lookbackHours, direction: 'UNKNOWN', counts, totalCount: 0, evidence: [] };
  if (!Number.isFinite(cutoff) || !Number.isFinite(lookbackHours) || lookbackHours <= 0) return summary;
  const valid = news.filter(item => item && typeof item.id === 'string' && typeof item.headline === 'string'
    && typeof item.source === 'string' && typeof item.observedAt === 'string' && Number.isFinite(Date.parse(item.observedAt)));
  // A malformed legacy record is unknown coverage, never evidence of no news or a reason to stop observations.
  counts.UNKNOWN = news.length - valid.length;
  const seen = new Set<string>();
  const items: PaperNewsSummary['evidence'] = [];
  for (const item of valid.sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))) {
    const observed = Date.parse(item.observedAt);
    const key = `${item.source}:${item.id}`;
    if (!(observed <= cutoff && observed >= cutoff - lookbackHours * 3_600_000) || seen.has(key)) continue;
    seen.add(key);
    const assessment = item.assessment;
    const assessed = Date.parse(assessment?.assessedAt ?? '');
    const usable = assessment?.version === PAPER_NEWS_VERSION && assessment.method === 'DISCLOSURE_TITLE_RULES'
      && DIRECTIONS.includes(assessment.direction) && typeof assessment.reason === 'string' && assessment.reason.trim().length > 0
      && assessed >= observed && assessed <= cutoff;
    const direction = usable ? assessment.direction : 'UNKNOWN';
    counts[direction]++;
    const facts = readPaperNewsFacts(item, asOf);
    items.push({ id: item.id, headline: item.headline.slice(0, 180), source: item.source, observedAt: item.observedAt,
      direction, reason: usable ? assessment.reason.slice(0, 180) : '당시 유효한 방향 평가가 저장되지 않음', ...(facts ? { facts: structuredClone(facts) } : {}) });
  }
  summary.totalCount = Object.values(counts).reduce((sum, count) => sum + count, 0);
  // Preserve conflicting signs; incomplete coverage cannot become a clean positive/negative research group.
  summary.direction = !summary.totalCount ? 'NO_NEWS' : counts.MIXED || (counts.POSITIVE && counts.NEGATIVE) ? 'MIXED'
    : counts.UNKNOWN ? 'UNKNOWN' : counts.NEGATIVE ? 'NEGATIVE' : counts.POSITIVE ? 'POSITIVE' : 'NEUTRAL';
  summary.evidence = DIRECTIONS.flatMap(direction => {
    const item = items.find(row => row.direction === direction);
    return item ? [item] : [];
  });
  for (const item of items.filter(row => row.facts?.relationship === 'DIRECT')) {
    if (summary.evidence.length >= 5) break;
    if (!summary.evidence.some(row => row.source === item.source && row.id === item.id)) summary.evidence.push(item);
  }
  return summary;
}
