// @responsibility fssBackfill.cmd 텔레그램 모듈
// @responsibility: /fssb — FSS Passive/Active 레코드를 수동 backfill 하고 macroState passiveActiveBoth 를 즉시 갱신한다.
//
// 사용 예:
//   /fssb 2026-05-04 100 200; 2026-05-01 -50 120
// 단위: 억원. positive = 순매수, negative = 순매도.
//
// 운영 목적:
//   - FSS/Passive Active 자동 수집 전 회색(COLLECTION_EMPTY)을 수동 cache/backfill 로 해소
//   - fake-zero 방지: passive/active 둘 다 0인 row 는 거부
//   - macroState.foreignNetBuy5d/passiveActiveBoth/fssRecordsAge 동시 갱신

import { getFssRecordsAge, loadFssRecords, upsertFssRecord } from '../../../persistence/fssRepo.js';
import { loadMacroState, saveMacroState } from '../../../persistence/macroStateRepo.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

interface ParsedFssSeed {
  date: string;
  passiveNetBuy: number;
  activeNetBuy: number;
}

function parseNumber(raw: string): number | null {
  const n = Number(String(raw).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function parseFssSeedText(text: string): { rows: ParsedFssSeed[]; errors: string[] } {
  const rows: ParsedFssSeed[] = [];
  const errors: string[] = [];
  const chunks = text.split(';').map((s) => s.trim()).filter(Boolean);
  for (const [idx, chunk] of chunks.entries()) {
    const parts = chunk.split(/\s+/).filter(Boolean);
    if (parts.length !== 3) {
      errors.push(`#${idx + 1}: 형식 오류 — YYYY-MM-DD passive active 필요`);
      continue;
    }
    const [date, passiveRaw, activeRaw] = parts;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      errors.push(`#${idx + 1}: 날짜 형식 오류 ${date}`);
      continue;
    }
    const passiveNetBuy = parseNumber(passiveRaw);
    const activeNetBuy = parseNumber(activeRaw);
    if (passiveNetBuy === null || activeNetBuy === null) {
      errors.push(`#${idx + 1}: 숫자 형식 오류 passive=${passiveRaw} active=${activeRaw}`);
      continue;
    }
    if (passiveNetBuy === 0 && activeNetBuy === 0) {
      errors.push(`#${idx + 1}: passive/active 둘 다 0 — fake-zero 방지로 거부`);
      continue;
    }
    rows.push({ date, passiveNetBuy, activeNetBuy });
  }
  return { rows, errors };
}

function recomputeFssMacroFields(): { recordCount: number; latestDate: string | null; passiveActiveBoth: boolean | null; foreignNetBuy5d: number } {
  const age = getFssRecordsAge();
  const records = loadFssRecords().sort((a, b) => a.date.localeCompare(b.date));
  const last5 = records.slice(-5);
  const foreignNetBuy5d = last5.reduce((s, r) => s + r.passiveNetBuy + r.activeNetBuy, 0);
  const passiveActiveBoth = age.status === 'OK' && last5.length >= 3
    ? last5.every((r) => r.passiveNetBuy > 0 && r.activeNetBuy > 0)
    : null;

  const macro = loadMacroState();
  if (macro) {
    saveMacroState({
      ...macro,
      foreignNetBuy5d,
      passiveActiveBoth,
      fssRecordsAge: age,
      updatedAt: new Date().toISOString(),
    });
  }

  return { recordCount: records.length, latestDate: age.latestDate, passiveActiveBoth, foreignNetBuy5d };
}

function formatAccepted(rows: ParsedFssSeed[]): string[] {
  return rows.slice(0, 8).map((r) => `${r.date} passive=${r.passiveNetBuy.toLocaleString()} active=${r.activeNetBuy.toLocaleString()}`);
}

const fssBackfill: TelegramCommand = {
  name: '/fss_backfill',
  aliases: ['/fssb'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 1,
  description: 'FSS Passive/Active 레코드 수동 backfill + macroState 갱신',
  usage: '/fssb YYYY-MM-DD passive active; YYYY-MM-DD passive active',
  async execute({ args, reply }) {
    const text = args.join(' ').trim();
    if (!text) {
      await reply(
        '🧩 <b>FSS Passive/Active backfill</b>\n' +
        '사용법:\n' +
        '<code>/fssb 2026-05-04 100 200; 2026-05-01 -50 120</code>\n\n' +
        '단위: 억원, positive=순매수, negative=순매도\n' +
        '확인: <code>/fss_status</code> 또는 <code>/sh</code>',
      );
      return;
    }

    const parsed = parseFssSeedText(text);
    for (const row of parsed.rows) upsertFssRecord(row);
    const summary = recomputeFssMacroFields();

    const lines = [
      `✅ <b>FSS Passive/Active backfill 완료</b>`,
      `accepted=${parsed.rows.length}`,
      `failed=${parsed.errors.length}`,
      `records=${summary.recordCount}`,
      `latest=${summary.latestDate ?? 'N/A'}`,
      `foreignNetBuy5d=${summary.foreignNetBuy5d.toLocaleString()}억`,
      `passiveActiveBoth=${summary.passiveActiveBoth === null ? 'null' : String(summary.passiveActiveBoth)}`,
    ];
    if (parsed.rows.length > 0) {
      lines.push('', '입력:');
      lines.push(...formatAccepted(parsed.rows));
    }
    if (parsed.errors.length > 0) {
      lines.push('', '거부:');
      lines.push(...parsed.errors.slice(0, 5));
    }
    lines.push('', '다음 확인: /fss_status 또는 /sh');
    await reply(lines.join('\n'));
  },
};

commandRegistry.register(fssBackfill);
