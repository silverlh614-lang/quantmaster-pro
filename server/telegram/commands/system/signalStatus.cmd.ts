// @responsibility signalStatus.cmd 텔레그램 모듈
// @responsibility: /signal_status 명령 — TradeSignalStatus 6단계 상태머신 진단 (ADR-0077).
import {
  getRecentTradeSignalRecords,
  type TradeSignalRecord,
  type TradeSignalStatus,
} from '../../../persistence/tradeSignalStatusRepo.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const STATUS_EMOJI: Record<TradeSignalStatus, string> = {
  AI_CANDIDATE: '🌱',
  DATA_VERIFIED: '🟢',
  RISK_APPROVED: '🟡',
  USER_APPROVED: '🟢',
  AUTO_TRADE_READY: '✅',
  BLOCKED: '❌',
};

function formatKstHm(iso: string | undefined): string {
  if (!iso) return '?';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '?';
  const kst = new Date(ms + 9 * 60 * 60 * 1000);
  const hh = String(kst.getUTCHours()).padStart(2, '0');
  const mm = String(kst.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function lastTransitionAt(r: TradeSignalRecord): string | undefined {
  if (r.transitions.length === 0) return r.createdAt;
  return r.transitions[r.transitions.length - 1].at;
}

function statusReason(r: TradeSignalRecord): string {
  if (r.status === 'BLOCKED' && r.blockGate && r.blockReason) {
    return `${r.blockGate} (${r.blockReason})`;
  }
  // 마지막 전이 사유 표시
  const last = r.transitions[r.transitions.length - 1];
  return last?.reason ?? '—';
}

/**
 * /signal_status [N=10] 응답 메시지 빌더 SSOT.
 *
 * 빈 records → 안내 메시지. N건 → 한 줄당 emoji + 종목 + 상태 + 시각 + 사유.
 *
 * @param records `getRecentTradeSignalRecords(limit)` 결과 (createdAt 내림차순)
 * @param limit 사용자 요청 N (1~30)
 */
export function formatSignalStatusMessage(
  records: TradeSignalRecord[],
  limit: number,
): string {
  const header = `📊 신호 상태 (최근 ${limit}건)`;
  if (records.length === 0) {
    return `${header}\n\n최근 추천 없음.`;
  }
  const lines = records.map(r => {
    const emoji = STATUS_EMOJI[r.status] ?? '?';
    const at = formatKstHm(lastTransitionAt(r));
    const reason = statusReason(r);
    return `${emoji} ${r.stockCode} ${r.stockName} — ${r.status} (${at}) — ${reason}`;
  });
  return `${header}\n\n${lines.join('\n')}`;
}

const signalStatus: TelegramCommand = {
  name: '/signal_status',
  aliases: ['/signals'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'AI 추천→자동매매 신호 상태머신 6단계 추적 (최근 N건)',
  usage: '/signal_status [N=10, max 30]',
  async execute({ args, reply }) {
    try {
      const requested = Number(args[0]);
      const n = Number.isFinite(requested) && requested > 0
        ? Math.min(30, Math.floor(requested))
        : 10;
      const records = getRecentTradeSignalRecords(n);
      await reply(formatSignalStatusMessage(records, n));
    } catch (e) {
      console.error('[TelegramBot] /signal_status 실패:', e);
      await reply('❌ 신호 상태 조회 실패 — 서버 로그를 확인하세요.');
    }
  },
};

commandRegistry.register(signalStatus);

export default signalStatus;
