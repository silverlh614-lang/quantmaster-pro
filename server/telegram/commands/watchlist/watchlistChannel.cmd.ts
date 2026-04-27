// @responsibility watchlistChannel.cmd 텔레그램 모듈
// @responsibility: /watchlist_channel — 현재 워치리스트를 텔레그램 픽 채널로 즉시 브로드캐스트 (channelPipeline 위임).
import { loadWatchlist } from '../../../persistence/watchlistRepo.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const watchlistChannel: TelegramCommand = {
  name: '/watchlist_channel',
  category: 'WL',
  visibility: 'ADMIN',
  riskLevel: 1,
  description: '워치리스트 현황 채널 발송',
  async execute({ reply }) {
    const { channelWatchlistSummary } = await import('../../../alerts/channelPipeline.js');
    const wl = loadWatchlist();
    if (wl.length === 0) {
      await reply('📋 워치리스트가 비어 있어 채널 발송할 내용이 없습니다.');
      return;
    }
    await channelWatchlistSummary(wl);
    await reply(`✅ 워치리스트 ${wl.length}개 종목을 채널에 발송했습니다.`);
  },
};

commandRegistry.register(watchlistChannel);

export default watchlistChannel;
