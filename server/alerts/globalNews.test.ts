// @responsibility Verify overseas source bounds, briefing provenance, stock exposure labels, and durable nonblocking preparation.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ ai: vi.fn(), directory: '' }));
vi.mock('../clients/geminiClient.js', () => ({ callGeminiText: mocks.ai }));
vi.mock('../persistence/paths.js', () => ({ get DATA_DIR() { return mocks.directory; } }));
import { GLOBAL_NEWS_FEEDS, collectGlobalNews, isDomesticNewsFeed, mergeGlobalNews, parseGlobalNewsFeed, type GlobalNewsArticle } from './globalNewsSources.js';
import { buildGlobalMorningBrief, formatGlobalMorningBrief, globalBriefWindow, parseGlobalBriefSummary, relatedNewsStocks, selectGlobalNews, sourceHeadlineBrief } from './globalNewsBriefing.js';
import { validateTelegramHtml } from './telegramHtmlSanitizer.js';

const now = new Date('2026-09-21T08:30:00+09:00');
const article = (changes: Partial<GlobalNewsArticle> = {}): GlobalNewsArticle => ({
  id: 'story-1', feedId: 'bbc-business', source: 'BBC 경제', title: 'Nvidia memory chip demand increases', excerpt: 'AI servers use HBM memory chips.',
  url: 'https://www.bbc.com/news/articles/story-1', publishedAt: '2026-09-20T20:00:00.000Z', firstSeenAt: '2026-09-20T23:00:00.000Z', ...changes,
});
const xml = (body: string) => `<rss version="2.0"><channel><title>News</title>${body}</channel></rss>`;
const rssItem = (title = 'Nvidia memory demand', url = 'https://www.bbc.com/news/articles/test?utm_source=rss', date = 'Sun, 20 Sep 2026 20:00:00 GMT') =>
  `<item><title><![CDATA[${title}]]></title><link>${url}</link><pubDate>${date}</pubDate><description><![CDATA[<p>Memory &amp; chips</p>]]></description></item>`;
beforeEach(() => { vi.clearAllMocks(); mocks.ai.mockResolvedValue(null); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('verified RSS input', () => {
  it('accepts Korean publisher feeds with their own link hosts and publication timestamps', () => {
    const feeds = GLOBAL_NEWS_FEEDS.filter(feed => isDomesticNewsFeed(feed.id));
    expect(feeds).toHaveLength(4);
    for (const feed of feeds) {
      const url = `https://www.${feed.hosts[0]}/article/example`;
      const parsed = parseGlobalNewsFeed(xml(rssItem('국내 기업 실적 발표', url)), feed, now);
      expect(parsed[0]).toMatchObject({ feedId: feed.id, source: feed.name, title: '국내 기업 실적 발표', url });
      expect(parseGlobalNewsFeed(xml(rssItem('국내 기업 실적 발표', 'https://publisher.invalid/article')), feed, now)).toEqual([]);
    }
  });
  it('preserves source publication time, strips HTML and tracking parameters', () => {
    const parsed = parseGlobalNewsFeed(xml(rssItem()), GLOBAL_NEWS_FEEDS[0], now);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ title: 'Nvidia memory demand', url: 'https://www.bbc.com/news/articles/test', publishedAt: '2026-09-20T20:00:00.000Z' });
    expect(parsed[0].excerpt).not.toContain('<p>');
  });
  it('rejects unknown hosts, credentials, missing/future timestamps and malformed XML', () => {
    for (const url of ['https://bbc.com.evil.test/a', 'javascript:alert(1)', 'https://user@bbc.com/a']) {
      expect(parseGlobalNewsFeed(xml(rssItem('News', url)), GLOBAL_NEWS_FEEDS[0], now)).toEqual([]);
    }
    for (const date of ['', 'Tue, 22 Sep 2026 20:00:00 GMT']) expect(parseGlobalNewsFeed(xml(rssItem('News', undefined, date)), GLOBAL_NEWS_FEEDS[0], now)).toEqual([]);
    expect(() => parseGlobalNewsFeed('<!DOCTYPE x [<!ENTITY x "y">]><rss/>', GLOBAL_NEWS_FEEDS[0], now)).toThrow();
    expect(() => parseGlobalNewsFeed('<rss>', GLOBAL_NEWS_FEEDS[0], now)).toThrow();
  });
  it('retains the first publication/observation when a feed repeats the URL and bounds storage', () => {
    const original = article();
    const merged = mergeGlobalNews([original, article({ id: 'old', publishedAt: '2026-08-01T00:00:00Z' })], [article({ publishedAt: now.toISOString(), firstSeenAt: now.toISOString() })], now);
    expect(merged).toEqual([original]);
  });
  it('distinguishes an empty successful feed from a provider failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(xml(''))).mockRejectedValue(new Error('offline')));
    const result = await collectGlobalNews(now);
    expect(result.sources[0]).toMatchObject({ count: 0 });
    expect(result.sources[0].error).toBeUndefined();
    expect(result.sources.slice(1).every(source => Boolean(source.error))).toBe(true);
  });
});

describe('bounded and attributable morning content', () => {
  const domestic = (id: string, title: string): GlobalNewsArticle => article({ id, title, excerpt: '',
    feedId: 'kr-hankyung-finance', source: '한국경제 증권', url: `https://www.hankyung.com/article/${id}` });
  it('reserves three domestic and two overseas stories, deduplicating Korean headlines', () => {
    const stories = [domestic('kr1', '삼성전자 반도체 투자 계획 발표'), domestic('dup', '삼성전자 반도체 투자 계획 발표 소식'),
      domestic('kr2', '한국은행 기준금리 동결'), domestic('kr3', '원달러 환율 하락'), domestic('kr4', '국내 자동차 수출 증가'),
      article(), article({ id: 'oil', url: 'https://www.bbc.com/news/oil', title: 'Oil supply update', excerpt: '' })];
    const brief = sourceHeadlineBrief(stories, [], now);
    expect(brief.items.filter(item => isDomesticNewsFeed(item.article.feedId))).toHaveLength(3);
    expect(brief.items.filter(item => !isDomesticNewsFeed(item.article.feedId))).toHaveLength(2);
    expect(brief.items.some(item => item.article.id === 'dup')).toBe(false);
    expect(relatedNewsStocks(stories[0])[0]).toMatchObject({ symbol: '005930', relation: 'MENTIONED' });
    expect(relatedNewsStocks(domestic('kr5', '메모리 수요 증가'))[0].relation).toBe('SECTOR');
    const text = formatGlobalMorningBrief(brief);
    expect(text).toContain('<b>국내 경제·증권</b>'); expect(text).toContain('<b>해외 뉴스</b>');
    expect(text).toContain('한국경제 증권 원문'); expect(text).toContain('BBC 경제 원문');
    expect(text.length).toBeLessThan(3900); expect(validateTelegramHtml(text).valid).toBe(true);
  });
  it('keeps both groups when AI omits a selected story, and accepts a complete grounded summary', async () => {
    const stories = [domestic('kr1', '한국은행 기준금리 동결'), article()];
    const summary = { id: 'story-1', summary: 'AI 메모리 수요 증가 소식', impact: '호재 가능 · 업종 수요 확인' };
    mocks.ai.mockResolvedValueOnce(JSON.stringify([summary]));
    const fallback = await buildGlobalMorningBrief(stories, [], now);
    expect(fallback.mode).toBe('SOURCE_HEADLINES'); expect(fallback.items).toHaveLength(2);
    mocks.ai.mockResolvedValueOnce(JSON.stringify([summary, { id: 'kr1', summary: '한국은행 기준금리 동결 소식', impact: '방향 미확인 · 국내 반응 확인' }]));
    expect((await buildGlobalMorningBrief(stories, [], now)).mode).toBe('AI_SUMMARY');
  });
  it('shows domestic collection failure separately from a successfully checked empty feed', () => {
    const source = { feedId: 'kr-hankyung-finance', name: '한국경제 증권', checkedAt: now.toISOString(), count: 0 };
    const missing = formatGlobalMorningBrief(sourceHeadlineBrief([article()], [{ ...source, error: 'offline' }], now));
    expect(missing).toContain('국내 RSS 0/4'); expect(missing).toContain('수집 상태 미확인');
    const empty = formatGlobalMorningBrief(sourceHeadlineBrief([], [source], now));
    expect(empty).toContain('국내 RSS 1/4');
    expect(empty).toContain('<b>국내 경제·증권</b>\n수집 범위에서 해당 시간대 주요 기사 없음');
  });
  it('retains source groups and valid HTML even when long escaped stories need omission', () => {
    const stories = [domestic('kr1', '국내 반도체 실적 발표'), article()];
    const brief = sourceHeadlineBrief(stories, [], now);
    brief.items = brief.items.flatMap(item => [item, { ...item, summary: '<&>'.repeat(80) }]);
    const text = formatGlobalMorningBrief(brief);
    expect(text).toContain('국내 반도체 실적 발표'); expect(text).toContain('Nvidia memory chip demand increases');
    expect(text.length).toBeLessThan(3900); expect(validateTelegramHtml(text).valid).toBe(true);
  });
  it('includes the weekend and Korean holidays, excluding after-cutoff, future-seen, and old stories', () => {
    expect(globalBriefWindow(now)).toMatchObject({ from: '2026-09-18T06:30:00.000Z', cutoff: '2026-09-20T23:30:00.000Z' });
    expect(globalBriefWindow(new Date('2026-09-28T08:30:00+09:00')).from).toBe('2026-09-23T06:30:00.000Z');
    expect(selectGlobalNews([article(), article({ id: 'late', publishedAt: '2026-09-20T23:31:00.000Z' }),
      article({ id: 'old', publishedAt: '2026-09-18T06:29:00.000Z' }), article({ id: 'future', firstSeenAt: '2026-09-21T00:00:00.000Z' })], now)).toHaveLength(1);
  });
  it('deduplicates near-identical event headlines and balances topics', () => {
    const stories = [article(), article({ id: 'dup', url: 'https://www.bbc.com/news/duplicate', title: 'Nvidia memory chip demand increases again' }), article({ id: 'oil', url: 'https://www.bbc.com/news/oil', title: 'Oil prices fall as supply expands', excerpt: '' })];
    expect(selectGlobalNews(stories, now).map(item => item.id)).toEqual(['story-1', 'oil']);
  });
  it('distinguishes explicit mentions from sector hypotheses without inventing contracts', () => {
    expect(relatedNewsStocks(article()).map(stock => stock.relation)).toEqual(['SECTOR', 'SECTOR']);
    expect(relatedNewsStocks(article({ title: 'SK hynix announces HBM update' }))[0]).toMatchObject({ symbol: '000660', relation: 'MENTIONED' });
    expect(relatedNewsStocks(article({ title: 'Federal Reserve speaks on rates', excerpt: '' }))).toEqual([]);
    expect(relatedNewsStocks(article({ title: 'Oil prices rise', excerpt: '' })).map(stock => stock.symbol)).toEqual(['010950', '003490']);
    expect(relatedNewsStocks(article({ title: 'Samsung SDI and Hyundai Heavy Industries', excerpt: '' }))).toEqual([]);
  });
  it('rejects model invented article IDs, duplicate IDs, invalid impact labels and unsafe summaries', () => {
    const valid = { id: 'story-1', summary: 'AI 메모리 수요 증가 소식', impact: '호재 가능 · 메모리 수요 확인' };
    expect(parseGlobalBriefSummary(JSON.stringify([valid]), [article()])[0].article.url).toBe(article().url);
    for (const value of [{ ...valid, id: 'made-up' }, { ...valid, impact: '무조건 매수' }, { ...valid, summary: '<b>반도체 소식</b>' }, { ...valid, summary: '메모리 수요 30% 증가' }]) {
      expect(() => parseGlobalBriefSummary(JSON.stringify([value]), [article()])).toThrow();
    }
    expect(() => parseGlobalBriefSummary(JSON.stringify([valid, valid]), [article()])).toThrow();
  });
  it('uses supplied facts with search disabled and falls back honestly on timeout', async () => {
    mocks.ai.mockResolvedValueOnce(JSON.stringify([{ id: 'story-1', summary: 'AI 메모리 수요 증가 소식', impact: '호재 가능 · 업종 수요 확인' }]));
    expect((await buildGlobalMorningBrief([article()], [], now)).mode).toBe('AI_SUMMARY');
    expect(mocks.ai.mock.calls[0][1]).toMatchObject({ useSearch: false, prependPersona: false });
    vi.useFakeTimers(); mocks.ai.mockImplementationOnce(() => new Promise(() => {}));
    const pending = buildGlobalMorningBrief([article()], [], now);
    await vi.advanceTimersByTimeAsync(25_001);
    expect(await pending).toMatchObject({ mode: 'SOURCE_HEADLINES', issue: expect.stringContaining('원문 제목') });
  });
  it.each([
    ['Treasury yields ease as global borrowing costs tumble', "Treasury yields were lower following last week's interest rate bonanza.", '미국 국채 금리가 지난주 금리 인상 이후 하락했습니다.'],
    ['Treasury yields fall', 'Bond yields were lower on Monday.', '미 연준의 금리 인하 이후 국채 금리가 하락했습니다.'],
    ['Yemenis flee across Red Sea as war escalates', 'People have fled the war by crossing the Red Sea to Djibouti.', '수천 명의 예멘인들이 홍해를 건너 피난하고 있습니다.'],
  ])('falls back when the summary adds unsupported policy actions or word quantities: %s', async (title, excerpt, summary) => {
    const input = article({ title, excerpt });
    const output = JSON.stringify([{ id: input.id, summary, impact: '방향 미확인 · 국내 반응 확인' }]);
    expect(() => parseGlobalBriefSummary(output, [input])).toThrow();
    mocks.ai.mockResolvedValueOnce(output);
    const brief = await buildGlobalMorningBrief([input], [], now);
    expect(brief.mode).toBe('SOURCE_HEADLINES');
    expect(brief.items[0].summary).toBe(title);
  });
  it.each([
    ['Treasury yields ease', '미국 국채 금리가 하락했습니다.'],
    ['Fed raises interest rates', '미 연준이 금리를 인상했습니다.'],
    ['Central bank announces rate cut', '중앙은행이 금리 인하를 발표했습니다.'],
    ['한국은행 기준금리 인하 발표', '한국은행 기준금리 인하 소식입니다.'],
  ])('retains supported rate wording: %s', (title, summary) => {
    expect(parseGlobalBriefSummary(JSON.stringify([{ id: 'story-1', summary, impact: '혼재 · 국내 반응 확인' }]), [article({ title, excerpt: '' })])[0].summary).toBe(summary);
  });
  it('keeps links, escaped text, exposure reasons and the whole message below Telegram limit', () => {
    const brief = sourceHeadlineBrief([article({ title: '<Nvidia & chips>' })], [], now);
    const text = formatGlobalMorningBrief(brief);
    expect(text).toContain('&lt;Nvidia &amp; chips&gt;');
    expect(text).toContain('https://www.bbc.com/news/articles/story-1');
    expect(text).toContain('업종 연관 추정'); expect(text).toContain('005930');
    expect(text).toContain('일부 출처 미확인'); expect(text.length).toBeLessThan(3900);
    expect(formatGlobalMorningBrief(sourceHeadlineBrief([], [], now))).toContain('뉴스 부재나 시장 안정으로 해석하지 않습니다');
  });
});

describe('durable background preparation', () => {
  beforeEach(() => { mocks.directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qmp-global-news-')); vi.resetModules(); });
  afterEach(() => { fs.rmSync(mocks.directory, { recursive: true, force: true }); });
  it('collects newly added feeds despite a recent legacy poll and retains the saved daily brief', async () => {
    const previous = sourceHeadlineBrief([article()], [], now);
    const file = path.join(mocks.directory, 'global-morning-news.json');
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, lastAttemptAt: now.toISOString(), articles: [],
      sources: GLOBAL_NEWS_FEEDS.filter(feed => !isDomesticNewsFeed(feed.id)).map(feed => ({ feedId: feed.id, name: feed.name, checkedAt: now.toISOString(), count: 0 })),
      briefs: [previous] }));
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => new Response(xml(url.includes('hankyung.com/feed/finance')
      ? rssItem('삼성전자 반도체 투자 계획 발표', 'https://www.hankyung.com/article/domestic') : ''))));
    const runtime = await import('./globalNewsRuntime.js');
    runtime.maintainGlobalMorningNews(new Date(now.getTime() + 60_000));
    await runtime.refreshGlobalMorningNews(now);
    expect(fetch).toHaveBeenCalledTimes(GLOBAL_NEWS_FEEDS.length);
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(saved.articles[0]).toMatchObject({ feedId: 'kr-hankyung-finance', title: '삼성전자 반도체 투자 계획 발표' });
    expect(saved.briefs).toEqual([previous]);
    vi.resetModules();
    expect((await import('./globalNewsRuntime.js')).getGlobalMorningPreview(now)).toMatchObject({ ready: true, archiveCount: 1 });
    expect(mocks.ai).not.toHaveBeenCalled();
  });
  it('revalidates saved AI summaries after restart without resending, fetching or changing the source archive', async () => {
    const input = article({ title: 'Treasury yields fall', excerpt: 'Bond yields were lower on Monday.' });
    const brief = sourceHeadlineBrief([input], [], now);
    brief.mode = 'AI_SUMMARY'; brief.items[0].summary = '미 연준의 금리 인하 이후 국채 금리가 하락했습니다.';
    const file = path.join(mocks.directory, 'global-morning-news.json');
    const original = JSON.stringify({ schemaVersion: 1, lastAttemptAt: now.toISOString(), articles: [input], sources: [], briefs: [brief] });
    fs.writeFileSync(file, original); vi.stubGlobal('fetch', vi.fn());
    const runtime = await import('./globalNewsRuntime.js');
    expect(runtime.getGlobalMorningPreview(now)).toMatchObject({ ready: true, mode: 'SOURCE_HEADLINES', items: [{ summary: input.title }] });
    expect(fetch).not.toHaveBeenCalled(); expect(mocks.ai).not.toHaveBeenCalled();
    expect(fs.readFileSync(file, 'utf8')).toBe(original);
  });
  it('persists a daily brief, coalesces concurrent work, and reads it after restart without sending or another AI call', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(xml(''))));
    // A fresh response per call is required because streams are consumable.
    vi.mocked(fetch).mockImplementation(async () => new Response(xml('')));
    const runtime = await import('./globalNewsRuntime.js');
    const first = runtime.refreshGlobalMorningNews(now);
    expect(runtime.refreshGlobalMorningNews(now)).toBe(first);
    await first;
    expect(runtime.getGlobalMorningPreview(now).ready).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(GLOBAL_NEWS_FEEDS.length);
    vi.resetModules();
    const restarted = await import('./globalNewsRuntime.js');
    restarted.maintainGlobalMorningNews(new Date('2026-09-21T08:45:00+09:00'));
    expect(restarted.getGlobalMorningMessage(now)).toContain('해외 뉴스');
    expect(fetch).toHaveBeenCalledTimes(GLOBAL_NEWS_FEEDS.length); expect(mocks.ai).not.toHaveBeenCalled();
  });
  it('returns immediately while collection is pending and provides a bounded late-start fallback', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => { await gate; return new Response(xml('')); }));
    const runtime = await import('./globalNewsRuntime.js');
    expect(runtime.maintainGlobalMorningNews(now)).toBeUndefined();
    expect(runtime.getGlobalMorningMessage(new Date('2026-09-21T08:45:00+09:00'))).toBeNull();
    expect(runtime.getGlobalMorningMessage(new Date('2026-09-21T08:50:00+09:00'))).toContain('준비 지연');
    release(); await runtime.refreshGlobalMorningNews(now);
  });
  it('preserves a corrupted archive and still makes the unavailable status reportable', async () => {
    const file = path.join(mocks.directory, 'global-morning-news.json'); fs.writeFileSync(file, '{broken');
    vi.stubGlobal('fetch', vi.fn());
    const runtime = await import('./globalNewsRuntime.js');
    await runtime.refreshGlobalMorningNews(now);
    expect(fetch).not.toHaveBeenCalled(); expect(fs.readFileSync(file, 'utf8')).toBe('{broken');
    expect(runtime.getGlobalMorningMessage(new Date('2026-09-21T08:50:00+09:00'))).toContain('저장 자료 확인 필요');
  });
});
