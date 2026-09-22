// @responsibility Prepare persistent overseas news briefs independently of observation delivery.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DATA_DIR } from '../persistence/paths.js';
import { isKrxTradingDay } from '../calendar/krxTradingCalendar.js';
import { canonicalNewsUrl, collectGlobalNews, mergeGlobalNews, GLOBAL_NEWS_FEEDS, type GlobalNewsArticle, type GlobalNewsSourceStatus } from './globalNewsSources.js';
import { buildGlobalMorningBrief, formatGlobalMorningBrief, globalBriefWindow, parseGlobalBriefSummary, sourceHeadlineBrief, type GlobalMorningBrief } from './globalNewsBriefing.js';

interface GlobalNewsCache {
  schemaVersion: 1; lastAttemptAt: string | null; articles: GlobalNewsArticle[]; sources: GlobalNewsSourceStatus[]; briefs: GlobalMorningBrief[];
}
const articleSchema = z.object({
  id: z.string().min(1), feedId: z.string(), source: z.string(), title: z.string().max(240), excerpt: z.string().max(650),
  url: z.string(), publishedAt: z.iso.datetime(), firstSeenAt: z.iso.datetime(),
}).refine(item => GLOBAL_NEWS_FEEDS.some(feed => feed.id === item.feedId && canonicalNewsUrl(item.url, feed) === item.url));
const sourceSchema = z.object({ feedId: z.string(), name: z.string(), checkedAt: z.iso.datetime(), count: z.number().int().nonnegative(), error: z.string().optional() });
const cacheSchema = z.object({
  schemaVersion: z.literal(1), lastAttemptAt: z.iso.datetime().nullable(), articles: z.array(articleSchema).max(2000), sources: z.array(sourceSchema).max(5),
  briefs: z.array(z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), from: z.iso.datetime(), cutoff: z.iso.datetime(), generatedAt: z.iso.datetime(),
    mode: z.enum(['AI_SUMMARY', 'SOURCE_HEADLINES']), candidateCount: z.number().int().nonnegative(), sources: z.array(sourceSchema).max(5), issue: z.string().optional(),
    items: z.array(z.object({ article: articleSchema, summary: z.string().max(240), impact: z.string().max(90),
      related: z.array(z.object({ symbol: z.string().regex(/^\d{6}$/), name: z.string(), relation: z.enum(['MENTIONED', 'SECTOR']), reason: z.string(), businessSource: z.string() })).max(2),
    })).max(5),
  })).max(14),
});
const file = path.join(DATA_DIR, 'global-morning-news.json');
let cache: GlobalNewsCache | undefined;
let running: Promise<void> | undefined;
let lastStartedAt = 0;
let serviceIssue: string | undefined;

function readCache(): GlobalNewsCache {
  if (cache) return cache;
  if (!fs.existsSync(file)) return cache = { schemaVersion: 1, lastAttemptAt: null, articles: [], sources: [], briefs: [] };
  const value = cacheSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
  value.briefs = value.briefs.map(brief => {
    if (brief.mode !== 'AI_SUMMARY') return brief;
    const articles = brief.items.map(item => item.article);
    try {
      const raw = JSON.stringify(brief.items.map(item => ({ id: item.article.id, summary: item.summary, impact: item.impact })));
      return { ...brief, items: parseGlobalBriefSummary(raw, articles) };
    } catch (error) {
      console.warn('[GlobalNews] 저장 요약 대체:', error instanceof Error ? error.message : 'unknown');
      return { ...sourceHeadlineBrief(articles, brief.sources, new Date(brief.generatedAt), '요약 검증 실패: 확인된 원문 제목으로 대체'), candidateCount: brief.candidateCount };
    }
  });
  cache = value;
  return value;
}
function saveCache(value: GlobalNewsCache): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value), { flag: 'wx' });
    fs.renameSync(temporary, file);
    cache = value;
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

function preparationDue(now: Date, state: GlobalNewsCache): boolean {
  const window = globalBriefWindow(now);
  return isKrxTradingDay(window.date) && now.getTime() >= Date.parse(window.cutoff)
    && now.getTime() < Date.parse(`${window.date}T09:30:00+09:00`) && !state.briefs.some(brief => brief.date === window.date);
}

export function refreshGlobalMorningNews(now = new Date()): Promise<void> {
  if (running) return running;
  lastStartedAt = now.getTime();
  running = (async () => {
    const previous = readCache();
    const collected = await collectGlobalNews(now);
    const state: GlobalNewsCache = { ...previous, articles: mergeGlobalNews(previous.articles, collected.articles, now),
      sources: collected.sources, lastAttemptAt: now.toISOString(),
      briefs: previous.briefs.filter(brief => Date.parse(brief.generatedAt) >= now.getTime() - 14 * 86_400_000) };
    // Persist the factual archive before optional AI work; a failed model never removes source evidence.
    saveCache(state);
    if (preparationDue(now, state)) {
      const brief = await buildGlobalMorningBrief(state.articles, state.sources, now);
      saveCache({ ...state, briefs: [...state.briefs, brief].slice(-14) });
    }
    serviceIssue = undefined;
    console.info(`[GlobalNews] RSS ${state.sources.filter(source => !source.error).length}/${GLOBAL_NEWS_FEEDS.length}, articles=${state.articles.length}`);
  })().catch(error => {
    serviceIssue = '해외 뉴스 저장·수집 확인 필요';
    console.error('[GlobalNews] 갱신 실패:', error instanceof Error ? error.name : 'unknown');
  }).finally(() => { running = undefined; });
  return running;
}

/** The existing minute tick starts background work; it never awaits RSS or Gemini. */
export function maintainGlobalMorningNews(now = new Date()): void {
  if (running || now.getTime() - lastStartedAt < 60_000) return;
  try {
    const state = readCache();
    if (!state.lastAttemptAt || now.getTime() - Date.parse(state.lastAttemptAt) >= 30 * 60_000 || preparationDue(now, state)) void refreshGlobalMorningNews(now);
  } catch (error) {
    lastStartedAt = now.getTime(); serviceIssue = '해외 뉴스 저장 자료 확인 필요';
    console.error('[GlobalNews] 캐시 조회 실패:', error instanceof Error ? error.name : 'unknown');
  }
}

export function getGlobalMorningPreview(now = new Date()) {
  const state = readCache();
  const window = globalBriefWindow(now);
  const saved = state.briefs.find(brief => brief.date === window.date);
  const brief = saved ?? sourceHeadlineBrief(state.articles, state.sources, now, serviceIssue ?? '발송 전 미리보기 · 요약 준비 중');
  return { ready: Boolean(saved), collecting: Boolean(running), lastAttemptAt: state.lastAttemptAt,
    archiveCount: state.articles.length, ...brief, message: formatGlobalMorningBrief(brief) };
}

export function getGlobalMorningMessage(now = new Date()): string | null {
  try {
    const preview = getGlobalMorningPreview(now);
    if (preview.ready) return preview.message;
    // A cold start gets time to prepare; at 08:50 the existing slot still reports a bounded, honest fallback.
    if (now.getTime() >= Date.parse(`${preview.date}T08:50:00+09:00`)) return formatGlobalMorningBrief({ ...preview,
      issue: serviceIssue ?? '요약 준비 지연: 현재 확인된 원문 제목으로 대체' });
  } catch (error) {
    console.error('[GlobalNews] 보고 조회 실패:', error instanceof Error ? error.name : 'unknown');
    if (now.getTime() >= Date.parse(`${globalBriefWindow(now).date}T08:50:00+09:00`)) {
      return formatGlobalMorningBrief(sourceHeadlineBrief([], [], now, '해외 뉴스 저장 자료 확인 필요'));
    }
  }
  return null;
}
