/**
 * @responsibility KIS WebSocket 실시간 호가 스트림의 시작/종료/워치독 cron을 등록한다.
 *
 * 09:00 이전 연결 거부 → 08:55 연결 시 onerror/onclose 중복 발화 문제 방지.
 */
import cron from 'node-cron';
import { getStreamStatus, startKisStream, stopKisStream } from '../clients/kisStreamClient.js';
import { loadWatchlist } from '../persistence/watchlistRepo.js';

const INITIAL_START_DELAY_MS = 5000;

export function registerKisStreamJobs(): void {
  // 시작 — 평일 09:00 KST (UTC 00:00). 5초 지연 후 연결.
  cron.schedule('0 0 * * 1-5', async () => {
    try {
      await new Promise((r) => setTimeout(r, INITIAL_START_DELAY_MS));
      const codes = loadWatchlist().map((w) => w.code);
      console.log(`[Scheduler] KIS WebSocket 시작 시도 — 워치리스트 ${codes.length}개`);
      if (codes.length === 0) {
        console.warn('[Scheduler] KIS WebSocket 스트림 시작 건너뜀 — 워치리스트 비어있음 (08:35 Stage2+3 파이프라인 실패 가능성)');
        return;
      }
      await startKisStream(codes);
      console.log(`[Scheduler] KIS WebSocket 스트림 시작 — ${codes.length}개 종목 / connected=${getStreamStatus().connected}`);
    } catch (e) {
      console.error('[Scheduler] KIS WebSocket 시작 실패:', e);
    }
  }, { timezone: 'UTC' });

  // 워치독 — 09:05, 09:15, 09:30 KST 재시도. 초기 연결 실패/일시적 장애 복구.
  cron.schedule('5,15,30 0 * * 1-5', async () => {
    try {
      const status = getStreamStatus();
      if (status.connected) return;
      const codes = loadWatchlist().map((w) => w.code);
      if (codes.length === 0) return;
      console.warn(`[Scheduler] KIS WebSocket 미연결 감지 — 재시작 시도 (구독됐던 ${status.subscribedCount}개, 워치리스트 ${codes.length}개, 재연결 ${status.reconnectCount}회)`);
      await startKisStream(codes);
      console.log(`[Scheduler] KIS WebSocket 워치독 재시작 — connected=${getStreamStatus().connected}`);
    } catch (e) {
      console.error('[Scheduler] KIS WebSocket 워치독 재시작 실패:', e);
    }
  }, { timezone: 'UTC' });

  // 종료 — 평일 15:35 KST (UTC 06:35).
  cron.schedule('35 6 * * 1-5', () => {
    stopKisStream();
    console.log('[Scheduler] KIS WebSocket 스트림 종료');
  }, { timezone: 'UTC' });
}
