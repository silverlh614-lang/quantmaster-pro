// @responsibility watchlist.cmd 텔레그램 모듈
// @responsibility: /watchlist 명령 — 워치리스트 전체를 SWING/CATALYST/MOMENTUM 섹션별로 포맷.
import { loadWatchlist, type WatchlistEntry } from '../../../persistence/watchlistRepo.js';
import { escapeHtml } from '../../../alerts/telegramClient.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const watchlist: TelegramCommand = {
  name: '/watchlist',
  category: 'WL',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: '워치리스트 전체 조회 (SWING/CATALYST/MOMENTUM 섹션 분리)',
  async execute({ reply }) {
    const wl = loadWatchlist();
    if (wl.length === 0) {
      await reply(
        '📋 <b>워치리스트가 비어 있습니다.</b>\n\n' +
        '💡 <i>/add 005930 으로 종목을 추가하세요.\n' +
        '자동 스크리너가 발굴한 종목도 여기에 표시됩니다.</i>',
      );
      return;
    }

    const swingList = wl.filter(
      w => w.section === 'SWING' || (!w.section && (w.track === 'B' || w.addedBy === 'MANUAL')),
    );
    const catalystList = wl.filter(w => w.section === 'CATALYST');
    const momentumList = wl.filter(
      w => w.section === 'MOMENTUM' || (!w.section && w.track === 'A' && w.addedBy !== 'MANUAL'),
    );

    const formatEntry = (w: WatchlistEntry, showDetail: boolean) => {
      const focusMark = w.isFocus ? '⭐' : '';
      const sectionMark = w.addedBy === 'MANUAL' ? '👤' : w.addedBy === 'DART' ? '📢' : '🤖';
      const gate = w.gateScore !== undefined ? `Gate ${w.gateScore.toFixed(1)}` : '';
      const rrr = w.rrr !== undefined ? `RRR 1:${w.rrr.toFixed(1)}` : '';
      const sector = w.sector ? escapeHtml(w.sector) : '';
      const meta = [gate, rrr, sector].filter(Boolean).join(' · ');

      if (showDetail) {
        return (
          `${focusMark}${sectionMark} <b>${escapeHtml(w.name)}</b> (${escapeHtml(w.code)})\n` +
          `   💰 진입: ${w.entryPrice.toLocaleString()}원\n` +
          `   🛡️ 손절: ${w.stopLoss.toLocaleString()}원 → 🎯 목표: ${w.targetPrice.toLocaleString()}원\n` +
          (meta ? `   📊 ${meta}` : '') +
          (w.memo ? `\n   💬 ${escapeHtml(w.memo)}` : '')
        );
      }
      return `  ${sectionMark} ${escapeHtml(w.name)}(${escapeHtml(w.code)}) ${meta ? `| ${meta}` : ''}`;
    };

    const parts: string[] = [
      `📋 <b>[워치리스트] 총 ${wl.length}개</b>`,
      `━━━━━━━━━━━━━━━━`,
    ];

    if (swingList.length > 0) {
      parts.push(`\n🎯 <b>SWING — 스윙 매수 대상 (${swingList.length}개)</b>`);
      parts.push(...swingList.map(w => formatEntry(w, true)));
    }
    if (catalystList.length > 0) {
      parts.push(`\n📢 <b>CATALYST — 촉매 단기 (${catalystList.length}개)</b>`);
      parts.push(...catalystList.map(w => formatEntry(w, true)));
    }
    if (momentumList.length > 0) {
      parts.push(`\n📂 <b>MOMENTUM — 관찰 전용 (${momentumList.length}개)</b>`);
      const shown = momentumList.slice(0, 10);
      parts.push(...shown.map(w => formatEntry(w, false)));
      if (momentumList.length > 10) {
        parts.push(`  ... 외 ${momentumList.length - 10}개`);
      }
    }

    parts.push(
      `\n━━━━━━━━━━━━━━━━`,
      `⭐=SWING매수대상 👤=수동 📢=CATALYST 🤖=MOMENTUM`,
      `💡 /focus — SWING 상세 조회`,
    );

    await reply(parts.join('\n'));
  },
};

commandRegistry.register(watchlist);

export default watchlist;
