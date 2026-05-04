/**
 * @responsibility /program_market_probe — KIS 시장 프로그램매매 파라미터 조합을 read-only로 탐색한다.
 *
 * PR-567: comp-program-trade-today 가 필드 누락/값 길이 오류를 순차적으로 반환하므로,
 * 단일 파라미터 추측 PR 반복 대신 작은 후보군을 안전하게 순회해 KIS가 실제로
 * 수용하는 조합을 찾는다. 외부 상태 저장 없음, read-only GET만 수행.
 *
 * PR-568: `/pmp` 결과가 전부 `FIELD NOT FOUND [FID_COND_MRKT_DIV_CODE1]` 로
 * 막혔다. 값 후보 문제가 아니라 필드명 suffix 문제이므로 일반형/1-suffix/동시전송
 * 변형을 함께 탐색한다.
 *
 * PR-569: SUFFIX1 단독은 `FIELD NOT FOUND [FID_COND_MRKT_DIV_CODE]` 를 반환했다.
 * STD 단독은 `FIELD NOT FOUND [FID_COND_MRKT_DIV_CODE1]` 였으므로 BOTH 가능성이
 * 가장 높다. BOTH 후보를 선두로 올려 기본 `/pmp` 안에서 반드시 검증되게 한다.
 *
 * PR-570: 텔레그램 출력이 최근 결과만 보여 cond=J 후보의 실패 원인을 숨겼다.
 * 첫 결과/최근 결과/cond별·msg별 요약/가장 진전된 후보를 함께 출력해 다음 원인을
 * 한 번에 식별한다.
 */

import { realDataKisGet } from '../../../clients/kisClient/http.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const TR_ID = process.env.KIS_MARKET_PROGRAM_TRADE_TR_ID ?? 'FHPPG04600101';
const API_PATH = process.env.KIS_MARKET_PROGRAM_TRADE_PATH
  ?? '/uapi/domestic-stock/v1/quotations/comp-program-trade-today';
const DEFAULT_LIMIT = 36;
const MAX_LIMIT = 80;

type ProbeRoot = Record<string, unknown> | null;
type DivFieldMode = 'STD' | 'SUFFIX1' | 'BOTH';

interface ProbeCandidate {
  divMode: DivFieldMode;
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
  const divModes: DivFieldMode[] = ['BOTH', 'SUFFIX1', 'STD'];
  const conds = unique(['J', process.env.KIS_MARKET_PROGRAM_DIV_CODE ?? 'J', 'U']);
  const markets = unique([process.env.KIS_MARKET_PROGRAM_MARKET_CLASS_CODE ?? '1', '1', '0', 'K', 'Q', 'J']);
  const sections = unique([process.env.KIS_MARKET_PROGRAM_SECTION_CLASS_CODE ?? '0', '0', '1', '01', '02']);
  const inputs = unique([process.env.KIS_MARKET_PROGRAM_INDEX_CODE ?? '0001', '0001', '0000', '']);

  const candidates: ProbeCandidate[] = [];
  for (const divMode of divModes) {
    for (const cond of conds) {
      for (const market of markets) {
        for (const section of sections) {
          for (const input of inputs) {
            candidates.push({ divMode, cond, market, section, input });
            if (candidates.length >= limit) return candidates;
          }
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

function buildParams(candidate: ProbeCandidate): Record<string, string> {
  const params: Record<string, string> = {
    FID_MRKT_CLS_CODE: candidate.market,
    FID_SCTN_CLS_CODE: candidate.section,
  };

  if (candidate.divMode === 'STD' || candidate.divMode === 'BOTH') {
    params.FID_COND_MRKT_DIV_CODE = candidate.cond;
  }
  if (candidate.divMode === 'SUFFIX1' || candidate.divMode === 'BOTH') {
    params.FID_COND_MRKT_DIV_CODE1 = candidate.cond;
  }
  if (candidate.input !== '') params.FID_INPUT_ISCD = candidate.input;
  return params;
}

async function probeOne(candidate: ProbeCandidate): Promise<ProbeResult> {
  const data = await realDataKisGet(TR_ID, API_PATH, buildParams(candidate), 'LOW') as ProbeRoot;
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
  return msg.length > 64 ? `${msg.slice(0, 61)}...` : msg;
}

function renderResultLine(index: number, result: ProbeResult): string {
  const c = result.candidate;
  const status = result.success ? '✅' : result.rtCd === '0' ? '🟡' : '❌';
  return `${index}. ${status} ${c.divMode} c=${c.cond} m=${c.market} s=${c.section} i=${c.input || 'OMIT'} | ${result.msgCd || 'NO_CD'} ${shortMsg(result.msg1)} | ${result.outputPath} ${result.outputKeys.join('|') || 'NONE'}`;
}

function summarizeBy<T extends string>(results: ProbeResult[], keyFn: (r: ProbeResult) => T): string[] {
  const buckets = new Map<T, number>();
  for (const result of results) buckets.set(keyFn(result), (buckets.get(keyFn(result)) ?? 0) + 1);
  return [...buckets.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([key, count]) => `- ${key}: ${count}`);
}

function progressScore(result: ProbeResult): number {
  if (result.success) return 100;
  if (result.outputPath !== 'NONE') return 90;
  if (result.rtCd === '0') return 80;
  const msg = result.msg1;
  if (msg.includes('FIELD NOT FOUND')) return 10;
  if (msg.includes('INVALID INPUT_FILED_SIZE') || msg.includes('INVALID INPUT_FIELD_SIZE')) return 30;
  if (msg.includes('INVALID')) return 25;
  return 15;
}

function bestProgress(results: ProbeResult[]): ProbeResult | undefined {
  return [...results].sort((a, b) => progressScore(b) - progressScore(a))[0];
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
  const progressed = bestProgress(results);
  const lines: string[] = [
    '🧪 KIS 시장 프로그램매매 파라미터 Probe',
    `trId=${TR_ID}`,
    `path=${API_PATH}`,
    `tested=${results.length}/${candidates.length}`,
    `envCond=${process.env.KIS_MARKET_PROGRAM_DIV_CODE ?? 'unset'} / envMrkt=${process.env.KIS_MARKET_PROGRAM_MARKET_CLASS_CODE ?? 'unset'} / envSctn=${process.env.KIS_MARKET_PROGRAM_SECTION_CLASS_CODE ?? 'unset'} / envIscd=${process.env.KIS_MARKET_PROGRAM_INDEX_CODE ?? 'unset'}`,
    'div=BOTH → FID_COND_MRKT_DIV_CODE + FID_COND_MRKT_DIV_CODE1 동시 전송',
    'cond 후보는 J를 ENV 값보다 먼저 테스트',
    '',
  ];

  if (best) {
    lines.push('🎯 BEST CANDIDATE');
    lines.push(renderResultLine(1, best));
    lines.push('');
  } else {
    lines.push('🎯 BEST CANDIDATE: 없음');
    if (progressed) lines.push(`최진전 후보: ${renderResultLine(1, progressed)}`);
    lines.push('');
  }

  lines.push('📊 cond 요약');
  lines.push(...summarizeBy(results, (r) => `cond=${r.candidate.cond}/${r.msgCd || 'NO_CD'}`));
  lines.push('📊 msg 요약');
  lines.push(...summarizeBy(results, (r) => `${r.msgCd || 'NO_CD'} ${shortMsg(r.msg1)}`));
  lines.push('');

  lines.push('처음 결과');
  results.slice(0, 8).forEach((result, idx) => lines.push(renderResultLine(idx + 1, result)));
  lines.push('최근 결과');
  results.slice(-8).forEach((result, idx) => lines.push(renderResultLine(idx + 1, result)));
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
  usage: '/program_market_probe [limit=36]',
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
