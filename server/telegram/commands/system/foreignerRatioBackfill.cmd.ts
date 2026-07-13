// @responsibility foreignerRatioBackfill.cmd 텔레그램 모듈
// @responsibility: /frb — 종목별 외인 보유율 시계열을 수동 backfill 하고 /sh 캐시를 즉시 갱신한다.
//
// 사용 예:
//   /frb 041910 2026-05-04 7.2; 041910 2026-05-01 7.0
//   /frb 041910 2026-05-04 7.2 2026-05-01 7.0 2026-04-30 6.8
//   /frbt 10
//
// ratio 단위: %. 0~100 범위만 허용.

import { appendForeignerRatio, computeForeignerRatioTrend, loadForeignerRatioSeries } from '../../../persistence/foreignerRatioRepo.js';
import { loadWatchlist, type WatchlistEntry } from '../../../persistence/watchlistRepo.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';
import { __resetSupplyHealthCacheForTests as resetSupplyHealthCache } from './supplyHealth.cmd.js';

const DEFAULT_TEMPLATE_LIMIT = 10;

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

function selectTopWatchlist(limit: number): WatchlistEntry[] {
  return [...loadWatchlist()]
    .sort((a, b) => Number((b as any).stage2Score ?? b.gateScore ?? 0) - Number((a as any).stage2Score ?? a.gateScore ?? 0))
    .slice(0, limit);
}

function todayKst(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

function addDays(date: string, delta: number): string {
  const t = Date.parse(`${date}T00:00:00Z`);
  return new Date(t + delta * 86_400_000).toISOString().slice(0, 10);
}

function placeholderRatio(index: number, offset: number): number {
  // fake-zero 방지용 non-zero 템플릿. 운영자가 실제 외인 보유율로 교체하기 쉽도록 3~12% 범위의 작은 값 사용.
  return parseFloat((3 + (index % 10) * 0.37 + offset * 0.08).toFixed(2));
}

async function buildForeignerRatioSeedTemplateMessage(args: string[]): Promise<string> {
  const requested = Number.parseInt(args[0] ?? String(DEFAULT_TEMPLATE_LIMIT), 10);
  const limit = Number.isFinite(requested) ? Math.max(1, Math.min(20, requested)) : DEFAULT_TEMPLATE_LIMIT;
  const top = selectTopWatchlist(limit);
  const missing = top.filter((entry) => loadForeignerRatioSeries(entry.code).length === 0);
  if (missing.length === 0) {
    return `✅ stage2Score 상위 ${top.length}개 모두 외인 보유율 시계열 존재\n다음 확인: /sh`;
  }

  const d0 = todayKst();
  const d1 = addDays(d0, -3);
  const d2 = addDays(d0, -4);
  const rows = missing.map((entry, index) => {
    const r0 = placeholderRatio(index, 0);
    const r1 = placeholderRatio(index, -1);
    const r2 = placeholderRatio(index, -2);
    return `${entry.code} ${d0} ${r0} ${d1} ${r1} ${d2} ${r2}`;
  });

  return [
    '🧩 외인 보유율 추세 missing seed 템플릿',
    `top=${top.length} missing=${missing.length}`,
    '주의: 아래 ratio는 non-zero 임시값입니다. 실제 외인 보유율로 교체 권장.',
    '목표: /sh series 0/10 → N/10 상승 확인',
    '',
    `/frb ${rows.join('; ')}`,
  ].join('\n');
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
        '<code>/frb 041910 2026-05-04 7.2 2026-05-01 7.0 2026-04-30 6.8</code>\n' +
        '<code>/frbt 10</code>\n\n' +
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

const foreignerRatioSeedTemplate: TelegramCommand = {
  name: '/foreigner_ratio_seed_template',
  aliases: ['/frbt'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'stage2Score 상위 종목 중 외인 보유율 시계열 미보유 seed 템플릿 생성',
  usage: '/foreigner_ratio_seed_template [limit]',
  async execute({ args, reply }) {
    try { await reply(await buildForeignerRatioSeedTemplateMessage(args)); }
    catch (err) { console.error('[foreignerRatioSeedTemplate.cmd] failed', err); await reply('❌ foreigner ratio seed template 실패 — 서버 로그 확인 필요'); }
  },
};

commandRegistry.register(foreignerRatioBackfill);
commandRegistry.register(foreignerRatioSeedTemplate);
