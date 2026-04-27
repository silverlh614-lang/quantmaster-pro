// @responsibility focus.cmd 텔레그램 모듈
// @responsibility: /focus 명령 — Track B(SWING/CATALYST) 매수 대상 상세를 진입가/손절/목표/등록일과 함께 표시.
import { loadWatchlist } from '../../../persistence/watchlistRepo.js';
import { escapeHtml } from '../../../alerts/telegramClient.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const focus: TelegramCommand = {
  name: '/focus',
  category: 'WL',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'Track B 매수 대상 상세 조회 (진입가/손절/목표/등록일/쿨다운)',
  async execute({ reply }) {
    const wl = loadWatchlist();
    const focusList = wl.filter(
      w =>
        w.section === 'SWING' ||
        w.section === 'CATALYST' ||
        (!w.section && (w.track === 'B' || w.addedBy === 'MANUAL')),
    );
    if (focusList.length === 0) {
      await reply(
        '🎯 <b>Focus 종목이 없습니다.</b>\n\n' +
        '💡 <i>Gate Score 상위 종목이 SWING으로 자동 승격되거나,\n' +
        '/add 로 수동 추가하면 SWING에 포함됩니다.</i>',
      );
      return;
    }

    const lines: string[] = [];
    for (const w of focusList) {
      const focusMark = w.isFocus ? '⭐' : '';
      const manualMark = w.addedBy === 'MANUAL' ? '👤' : w.addedBy === 'DART' ? '📢' : '🤖';
      const gate = w.gateScore !== undefined ? `Gate ${w.gateScore.toFixed(1)}` : 'Gate -';
      const rrr = w.rrr !== undefined ? `RRR 1:${w.rrr.toFixed(1)}` : '';
      const sector = w.sector ? escapeHtml(w.sector) : '';
      const profile = w.profileType ? `[${escapeHtml(w.profileType)}]` : '';
      const cooldown =
        w.cooldownUntil && new Date(w.cooldownUntil) > new Date() ? '🧊 쿨다운중' : '';
      const addedDate = new Date(w.addedAt).toLocaleDateString('ko-KR', {
        month: 'short',
        day: 'numeric',
        timeZone: 'Asia/Seoul',
      });
      const meta = [gate, rrr, sector, profile].filter(Boolean).join(' · ');

      lines.push(
        `${focusMark}${manualMark} <b>${escapeHtml(w.name)}</b> (${escapeHtml(w.code)}) ${cooldown}\n` +
        `   💰 진입: ${w.entryPrice.toLocaleString()}원\n` +
        `   🛡️ 손절: ${w.stopLoss.toLocaleString()}원 | 🎯 목표: ${w.targetPrice.toLocaleString()}원\n` +
        `   📊 ${meta}\n` +
        `   📅 등록: ${addedDate}` +
        (w.memo ? ` | 💬 ${escapeHtml(w.memo)}` : ''),
      );
    }

    await reply(
      `🎯 <b>[Track B — 매수 대상] ${focusList.length}개</b>\n` +
      `━━━━━━━━━━━━━━━━\n` +
      lines.join('\n━━━━━━━━━━━━━━━━\n') +
      `\n━━━━━━━━━━━━━━━━\n` +
      `⭐=자동매수대상 👤=수동 🤖=자동발굴 🧊=쿨다운\n` +
      `💡 /buy 종목코드 — 수동 매수 신호 트리거`,
    );
  },
};

commandRegistry.register(focus);

export default focus;
