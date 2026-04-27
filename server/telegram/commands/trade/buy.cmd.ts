// @responsibility buy.cmd 텔레그램 모듈
// @responsibility: /buy 005930 — 워치리스트 검증 후 forceBuyCodes 로 다음 스캔 주기에 강제 매수 신호 트리거. TRD.
import { loadWatchlist } from '../../../persistence/watchlistRepo.js';
import { runAutoSignalScan } from '../../../trading/signalScanner.js';
import { escapeHtml } from '../../../alerts/telegramClient.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const buy: TelegramCommand = {
  name: '/buy',
  category: 'TRD',
  visibility: 'ADMIN',
  riskLevel: 2,
  description: '수동 매수 신호 트리거 (워치리스트 종목만)',
  usage: '/buy <code 6자리>',
  async execute({ args, reply }) {
    const code = args[0]?.replace(/[^0-9]/g, '').slice(0, 6);
    if (!code || code.length !== 6) {
      await reply('❌ 사용법: /buy 005930 (종목코드 6자리)');
      return;
    }
    const wl = loadWatchlist();
    const hit = wl.find(w => w.code === code);
    if (!hit) {
      await reply(`⚠️ 워치리스트에 ${code} 없음. 먼저 워치리스트에 추가하세요.`);
      return;
    }
    // Shadow 강제 신호 트리거 — forceBuyCodes 로 buyList 에 강제 포함.
    await runAutoSignalScan({ forceBuyCodes: [code] }).catch(console.error);
    await reply(
      `🔔 <b>${escapeHtml(hit.name)}(${escapeHtml(code)})</b> 수동 매수 신호 트리거 완료 (다음 스캔 주기에 체결)`,
    );
  },
};

commandRegistry.register(buy);

export default buy;
