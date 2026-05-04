/**
 * @responsibility /investor_flow_seed — 기관/외인 수급 CACHE provider 를 수동 seed/조회/삭제한다.
 *
 * PR-586: KRX/Naver 실제 collector 연결 전, cache 경로가 /sh 를 초록으로 바꿀 수 있는지 검증하는
 * 관리자 전용 warm-up 명령. fake-zero 방지를 위해 명시 입력값만 저장한다.
 */

import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import {
  clearInvestorFlowCache,
  countInvestorFlowCacheCodes,
  listInvestorFlowCacheRows,
  loadInvestorFlowCache,
  todayKst,
  upsertInvestorFlowCache,
  type InvestorFlowCacheRow,
} from '../../../persistence/investorFlowCacheRepo.js';

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
    '/investor_flow_cache [종목코드]',
    '/investor_flow_cache_clear [종목코드]',
    '',
    '예:',
    '/investor_flow_seed 041910 1000000 500000 -1500000',
  ].join('\n');
}

export async function buildInvestorFlowSeedMessage(args: string[]): Promise<string> {
  const [codeRaw, foreignRaw, institutionalRaw, individualRaw, dateRaw] = args;
  const code = normalizeCode(codeRaw ?? '');
  const foreignNetBuy = parseNumber(foreignRaw);
  const institutionalNetBuy = parseNumber(institutionalRaw);
  const individualNetBuy = parseNumber(individualRaw);
  const date = dateRaw && /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : todayKst();

  if (!/^\d{6}$/.test(code) || foreignNetBuy === null || institutionalNetBuy === null || individualNetBuy === null) {
    return `❌ 입력 오류\n${usage()}`;
  }

  upsertInvestorFlowCache({
    stockCode: code,
    date,
    foreignNetBuy,
    institutionalNetBuy,
    individualNetBuy,
    provider: 'CACHE',
    fetchedAt: new Date().toISOString(),
  });

  const cached = loadInvestorFlowCache(code, date);
  return [
    '✅ 기관/외인 수급 cache seed 완료',
    `code=${code}`,
    `date=${date}`,
    `foreignNetBuy=${formatNumber(foreignNetBuy)}`,
    `institutionalNetBuy=${formatNumber(institutionalNetBuy)}`,
    `individualNetBuy=${formatNumber(individualNetBuy)}`,
    `verify=${cached ? 'CACHE:OK' : 'CACHE:MISS'}`,
    '',
    '다음 확인: /sh',
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
commandRegistry.register(investorFlowCache);
commandRegistry.register(investorFlowCacheClear);

export default investorFlowSeed;
