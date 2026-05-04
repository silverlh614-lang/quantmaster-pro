// @responsibility foreignerRatioBackfill.cmd 텔레그램 모듈
// @responsibility: /frb — 종목별 외인 보유율 시계열을 수동 backfill 하고 /sh 캐시를 즉시 갱신한다.
//
// 사용 예:
//   /frb 041910 2026-05-04 7.2; 041910 2026-05-01 7.0
//   /frb 041910 2026-05-04 7.2 2026-05-01 7.0 2026-04-30 6.8
//
// ratio 단위: %. 0~100 범위만 허용.

import { appendForeignerRatio, computeForeignerRatioTrend } from '../../../persistence/foreignerRatioRepo.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import { __resetSupplyHealthCacheForTests as resetSupplyHealthCache } from './supplyHealth.cmd.js';

interface ParsedForeignerRatioSeed {
  code: string;
  date: string;
  ratio: number;
}

function normalizeCode(raw: string): string {
  return String(raw).replace(/[^0-9]/g, '').slice(0, 6).padStart(6, '0');
}

function parseNumber(raw: string): number | null {
  const n = Number(String(raw).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function isDate(raw: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(raw);
}

function isCode(raw: string): boolean {
  return /^\d{6}$/.test(normalizeCode(raw));
}

function parseChunk(chunk: string, idx: number): { rows: ParsedForeignerRatioSeed[]; errors: string[] } {
  const parts = chunk.split(/\s+/).filter(Boolean);
  const rows: ParsedForeignerRatioSeed[] = [];
  const errors: string[] = [];

  if (parts.length < 3) {
    errors.push(`#${idx + 1}: 형식 오류 — code YYYY-MM-DD ratio 필요`);
    return { rows, errors };
  }

  const code = normalizeCode(parts[0]);
  if (!isCode(code)) {
    errors.push(`#${idx + 1}: 종목코드 형식 오류 ${parts[0]}`);
    return { rows, errors };
  }

  const rest = parts.slice(1);
  if (rest.length % 2 !== 0) {
    errors.push(`#${idx + 1}: 날짜/ratio 쌍 불일치`);
    return { rows, errors };
  }

  for (let i = 0; i < rest.length; i += 2) {
    const date = rest[i];
    const ratioRaw = rest[i + 1];
    if (!isDate(date)) {
      errors.push(`#${idx + 1}.${i / 2 + 1}: 날짜 형식 오류 ${date}`);
      continue;
    }
    const ratio = parseNumber(ratioRaw);
    if (ratio === null) {
      errors.push(`#${idx + 1}.${i / 2 + 1}: ratio 숫자 형식 오류 ${ratioRaw}`);
      continue;
    }
    if (ratio < 0 || ratio > 100) {
      errors.push(`#${idx + 1}.${i / 2 + 1}: ratio 범위 오류 ${ratio} — 0~100만 허용`);
      continue;
    }
    rows.push({ code, date, ratio });
  }

  return { rows, errors };
}

function parseForeignerRatioSeedText(text: string): { rows: ParsedForeignerRatioSeed[]; errors: string[] } {
  const rows: ParsedForeignerRatioSeed[] = [];
  const errors: string[] = [];
  const chunks = text.split(';').map((s) => s.trim()).filter(Boolean);
  for (const [idx, chunk] of chunks.entries()) {
    const parsed = parseChunk(chunk, idx);
    rows.push(...parsed.rows);
    errors.push(...parsed.errors);
  }
  return { rows, errors };
}

function groupCodes(rows: ParsedForeignerRatioSeed[]): string[] {
  return [...new Set(rows.map((r) => r.code))].sort();
}

function trendSummary(code: string): string {
  const trend = computeForeignerRatioTrend(code);
  if (!trend) return `${code}: series=0`;
  const ch5 = trend.changePct5d === null ? 'N/A' : `${trend.changePct5d >= 0 ? '+' : ''}${trend.changePct5d.toFixed(2)}%p`;
  return `${code}: series=${trend.sampleSize} latest=${trend.latestDate} current=${trend.current.toFixed(2)}% 5d=${ch5}`;
}

const foreignerRatioBackfill: TelegramCommand = {
  name: '/foreigner_ratio_backfill',
  aliases: ['/frb'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 1,
  description: '종목별 외인 보유율 시계열 수동 backfill',
  usage: '/frb <code> <YYYY-MM-DD> <ratio>; <code> <YYYY-MM-DD> <ratio>',
  async execute({ args, reply }) {
    const text = args.join(' ').trim();
    if (!text) {
      await reply(
        '🧩 <b>외인 보유율 추세 backfill</b>\n' +
        '사용법:\n' +
        '<code>/frb 041910 2026-05-04 7.2; 041910 2026-05-01 7.0</code>\n' +
        '<code>/frb 041910 2026-05-04 7.2 2026-05-01 7.0 2026-04-30 6.8</code>\n\n' +
        '단위: %, 허용 범위 0~100\n' +
        '확인: <code>/foreigner_trend 041910</code> 또는 <code>/sh</code>',
      );
      return;
    }

    const parsed = parseForeignerRatioSeedText(text);
    for (const row of parsed.rows) {
      appendForeignerRatio(row.code, { date: row.date, ratio: row.ratio });
    }
    if (parsed.rows.length > 0) resetSupplyHealthCache();

    const codes = groupCodes(parsed.rows);
    const lines = [
      '✅ <b>외인 보유율 추세 backfill 완료</b>',
      `accepted=${parsed.rows.length}`,
      `failed=${parsed.errors.length}`,
      `codes=${codes.length}`,
    ];
    if (codes.length > 0) {
      lines.push('', '요약:');
      lines.push(...codes.slice(0, 8).map(trendSummary));
    }
    if (parsed.rows.length > 0) {
      lines.push('', '입력:');
      lines.push(...parsed.rows.slice(0, 8).map((r) => `${r.code} ${r.date} ratio=${r.ratio.toFixed(2)}%`));
    }
    if (parsed.errors.length > 0) {
      lines.push('', '거부:');
      lines.push(...parsed.errors.slice(0, 5));
    }
    lines.push('', '다음 확인: /foreigner_trend <code> 또는 /sh');
    await reply(lines.join('\n'));
  },
};

commandRegistry.register(foreignerRatioBackfill);

export default foreignerRatioBackfill;
