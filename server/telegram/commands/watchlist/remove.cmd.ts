// @responsibility: /remove 005380 — 워치리스트에서 종목코드를 삭제하고 잔여 개수를 보고.
import { loadWatchlist, saveWatchlist } from '../../../persistence/watchlistRepo.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const remove: TelegramCommand = {
  name: '/remove',
  category: 'WL',
  visibility: 'ADMIN',
  riskLevel: 1,
  description: '워치리스트에서 종목 제거',
  usage: '/remove <code 6자리>',
  async execute({ args, reply }) {
    const code = args[0]?.replace(/[^0-9]/g, '').slice(0, 6);
    if (!code || code.length !== 6) {
      await reply('❌ 사용법: /remove 005380 (종목코드 6자리)');
      return;
    }
    const wl = loadWatchlist();
    const idx = wl.findIndex(w => w.code === code);
    if (idx === -1) {
      await reply(`⚠️ ${code} 워치리스트에 없습니다.`);
      return;
    }
    const removed = wl.splice(idx, 1)[0];
    saveWatchlist(wl);
    await reply(
      `🗑 <b>워치리스트 제거</b>\n${removed.name}(${code}) 삭제 완료\n잔여: ${wl.length}개`,
    );
  },
};

commandRegistry.register(remove);

export default remove;
