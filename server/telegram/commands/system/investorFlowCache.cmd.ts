/**
 * @responsibility /investor_flow_seed — 기관/외인 수급 CACHE provider 를 수동 seed/조회/삭제한다.
 *
 * PR-586: KRX/Naver 실제 collector 연결 전, cache 경로가 /sh 를 초록으로 바꿀 수 있는지 검증하는
 * 관리자 전용 warm-up 명령. fake-zero 방지를 위해 명시 입력값만 저장한다.
 * PR-589: 여러 종목을 한 번에 seed 하는 bulk 명령을 추가해 운영 피로도를 줄인다.
 * PR-590: stage2Score 상위 10개 중 cache 미보유 종목의 /ifsb 템플릿을 자동 생성한다.
 */

import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import { loadWatchlist, type WatchlistEntry } from '../../../persistence/watchlistRepo.js';
import {
  clearInvestorFlowCache,
  countInvestorFlowCacheCodes,
  listInvestorFlowCacheRows,
  loadInvestorFlowCache,
  todayKst,
  upsertInvestorFlowCache,
  type InvestorFlowCacheRow,
} from '../../../persistence/investorFlowCacheRepo.js';

const DEFAULT_TEMPLATE_LIMIT = 10;

interface ParsedSeedRow {
  code: string;
  foreignNetBuy: number;
  institutionalNetBuy: number;
  individualNetBuy: number;
  date: string;
}

function normalizeCode(code: string): string {
  return code.replace(/[^0-9]/g, '').slice(0, 6).padStart(6, '0');
}

function parseNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function formatNumber(n: number): string {
  return n.toLocaleString('ko-KR');
}

function renderRows(rows: InvestorFlowCacheRow[], title = '기관/외인 수급 cache'): string {
  const lines = [`📦 ${title}`, `codes=${countInvestorFlowCacheCodes()} rows=${rows.length}`];
  if (rows.length === 0) {
    lines.push('비어 있음');
    return lines.join('\n');
  }
  for (const row of rows.slice(0, 12)) {
    lines.push(`${row.stockCode} ${row.date} f=${formatNumber(row.foreignNetBuy)} i=${formatNumber(row.institutionalNetBuy)} 개인=${formatNumber(row.individualNetBuy)} provider=${row.provider}`);
  }
  if (rows.length > 12) lines.push(`...외 ${rows.length - 12}건`);
  return lines.join('\n');
}

function usage(): string {
  return [
    '사용법:',
    '/investor_flow_seed <종목코드> <외인순매수> <기관순매수> <개인순매수> [YYYY-MM-DD]',
    '/investor_flow_seed_bulk <code> <foreign> <institution> <individual>; <code> <foreign> <institution> <individual>; ...',
    '/investor_flow_seed_template [limit]',
    '/investor_flow_cache [종목코드]',
    '/investor_flow_cache_clear [종목코드]',
    '',
    '예:',
    '/investor_flow_seed 041910 1000000 500000 -1500000',
    '/ifsb 041910 1000000 500000 -1500000; 045390 -200000 800000 -600000',
    '/ifst 10',
  ].join('\n');
}

function parseSeedRow(parts: string[], defaultDate = todayKst()): ParsedSeedRow | null {
  const [codeRaw, foreignRaw, institutionalRaw, individualRaw, dateRaw] = parts;
  const code = normalizeCode(codeRaw ?? '');
  const foreignNetBuy = parseNumber(foreignRaw);
  const institutionalNetBuy = parseNumber(institutionalRaw);
  const individualNetBuy = parseNumber(individualRaw);
  const date = dateRaw && /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : defaultDate;
  if (!/^\d{6}$/.test(code) || foreignNetBuy === null || institutionalNetBuy === null || individualNetBuy === null) return null;
  return { code, foreignNetBuy, institutionalNetBuy, individualNetBuy, date };
}

function upsertParsedSeed(row: ParsedSeedRow): void {
  upsertInvestorFlowCache({
    stockCode: row.code,
    date: row.date,
    foreignNetBuy: row.foreignNetBuy,
    institutionalNetBuy: row.institutionalNetBuy,
    individualNetBuy: row.individualNetBuy,
    provider: 'CACHE',
    fetchedAt: new Date().toISOString(),
  });
}

function splitBulkRows(args: string[]): string[][] {
  const joined = args.join(' ').trim();
  if (!joined) return [];
  return joined
    .split(/[;\n]+/g)
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => row.replace(/,/g, ' ').split(/\s+/g).filter(Boolean));
}

function selectTopWatchlist(limit: number): WatchlistEntry[] {
  return [...loadWatchlist()]
    .sort((a, b) => Number((b as any).stage2Score ?? b.gateScore ?? 0) - Number((a as any).stage2Score ?? a.gateScore ?? 0))
    .slice(0, limit);
}

function placeholderFor(index: number): { foreignNetBuy: number; institutionalNetBuy: number; individualNetBuy: number } {
  // fake-zero 방지용 non-zero 템플릿. 운영자가 실제값으로 바꾸기 쉽도록 규칙적인 작은 값 사용.
  const foreignNetBuy = (index % 2 === 0 ? 1 : -1) * (100_000 + index * 10_000);
  const institutionalNetBuy = (index % 3 === 0 ? 1 : -1) * (200_000 + index * 10_000);
  return { foreignNetBuy, institutionalNetBuy, individualNetBuy: -(foreignNetBuy + institutionalNetBuy) };
}

export async function buildInvestorFlowSeedMessage(args: string[]): Promise<string> {
  const parsed = parseSeedRow(args);
  if (!parsed) return `❌ 입력 오류\n${usage()}`;
  upsertParsedSeed(parsed);
  const cached = loadInvestorFlowCache(parsed.code, parsed.date);
  return [
    '✅ 기관/외인 수급 cache seed 완료',
    `code=${parsed.code}`,
    `date=${parsed.date}`,
    `foreignNetBuy=${formatNumber(parsed.foreignNetBuy)}`,
    `institutionalNetBuy=${formatNumber(parsed.institutionalNetBuy)}`,
    `individualNetBuy=${formatNumber(parsed.individualNetBuy)}`,
    `verify=${cached ? 'CACHE:OK' : 'CACHE:MISS'}`,
    '',
    '다음 확인: /sh',
  ].join('\n');
}

export async function buildInvestorFlowBulkSeedMessage(args: string[]): Promise<string> {
  const rowParts = splitBulkRows(args);
  if (rowParts.length === 0) return `❌ 입력 오류\n${usage()}`;

  const ok: ParsedSeedRow[] = [];
  const failed: string[] = [];
  for (const parts of rowParts.slice(0, 50)) {
    const parsed = parseSeedRow(parts);
    if (!parsed) {
      failed.push(parts.join(' '));
      continue;
    }
    upsertParsedSeed(parsed);
    ok.push(parsed);
  }

  const verified = ok.filter((row) => loadInvestorFlowCache(row.code, row.date)).length;
  const lines = [
    '✅ 기관/외인 수급 bulk seed 완료',
    `accepted=${ok.length}`,
    `failed=${failed.length}`,
    `verify=CACHE:OK ${verified}/${ok.length}`,
  ];
  for (const row of ok.slice(0, 10)) lines.push(`${row.code} ${row.date} f=${formatNumber(row.foreignNetBuy)} i=${formatNumber(row.institutionalNetBuy)} 개인=${formatNumber(row.individualNetBuy)}`);
  if (ok.length > 10) lines.push(`...외 ${ok.length - 10}건`);
  if (failed.length > 0) {
    lines.push('', '❌ 실패 row');
    for (const bad of failed.slice(0, 5)) lines.push(bad);
    if (failed.length > 5) lines.push(`...외 ${failed.length - 5}건`);
  }
  lines.push('', '다음 확인: /ifc 또는 /sh');
  return lines.join('\n');
}

export async function buildInvestorFlowSeedTemplateMessage(args: string[]): Promise<string> {
  const requested = Number.parseInt(args[0] ?? String(DEFAULT_TEMPLATE_LIMIT), 10);
  const limit = Number.isFinite(requested) ? Math.max(1, Math.min(20, requested)) : DEFAULT_TEMPLATE_LIMIT;
  const top = selectTopWatchlist(limit);
  const missing = top.filter((entry) => !loadInvestorFlowCache(entry.code));
  if (missing.length === 0) {
    return `✅ stage2Score 상위 ${top.length}개 모두 investor-flow cache 존재\n다음 확인: /sh`;
  }
  const rows = missing.map((entry, index) => {
    const p = placeholderFor(index);
    return `${entry.code} ${p.foreignNetBuy} ${p.institutionalNetBuy} ${p.individualNetBuy}`;
  });
  return [
    '🧩 기관/외인 수급 missing seed 템플릿',
    `top=${top.length} missing=${missing.length}`,
    '주의: 아래 값은 non-zero 임시값입니다. 실제 수급값으로 교체 권장.',
    '',
    `/ifsb ${rows.join('; ')}`,
  ].join('\n');
}

export async function buildInvestorFlowCacheMessage(args: string[]): Promise<string> {
  const code = args[0] ? normalizeCode(args[0]) : undefined;
  return renderRows(listInvestorFlowCacheRows(code), code ? `기관/외인 수급 cache ${code}` : '기관/외인 수급 cache');
}

export async function buildInvestorFlowCacheClearMessage(args: string[]): Promise<string> {
  const code = args[0] ? normalizeCode(args[0]) : undefined;
  const removed = clearInvestorFlowCache(code);
  return `🧹 기관/외인 수급 cache 삭제 완료\ntarget=${code ?? 'ALL'}\nremoved=${removed}`;
}

const investorFlowSeed: TelegramCommand = {
  name: '/investor_flow_seed',
  aliases: ['/ifs'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '기관/외인 수급 cache 수동 seed',
  usage: '/investor_flow_seed <code> <foreignNetBuy> <institutionalNetBuy> <individualNetBuy> [YYYY-MM-DD]',
  async execute({ args, reply }) {
    try { await reply(await buildInvestorFlowSeedMessage(args)); }
    catch (err) { console.error('[investorFlowSeed.cmd] failed', err); await reply('❌ investor flow seed 실패 — 서버 로그 확인 필요'); }
  },
};

const investorFlowBulkSeed: TelegramCommand = {
  name: '/investor_flow_seed_bulk',
  aliases: ['/ifsb'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '기관/외인 수급 cache bulk seed',
  usage: '/investor_flow_seed_bulk <code foreign institution individual; ...>',
  async execute({ args, reply }) {
    try { await reply(await buildInvestorFlowBulkSeedMessage(args)); }
    catch (err) { console.error('[investorFlowBulkSeed.cmd] failed', err); await reply('❌ investor flow bulk seed 실패 — 서버 로그 확인 필요'); }
  },
};

const investorFlowSeedTemplate: TelegramCommand = {
  name: '/investor_flow_seed_template',
  aliases: ['/ifst'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'stage2Score 상위 종목 중 investor-flow cache 미보유 seed 템플릿 생성',
  usage: '/investor_flow_seed_template [limit]',
  async execute({ args, reply }) {
    try { await reply(await buildInvestorFlowSeedTemplateMessage(args)); }
    catch (err) { console.error('[investorFlowSeedTemplate.cmd] failed', err); await reply('❌ investor flow seed template 실패 — 서버 로그 확인 필요'); }
  },
};

const investorFlowCache: TelegramCommand = {
  name: '/investor_flow_cache',
  aliases: ['/ifc'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '기관/외인 수급 cache 조회',
  usage: '/investor_flow_cache [code]',
  async execute({ args, reply }) {
    try { await reply(await buildInvestorFlowCacheMessage(args)); }
    catch (err) { console.error('[investorFlowCache.cmd] failed', err); await reply('❌ investor flow cache 조회 실패 — 서버 로그 확인 필요'); }
  },
};

const investorFlowCacheClear: TelegramCommand = {
  name: '/investor_flow_cache_clear',
  aliases: ['/ifcc'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '기관/외인 수급 cache 삭제',
  usage: '/investor_flow_cache_clear [code]',
  async execute({ args, reply }) {
    try { await reply(await buildInvestorFlowCacheClearMessage(args)); }
    catch (err) { console.error('[investorFlowCacheClear.cmd] failed', err); await reply('❌ investor flow cache 삭제 실패 — 서버 로그 확인 필요'); }
  },
};

commandRegistry.register(investorFlowSeed);
commandRegistry.register(investorFlowBulkSeed);
commandRegistry.register(investorFlowSeedTemplate);
commandRegistry.register(investorFlowCache);
commandRegistry.register(investorFlowCacheClear);

export default investorFlowSeed;
