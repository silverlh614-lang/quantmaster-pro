// @responsibility marginBalanceBackfill.cmd 텔레그램 모듈
// @responsibility: /mbb — 신용잔고 5일 변화율을 수동 cache backfill 하고 macroState 를 즉시 갱신한다.
//
// 사용 예:
//   /mbb 2026-05-04 1.8
//   /mbb 2026-05-04 1.8; 2026-05-01 1.5
//
// change 단위: %. -100~100 범위만 허용.

import { loadMacroState, saveMacroState } from '../../../persistence/macroStateRepo.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import { __resetSupplyHealthCacheForTests as resetSupplyHealthCache } from './supplyHealth.cmd.js';

interface ParsedMarginSeed {
  date: string;
  change5d: number;
}

function parseNumber(raw: string): number | null {
  const n = Number(String(raw).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function parseMarginSeedText(text: string): { rows: ParsedMarginSeed[]; errors: string[] } {
  const rows: ParsedMarginSeed[] = [];
  const errors: string[] = [];
  const chunks = text.split(';').map((s) => s.trim()).filter(Boolean);

  for (const [idx, chunk] of chunks.entries()) {
    const parts = chunk.split(/\s+/).filter(Boolean);
    if (parts.length !== 2) {
      errors.push(`#${idx + 1}: 형식 오류 — YYYY-MM-DD change5d 필요`);
      continue;
    }
    const [date, changeRaw] = parts;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      errors.push(`#${idx + 1}: 날짜 형식 오류 ${date}`);
      continue;
    }
    const change5d = parseNumber(changeRaw);
    if (change5d === null) {
      errors.push(`#${idx + 1}: change5d 숫자 형식 오류 ${changeRaw}`);
      continue;
    }
    if (change5d < -100 || change5d > 100) {
      errors.push(`#${idx + 1}: change5d 범위 오류 ${change5d} — -100~100만 허용`);
      continue;
    }
    rows.push({ date, change5d });
  }
  return { rows, errors };
}

function latestRow(rows: ParsedMarginSeed[]): ParsedMarginSeed | null {
  if (rows.length === 0) return null;
  return [...rows].sort((a, b) => a.date.localeCompare(b.date)).at(-1) ?? null;
}

function saveLatestMarginBalance(rows: ParsedMarginSeed[]): ParsedMarginSeed | null {
  const latest = latestRow(rows);
  if (!latest) return null;
  const now = new Date().toISOString();
  const macro = loadMacroState() ?? { mhs: 50, regime: 'R4_NEUTRAL', updatedAt: now };
  saveMacroState({
    ...macro,
    marginBalance5dChange: latest.change5d,
    marginBalanceSource: 'CACHE' as any,
    marginBalanceFetchedAt: now,
    updatedAt: now,
  });
  resetSupplyHealthCache();
  return latest;
}

const marginBalanceBackfill: TelegramCommand = {
  name: '/margin_balance_backfill',
  aliases: ['/mbb'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 1,
  description: '신용잔고 5일 변화율 수동 backfill + macroState 갱신',
  usage: '/mbb YYYY-MM-DD change5d; YYYY-MM-DD change5d',
  async execute({ args, reply }) {
    const text = args.join(' ').trim();
    if (!text) {
      await reply(
        '🧩 <b>신용잔고 backfill</b>\n' +
        '사용법:\n' +
        '<code>/mbb 2026-05-04 1.8</code>\n' +
        '<code>/mbb 2026-05-04 1.8; 2026-05-01 1.5</code>\n\n' +
        '단위: %, 허용 범위 -100~100\n' +
        '확인: <code>/sh</code>',
      );
      return;
    }

    const parsed = parseMarginSeedText(text);
    const latest = saveLatestMarginBalance(parsed.rows);

    const lines = [
      '✅ <b>신용잔고 backfill 완료</b>',
      `accepted=${parsed.rows.length}`,
      `failed=${parsed.errors.length}`,
      `latest=${latest?.date ?? 'N/A'}`,
      `change5d=${latest ? `${latest.change5d.toFixed(2)}%` : 'N/A'}`,
      'source=CACHE',
    ];
    if (parsed.rows.length > 0) {
      lines.push('', '입력:');
      lines.push(...parsed.rows.slice(0, 8).map((r) => `${r.date} change5d=${r.change5d.toFixed(2)}%`));
    }
    if (parsed.errors.length > 0) {
      lines.push('', '거부:');
      lines.push(...parsed.errors.slice(0, 5));
    }
    lines.push('', '다음 확인: /sh');
    await reply(lines.join('\n'));
  },
};

commandRegistry.register(marginBalanceBackfill);

export default marginBalanceBackfill;
