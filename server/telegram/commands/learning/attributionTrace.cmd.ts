// @responsibility closed shadow trade 의 attribution 생성 wiring 진단 read-only 명령
import fs from 'fs';
import {
  loadShadowTrades,
  getWeightedPnlPct,
  type ServerShadowTrade,
} from '../../../persistence/shadowTradeRepo.js';
import {
  loadAttributionRecords,
  type ServerAttributionRecord,
} from '../../../persistence/attributionRepo.js';
import { ATTRIBUTION_FILE } from '../../../persistence/paths.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const ARG_MIN = 1;
const ARG_MAX = 20;
const ARG_DEFAULT = 5;

export interface AttributionTraceEntry {
  trade: ServerShadowTrade;
  records: ServerAttributionRecord[];
  hasRecord: boolean;
  fillIds: string[];
  earliestClosedAt?: string;
  /** baseline 영속 카운트 — entryConditionScores 의 conditionId 수 (0 또는 27). */
  conditionScoresCount: number;
}

function parseTraceArg(args: string[] | undefined): number {
  if (!args || args.length === 0) return ARG_DEFAULT;
  const n = Number(args[0]);
  if (!Number.isFinite(n)) return ARG_DEFAULT;
  return Math.max(ARG_MIN, Math.min(ARG_MAX, Math.floor(n)));
}

/** status='HIT_TARGET'/'HIT_STOP' 만, exitTime 내림차순 N개. */
function selectClosedTrades(
  trades: ServerShadowTrade[],
  n: number,
): ServerShadowTrade[] {
  return trades
    .filter((t) => t.status === 'HIT_TARGET' || t.status === 'HIT_STOP')
    .sort((a, b) => (b.exitTime ?? '').localeCompare(a.exitTime ?? ''))
    .slice(0, n);
}

export function buildTraceEntry(
  trade: ServerShadowTrade,
  records: ServerAttributionRecord[],
): AttributionTraceEntry {
  const matched = records.filter((r) => r.tradeId === trade.id);
  const fillIds = matched.map((r) => r.fillId).filter((s): s is string => !!s);
  const closedAts = matched.map((r) => r.closedAt).filter(Boolean).sort();
  // baseline 영속 카운트 — buildEntryConditionScores 가 27조건 모두 NEUTRAL=5 default 채움.
  // 따라서 wiring 정상이면 27, 미캡처 (PR-1 이전 trade) 이면 0.
  const conditionScoresCount = trade.entryConditionScores
    ? Object.keys(trade.entryConditionScores).length
    : 0;
  return {
    trade,
    records: matched,
    hasRecord: matched.length > 0,
    fillIds,
    earliestClosedAt: closedAts[0],
    conditionScoresCount,
  };
}

function getAttributionFileMtime(): string | undefined {
  try {
    return fs.statSync(ATTRIBUTION_FILE).mtime.toISOString();
  } catch {
    return undefined;
  }
}

function buildVerdict(present: number, total: number): string {
  if (total === 0) return '⚪ 표본 없음 (closed trade 부재)';
  const ratio = present / total;
  if (ratio >= 1) return '🟢 모든 closed trade 에 attribution 존재 — wiring 정상, 표본 적었을 뿐';
  if (ratio >= 0.6) return '🟡 일부 trade 에서 누락 — exitRuleTag 별 wiring 차이 의심';
  return '🔴 전체 wiring 결함 — exitEngine/ocoCloseLoop 의 attribution 생성 호출 누락';
}

function formatPctSigned(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return 'N/A';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

/**
 * trade.returnPct 가 invariant 보호 규칙 (shadowTradeRepo.updateShadow:287-290) 으로
 * 영원히 저장 차단된다. fills SSOT (PR-15~19, getWeightedPnlPct) 에서 가중평균 산출.
 * fills 부재 시 trade.returnPct 레거시 fallback (PR-15 이전 trade).
 */
export function resolveReturnPctForDisplay(t: ServerShadowTrade): number | undefined {
  if (t.returnPct !== undefined && Number.isFinite(t.returnPct)) return t.returnPct;
  const weighted = getWeightedPnlPct(t);
  return Number.isFinite(weighted) && weighted !== 0 ? weighted : undefined;
}

function formatDateOnly(iso: string | undefined): string {
  if (!iso) return 'N/A';
  return iso.slice(0, 10);
}

function formatTs(iso: string | undefined): string {
  if (!iso) return 'N/A';
  return iso.replace('T', ' ').slice(0, 19);
}

export function formatAttributionTraceMessage(
  entries: AttributionTraceEntry[],
  fileMtime?: string,
): string {
  const lines: string[] = [];
  if (entries.length === 0) {
    lines.push('📊 Attribution Trace');
    lines.push('━━━━━━━━━━━━━━━━');
    lines.push('');
    lines.push('closed shadow trade 가 없습니다 (status HIT_TARGET / HIT_STOP).');
    lines.push(
      fileMtime
        ? `Attribution 파일 마지막 수정: ${formatTs(fileMtime)} UTC`
        : 'Attribution 파일이 아직 존재하지 않음.',
    );
    return lines.join('\n');
  }

  lines.push(`📊 Attribution Trace (last ${entries.length} closed trades)`);
  lines.push('━━━━━━━━━━━━━━━━');
  lines.push('');

  let idx = 1;
  let present = 0;
  for (const entry of entries) {
    const t = entry.trade;
    lines.push(`${idx}. ${t.stockCode} ${t.stockName ?? ''}`.trim());
    lines.push(`   closed: ${formatDateOnly(t.exitTime)}`);
    lines.push(`   status: ${t.status}`);
    lines.push(`   exitRuleTag: ${t.exitRuleTag ?? '?'}`);
    lines.push(`   returnPct: ${formatPctSigned(resolveReturnPctForDisplay(t))}`);
    lines.push('');
    lines.push('   📋 Attribution 레코드:');
    lines.push(
      `     attributionRepo에 존재: ${entry.hasRecord ? 'YES' : 'NO'}`,
    );
    lines.push(
      `     tradeId 매칭: ${
        entry.records.length > 0 ? `YES (${entry.records.length}건)` : 'NO'
      }`,
    );
    lines.push(`     fillId 수: ${entry.fillIds.length}`);
    lines.push(`     생성 시각: ${formatTs(entry.earliestClosedAt)}`);
    lines.push(
      `     conditionScoresAtEntry: ${entry.conditionScoresCount}/27`,
    );
    lines.push('');
    lines.push('   진단:');
    if (entry.hasRecord) {
      lines.push('     YES → 정상 wiring');
      present++;
    } else {
      lines.push(
        '     NO → 🚨 wiring 단절 — trade close 후 attribution 생성 누락',
      );
    }
    lines.push('');
    idx++;
  }

  // baseline 영속 카운트 — wiring 결함 vs PR-1 이전 trade 구분 진단.
  const baselinePresent = entries.filter((e) => e.conditionScoresCount > 0).length;

  lines.push('━━━━━━━━━━━━━━━━');
  lines.push('');
  lines.push('🎯 종합:');
  lines.push(
    `   직전 ${entries.length}건 중 attribution 생성: ${present}/${entries.length}`,
  );
  lines.push(
    `   baseline 영속 (entryConditionScores): ${baselinePresent}/${entries.length}`,
  );
  lines.push('');
  lines.push(`   ${buildVerdict(present, entries.length)}`);
  if (present < entries.length) {
    lines.push('');
    lines.push('권장 조사 위치:');
    if (baselinePresent === 0) {
      lines.push('   📌 baseline 0/N — PR-1 (#467) 이전 trade. wiring 정상.');
      lines.push('   다음 신규 buy 발생 시 attribution 자동 영속 시작.');
    } else if (baselinePresent < entries.length) {
      lines.push('   📌 baseline 일부 부재 — 신규 trade 부터 wiring 적용 중.');
      lines.push('   baseline 27/27 trade 의 attribution 부재 시 exitEngine 점검.');
    } else {
      lines.push('   📌 baseline 전체 영속 — wiring 정상, attribution 결함은');
      lines.push('   exitEngine/ocoCloseLoop 의 emitFullCloseAttribution 호출 누락.');
    }
  }
  if (fileMtime) {
    lines.push('');
    lines.push(`Attribution 파일 마지막 수정: ${formatTs(fileMtime)} UTC`);
  }
  return lines.join('\n');
}

const attributionTrace: TelegramCommand = {
  name: '/attribution_trace',
  aliases: ['/at'],
  category: 'LRN',
  visibility: 'ADMIN',
  riskLevel: 0,
  description:
    '직전 N개 closed shadow trade 의 attribution 생성 wiring 추적 (read-only). N=1~20, default 5.',
  usage: '/attribution_trace [N=5]   — alias: /at',
  async execute({ args, reply }) {
    try {
      const n = parseTraceArg(args);
      const trades = loadShadowTrades();
      const closed = selectClosedTrades(trades, n);
      const records = loadAttributionRecords();
      const entries = closed.map((t) => buildTraceEntry(t, records));
      const mtime = getAttributionFileMtime();
      await reply(formatAttributionTraceMessage(entries, mtime));
    } catch (e) {
      console.error('[TelegramBot] /attribution_trace 실패:', e);
      await reply('❌ Attribution trace 진단 실패 — 서버 로그를 확인하세요.');
    }
  },
};

commandRegistry.register(attributionTrace);
