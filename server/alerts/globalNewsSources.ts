// @responsibility Collect bounded overseas RSS headlines with attributable publication metadata.
import { createHash } from 'node:crypto';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

export const GLOBAL_NEWS_FEEDS = [
  { id: 'bbc-business', name: 'BBC 경제', url: 'https://feeds.bbci.co.uk/news/business/rss.xml', hosts: ['bbc.com', 'bbc.co.uk'] },
  { id: 'bbc-world', name: 'BBC 국제', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', hosts: ['bbc.com', 'bbc.co.uk'] },
  { id: 'cnbc', name: 'CNBC', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', hosts: ['cnbc.com'] },
  { id: 'fed-policy', name: '미 연준 정책', url: 'https://www.federalreserve.gov/feeds/press_monetary.xml', hosts: ['federalreserve.gov'] },
  { id: 'fed-speeches', name: '미 연준 연설', url: 'https://www.federalreserve.gov/feeds/speeches.xml', hosts: ['federalreserve.gov'] },
] as const;
export interface GlobalNewsArticle {
  id: string; feedId: string; source: string; title: string; excerpt: string; url: string; publishedAt: string; firstSeenAt: string;
}
export interface GlobalNewsSourceStatus { feedId: string; name: string; checkedAt: string; count: number; error?: string }
export type GlobalNewsFeed = typeof GLOBAL_NEWS_FEEDS[number];
const MAX_BYTES = 750_000;
const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true });
const clean = (value: unknown, limit: number) => typeof value === 'string'
  ? value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit) : '';

export function canonicalNewsUrl(raw: unknown, feed: GlobalNewsFeed): string | null {
  if (typeof raw !== 'string' || raw.length > 600) return null;
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port
      || !feed.hosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) return null;
    url.protocol = 'https:'; url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|at_|cmpid|ocid)/i.test(key)) url.searchParams.delete(key);
    return url.toString();
  } catch { return null; } // Invalid publisher links are discarded, never fetched.
}

export function parseGlobalNewsFeed(xml: string, feed: GlobalNewsFeed, now: Date): GlobalNewsArticle[] {
  if (Buffer.byteLength(xml) > MAX_BYTES || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error('유효하지 않은 RSS');
  const channel = parser.parse(xml)?.rss?.channel;
  if (!channel || typeof channel !== 'object') throw new Error('RSS 채널 누락');
  const items = channel.item === undefined ? [] : Array.isArray(channel.item) ? channel.item : [channel.item];
  return items.slice(0, 150).flatMap((item: Record<string, unknown>) => {
    const url = canonicalNewsUrl(item.link, feed);
    const title = clean(item.title, 240);
    const published = typeof item.pubDate === 'string' ? Date.parse(item.pubDate) : NaN;
    if (!url || !title || !Number.isFinite(published) || published > now.getTime() || published < now.getTime() - 14 * 86_400_000) return [];
    return [{ id: createHash('sha256').update(url).digest('hex').slice(0, 24), feedId: feed.id, source: feed.name,
      title, excerpt: clean(item.description, 650), url, publishedAt: new Date(published).toISOString(), firstSeenAt: now.toISOString() }];
  });
}

async function readBoundedResponse(response: Response): Promise<string> {
  if (!response.ok || !response.body) throw new Error(`RSS HTTP ${response.status}`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) throw new Error('RSS 크기 초과');
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally { await reader.cancel(); }
}

export async function collectGlobalNews(now = new Date()): Promise<{ articles: GlobalNewsArticle[]; sources: GlobalNewsSourceStatus[] }> {
  const results = await Promise.all(GLOBAL_NEWS_FEEDS.map(async feed => {
    try {
      const response = await fetch(feed.url, { signal: AbortSignal.timeout(10_000), redirect: 'error', headers: { Accept: 'application/rss+xml, application/xml, text/xml' } });
      const articles = parseGlobalNewsFeed(await readBoundedResponse(response), feed, now);
      return { articles, status: { feedId: feed.id, name: feed.name, checkedAt: now.toISOString(), count: articles.length } };
    } catch (error) {
      return { articles: [], status: { feedId: feed.id, name: feed.name, checkedAt: now.toISOString(), count: 0,
        error: error instanceof Error ? error.name : 'RSS 수집 실패' } };
    }
  }));
  return { articles: results.flatMap(result => result.articles), sources: results.map(result => result.status) };
}

export function mergeGlobalNews(old: GlobalNewsArticle[], added: GlobalNewsArticle[], now: Date): GlobalNewsArticle[] {
  const items = new Map(old.map(item => [item.id, item]));
  for (const item of added) {
    // Repeated RSS entries cannot become a newly published event just because a feed was polled again.
    const previous = items.get(item.id);
    if (!previous) items.set(item.id, item);
  }
  return [...items.values()].filter(item => Date.parse(item.publishedAt) >= now.getTime() - 14 * 86_400_000)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 2000);
}
