/**
 * @responsibility /program_market_probe — KIS 시장 프로그램매매 파라미터 조합을 read-only로 탐색한다.
 *
 * PR-567: comp-program-trade-today 가 필드 누락/값 길이 오류를 순차적으로 반환하므로,
 * 단일 파라미터 추측 PR 반복 대신 작은 후보군을 안전하게 순회해 KIS가 실제로
 * 수용하는 조합을 찾는다. 외부 상태 저장 없음, read-only GET만 수행.
 */

import { realDataKisGet } from '../../../clients/kisClient/http.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const TR_ID = process.env.KIS_MARKET_PROGRAM_TRADE_TR_ID ?? 'FHPPG04600101';
const API_PATH = process.env.KIS_MARKET_PROGRAM_TRADE_PATH
  ?? '/uapi/domestic-stock/v1/quotations/comp-program-trade-today';
const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 40;

type ProbeRoot = Record<string, unknown> | null;

interface ProbeCandidate {
  cond: string;
  market: string;
  section: string;
  input: string;
}

interface ProbeResult {
  candidate: ProbeCandidate;
  rtCd: string;
  msgCd: string;
  msg1: string;
  outputPath: string;
  outputKeys: string[];
  success: boolean;
}

function parseLimit(args: string[]): number {
  const raw = Number(args.find((arg) => /^\d+$/.test(arg)) ?? DEFAULT_LIMIT);
  if (!Number.isFinite(raw)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(raw)));
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((v) => v !== undefined && v !== null))];
}

function buildCandidates(limit: number): ProbeCandidate[] {
  const conds = unique([process.env.KIS_MARKET_PROGRAM_DIV_CODE ?? 'J', 'J', 'U']);
  const markets = unique([process.env.KIS_MARKET_PROGRAM_MARKET_CLASS_CODE ?? '1', '0', '1', 'K', 'Q', 'J']);
  const sections = unique([process.env.KIS_MARKET_PROGRAM_SECTION_CLASS_CODE ?? '0', '0', '1', '01', '02']);
  const inputs = unique([process.env.KIS_MARKET_PROGRAM_INDEX_CODE ?? '0001', '0001', '0000', '']);

  const candidates: ProbeCandidate[] = [];
  for (const cond of conds) {
    for (const market of markets) {
      for (const section of sections) {
        for (const input of inputs) {
          candidates.push({ cond, market, section, input });
          if (candidates.length >= limit) return candidates;
        }
      }
    }
  }
  return candidates;
}

function firstOutput(data: ProbeRoot): { path: string; out: Record<string, unknown> | undefined } {
  if (!data || typeof data !== 'object') return { path: 'NONE', out: undefined };
  const root = data as { output?: unknown; output1?: unknown; output2?: unknown };
  if (root.output && typeof root.output === 'object' && !Array.isArray(root.output)) return { path: 'output', out: root.output as Record<string, unknown> };
  if (Array.isArray(root.output) && root.output.length > 0 && typeof root.output[0] === 'object') return { path: 'output[0]', out: root.output[0] as Record<string, unknown> };
  if (root.output1 && typeof root.output1 === 'object' && !Array.isArray(root.output1)) return { path: 'output1', out: root.output1 as Record<string, unknown> };
  if (Array.isArray(root.output1) && root.output1.length > 0 && typeof root.output1[0] === 'object') return { path: 'output1[0]', out: root.output1[0] as Record<string, unknown> };
  if (Array.isArray(root.output2) && root.output2.length > 0 && typeof root.output2[0] === 'object') return { path: 'output2[0]', out: root.output2[0] as Record<string, unknown> };
  return { path: 'NONE', out: undefined };
}

function rootString(data: ProbeRoot, key: string): string {
  const value = data && typeof data === 'object' ? (data as Record<string, unknown>)[key] : undefined;
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

async function probeOne(candidate: ProbeCandidate): Promise<ProbeResult> {
  const params: Record<string, string> = {
    FID_COND_MRKT_DIV_CODE: candidate.cond,
    FID_MRKT_CLS_CODE: candidate.market,
    FID_SCTN_CLS_CODE: candidate.section,
  };
  if (candidate.input !== '') params.FID_INPUT_ISCD = candidate.input;

  const data = await realDataKisGet(TR_ID, API_PATH, params, 'LOW') as ProbeRoot;
  const { path, out } = firstOutput(data);
  const rtCd = rootString(data, 'rt_cd');
  const msgCd = rootString(data, 'msg_cd');
  const msg1 = rootString(data, 'msg1');
  const outputKeys = out ? Object.keys(out).slice(0, 10) : [];
  return {
    candidate,
    rtCd,
    msgCd,
    msg1,
    outputPath: path,
    outputKeys,
    success: rtCd === '0' && Boolean(out),
  };
}

function shortMsg(msg: string): string {
  if (!msg) return 'NO_MSG';
  return msg.length > 72 ? `${msg.slice(0, 69)}...` : msg;
}

function renderResultLine(index: number, result: ProbeResult): string {
  const c = result.candidate;
  const status = result.success ? '✅' : result.rtCd === '0' ? '🟡' : '❌';
  return `${index}. ${status} cond=${c.cond} mrkt=${c.market} sctn=${c.section} iscd=${c.input || 'OMIT'} | ${result.msgCd || 'NO_CD'} ${shortMsg(result.msg1)} | path=${result.outputPath} keys=${result.outputKeys.join('|') || 'NONE'}`;
}

export async function buildProgramMarketProbeMessage(args: string[] = []): Promise<string> {
  const limit = parseLimit(args);
  const candidates = buildCandidates(limit);
  const results: ProbeResult[] = [];

  for (const candidate of candidates) {
    results.push(await probeOne(candidate));
    if (results.some((r) => r.success)) break;
  }

  const best = results.find((r) => r.success);
  const lines: string[] = [
    '🧪 KIS 시장 프로그램매매 파라미터 Probe',
    `trId=${TR_ID}`,
    `path=${API_PATH}`,
    `tested=${results.length}/${candidates.length}`,
    '',
  ];

  if (best) {
    lines.push('🎯 BEST CANDIDATE');
    lines.push(renderResultLine(1, best));
    lines.push('');
  } else {
    lines.push('🎯 BEST CANDIDATE: 없음');
    lines.push('');
  }

  lines.push('최근 결과');
  results.slice(-12).forEach((result, idx) => lines.push(renderResultLine(idx + 1, result)));
  lines.push('');
  lines.push('판정: ✅=output 확보 / 🟡=rt_cd 0이지만 output 없음 / ❌=KIS 파라미터 오류');

  const message = lines.join('\n');
  return message.length <= 4096 ? message : `${message.slice(0, 4050)}\n...`;
}

const programMarketProbe: TelegramCommand = {
  name: '/program_market_probe',
  aliases: ['/pmp'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'KIS 시장 프로그램매매 파라미터 후보 조합 probe',
  usage: '/program_market_probe [limit=24]',
  async execute({ args, reply }) {
    try {
      await reply(await buildProgramMarketProbeMessage(args));
    } catch (err) {
      console.error('[programMarketProbe.cmd] failed', err);
      await reply('❌ 시장 프로그램매매 파라미터 Probe 실패 — 서버 로그 확인 필요');
    }
  },
};

commandRegistry.register(programMarketProbe);

export default programMarketProbe;
