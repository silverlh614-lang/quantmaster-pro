// @responsibility reconnectWs.cmd 텔레그램 모듈
// @responsibility: /reconnect_ws — KIS WebSocket 강제 재연결 (stop → 1s 대기 → start). 워치리스트 비어있으면 가드. EMR 인프라.
import { loadWatchlist } from '../../../persistence/watchlistRepo.js';
import {
  MAX_SUBSCRIPTIONS,
  getStreamStatus,
  startKisStream,
  stopKisStream,
} from '../../../clients/kisStreamClient.js';
import { escapeHtml } from '../../../alerts/telegramClient.js';
import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const reconnectWs: TelegramCommand = {
  name: '/reconnect_ws',
  category: 'EMR',
  visibility: 'ADMIN',
  riskLevel: 1,
  description: 'KIS WebSocket 강제 재연결',
  async execute({ reply }) {
    const before = getStreamStatus();
    const lastPong = before.lastPongAt
      ? new Date(before.lastPongAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
      : '없음';
    await reply(
      `🔌 <b>[KIS WebSocket 재연결 요청]</b>\n` +
      `현재 상태: ${before.connected ? '✅ 연결됨' : '❌ 끊김'}\n` +
      `구독 종목: ${before.subscribedCount}개 | 활성 가격: ${before.activePrices}개\n` +
      `재연결 카운트: ${before.reconnectCount}\n` +
      `마지막 PONG: ${lastPong}\n` +
      `기존 연결 종료 → 1초 후 재연결 시도...`,
    );

    try {
      stopKisStream();
    } catch (e) {
      console.error('[TelegramBot] /reconnect_ws stopKisStream 실패:', e);
    }

    await new Promise(resolve => setTimeout(resolve, 1000));
    const watchlist = loadWatchlist();
    // KIS 단일 세션 구독 한도(41) — gate score 상위 절삭. 초과 시 1006 강제 종료 방지.
    const codes = [...watchlist]
      .sort((a, b) => (b.gateScore ?? 0) - (a.gateScore ?? 0))
      .slice(0, MAX_SUBSCRIPTIONS)
      .map(w => w.code);
    if (codes.length === 0) {
      await reply(
        '⚠️ 워치리스트가 비어 있어 재연결할 구독 종목이 없습니다. /add 또는 /krx_scan 후 재시도하세요.',
      );
      return;
    }

    try {
      await startKisStream(codes);
    } catch (e) {
      await reply(
        `❌ <b>KIS WebSocket 재연결 실패</b>\n` +
        `${escapeHtml(e instanceof Error ? e.message : String(e))}`,
      );
      return;
    }

    const after = getStreamStatus();
    await reply(
      `✅ <b>[KIS WebSocket 재연결 완료]</b>\n` +
      `연결: ${after.connected ? '✅ OK' : '🟡 연결 중 (핸드셰이크 진행)'}\n` +
      `구독: ${after.subscribedCount}개 / 워치리스트 ${codes.length}개\n` +
      `재연결 카운트: ${after.reconnectCount}`,
    );
  },
};

commandRegistry.register(reconnectWs);

export default reconnectWs;
