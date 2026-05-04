// @responsibility shortBackfill.cmd 텔레그램 모듈
// @responsibility: /ssb — 공매도/대차잔고 ratio 를 수동 cache backfill 하고 macroState 를 즉시 갱신한다.
//
// 사용 예:
//   /ssb 2026-05-04 5.7
//   /ssb 2026-05-04 5.7; 2026-05-01 6.1
//
// ratio 단위: %. 0~100 범위만 허용.

import { loadMacroState, saveMacroState } from '../../../persistence/macroStateRepo.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

interface ParsedShortSeed {
  date: string;
  ratio: number;
}

function parseNumber(raw: string): number | null {
  const n = Number(String(raw).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function parseShortSeedText(text: string): { rows: ParsedShortSeed[]; errors: string[] } {
  const rows: ParsedShortSeed[] = [];
  const errors: string[] = [];
  const chunks = text.split(';').map((s) => s.trim()).filter(Boolean);

  for (const [idx, chunk] of chunks.entries()) {
    const parts = chunk.split(/\s+/).filter(Boolean);
    if (parts.length !== 2) {
      errors.push(`#${idx + 1}: 형식 오류 — YYYY-MM-DD ratio 필요`);
      continue;
    }
    const [date, ratioRaw] = parts;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      errors.push(`#${idx + 1}: 날짜 형식 오류 ${date}`);
      continue;
    }
    const ratio = parseNumber(ratioRaw);
    if (ratio === null) {
      errors.push(`#${idx + 1}: ratio 숫자 형식 오류 ${ratioRaw}`);
      continue;
    }
    if (ratio < 0 || ratio > 100) {
      errors.push(`#${idx + 1}: ratio 범위 오류 ${ratio} — 0~100만 허용`);
      continue;
    }
    rows.push({ date, ratio });
  }
  return { rows, errors };
}

function latestRow(rows: ParsedShortSeed[]): ParsedShortSeed | null {
  if (rows.length === 0) return null;
  return [...rows].sort((a, b) => a.date.localeCompare(b.date)).at(-1) ?? null;
}

function upsertShortSellingMacro(rows: ParsedShortSeed[]): ParsedShortSeed | null {
  const latest = latestRow(rows);
  if (!latest) return null;
  const macro = loadMacroState() ?? { mhs: 50, regime: 'R4_NEUTRAL', updatedAt: new Date().toISOString() };
  saveMacroState({
    ...macro,
    shortSellingRatio: latest.ratio,
    shortSellingSource: 'CACHE',
    shortSellingFetchedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return latest;
}

const shortBackfill: TelegramCommand = {
  name: '/short_backfill',
  aliases: ['/ssb'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 1,
  description: '공매도/대차잔고 ratio 수동 backfill + macroState 갱신',
  usage: '/ssb YYYY-MM-DD ratio; YYYY-MM-DD ratio',
  async execute({ args, reply }) {
    const text = args.join(' ').trim();
    if (!text) {
      await reply(
        '🧩 <b>공매도/대차잔고 backfill</b>\n' +
        '사용법:\n' +
        '<code>/ssb 2026-05-04 5.7</code>\n' +
        '<code>/ssb 2026-05-04 5.7; 2026-05-01 6.1</code>\n\n' +
        '단위: %, 허용 범위 0~100\n' +
        '확인: <code>/sh</code>',
      );
      return;
    }

    const parsed = parseShortSeedText(text);
    const latest = upsertShortSellingMacro(parsed.rows);

    const lines = [
      '✅ <b>공매도/대차잔고 backfill 완료</b>',
      `accepted=${parsed.rows.length}`,
      `failed=${parsed.errors.length}`,
      `latest=${latest?.date ?? 'N/A'}`,
      `ratio=${latest ? `${latest.ratio.toFixed(2)}%` : 'N/A'}`,
      'source=CACHE',
    ];
    if (parsed.rows.length > 0) {
      lines.push('', '입력:');
      lines.push(...parsed.rows.slice(0, 8).map((r) => `${r.date} ratio=${r.ratio.toFixed(2)}%`));
    }
    if (parsed.errors.length > 0) {
      lines.push('', '거부:');
      lines.push(...parsed.errors.slice(0, 5));
    }
    lines.push('', '다음 확인: /sh');
    await reply(lines.join('\n'));
  },
};

commandRegistry.register(shortBackfill);

export default shortBackfill;
