// @responsibility: /add 005380 — 워치리스트 신규 추가. 현재가 조회 후 -8% 손절 / +15% 목표 자동 설정.
import { loadWatchlist, saveWatchlist, type WatchlistEntry } from '../../../persistence/watchlistRepo.js';
import { fetchCurrentPrice, fetchStockName } from '../../../clients/kisClient.js';
import { STOCK_UNIVERSE } from '../../../screener/stockScreener.js';
import { calcRRR } from '../../../trading/riskManager.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const add: TelegramCommand = {
  name: '/add',
  category: 'WL',
  visibility: 'ADMIN',
  riskLevel: 1,
  description: '워치리스트 추가 (KIS 현재가 자동 조회 후 -8%/+15% 기본값 적용)',
  usage: '/add <code 6자리>',
  async execute({ args, reply }) {
    const code = args[0]?.replace(/[^0-9]/g, '').slice(0, 6);
    if (!code || code.length !== 6) {
      await reply('❌ 사용법: /add 005380 (종목코드 6자리)');
      return;
    }
    const wl = loadWatchlist();
    if (wl.find(w => w.code === code)) {
      await reply(`⚠️ ${code} 이미 워치리스트에 있습니다.`);
      return;
    }

    const price = await fetchCurrentPrice(code).catch(() => null);
    if (!price) {
      await reply(`❌ ${code} 현재가 조회 실패 — 유효한 종목코드인지 확인하세요.`);
      return;
    }
    const sl = Math.round(price * 0.92);
    const tp = Math.round(price * 1.15);
    const univName = STOCK_UNIVERSE.find(s => s.code === code)?.name;
    const stockName = univName ?? (await fetchStockName(code).catch(() => null)) ?? code;
    const newEntry: WatchlistEntry = {
      code,
      name: stockName,
      entryPrice: price,
      stopLoss: sl,
      targetPrice: tp,
      rrr: parseFloat(calcRRR(price, tp, sl).toFixed(2)),
      addedAt: new Date().toISOString(),
      addedBy: 'MANUAL',
    };
    wl.push(newEntry);
    saveWatchlist(wl);
    await reply(
      `✅ <b>워치리스트 추가</b>\n` +
      `종목: ${stockName} (${code})\n` +
      `진입가: ${price.toLocaleString()}원\n` +
      `손절: ${newEntry.stopLoss.toLocaleString()}원 (-8%)\n` +
      `목표: ${newEntry.targetPrice.toLocaleString()}원 (+15%)\n` +
      `RRR: ${newEntry.rrr}\n` +
      `<i>대시보드에서 진입가/손절/목표를 조정하세요.</i>`,
    );
  },
};

commandRegistry.register(add);

export default add;
