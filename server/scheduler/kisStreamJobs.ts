/**
 * @responsibility KIS WebSocket 실시간 호가 스트림의 시작/종료/워치독 cron을 등록한다.
 *
 * 09:00 이전 연결 거부 → 08:55 연결 시 onerror/onclose 중복 발화 문제 방지.
 * 장중(09:00~15:30 KST) 재배포 시 다음 cron 발화를 기다리지 않고 즉시 연결한다.
 */
import { scheduledJob } from './scheduleGuard.js';
import { MAX_SUBSCRIPTIONS, getStreamStatus, startKisStream, stopKisStream } from '../clients/kisStreamClient.js';
import { loadWatchlist, type WatchlistEntry } from '../persistence/watchlistRepo.js';

const INITIAL_START_DELAY_MS = 5000;
const BOOT_START_DELAY_MS = 3000;

/**
 * 워치리스트를 gate score 내림차순으로 정렬하여 KIS 구독 상한만큼 코드만 반환.
 * KIS 단일 세션은 41 종목이 상한 → 초과 시 code=1006 강제 종료. 상위 신뢰도 종목을 우선 구독한다.
 */
function selectSubscribableCodes(entries: WatchlistEntry[]): string[] {
  return [...entries]
    .sort((a, b) => (b.gateScore ?? 0) - (a.gateScore ?? 0))
    .slice(0, MAX_SUBSCRIPTIONS)
    .map((w) => w.code);
}

/** 현재 시각이 KST 장중(월~금 09:00~15:20) 인지 판정. */
function isKstMarketHours(now: Date = new Date()): boolean {
  // KST = UTC+9. 로컬 TZ 에 의존하지 않도록 UTC 기반으로 KST 를 계산.
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const dow = kst.getUTCDay();           // 0=일 … 6=토
  if (dow === 0 || dow === 6) return false;
  const hour = kst.getUTCHours();
  const minute = kst.getUTCMinutes();
  const minutesSinceMidnight = hour * 60 + minute;
  const OPEN = 9 * 60;           // 09:00
  const CLOSE = 15 * 60 + 20;    // 15:20 — KIS 실시간 데이터 송출 종료 시각
  return minutesSinceMidnight >= OPEN && minutesSinceMidnight < CLOSE;
}

export function registerKisStreamJobs(): void {
  // 시작 — 평일 09:00 KST (UTC 00:00). 5초 지연 후 연결.
  // PR-B-2: TRADING_DAY_ONLY — KRX 공휴일 평일에 스트림 시도 무의미.
  scheduledJob('0 0 * * 1-5', 'TRADING_DAY_ONLY', 'kis_stream_start', async () => {
    await new Promise((r) => setTimeout(r, INITIAL_START_DELAY_MS));
    const entries = loadWatchlist();
    const codes = selectSubscribableCodes(entries);
    console.log(`[Scheduler] KIS WebSocket 시작 시도 — 워치리스트 ${entries.length}개 → 상위 ${codes.length}개 구독`);
    if (codes.length === 0) {
      console.warn('[Scheduler] KIS WebSocket 스트림 시작 건너뜀 — 워치리스트 비어있음 (08:35 Stage2+3 파이프라인 실패 가능성)');
      return;
    }
    await startKisStream(codes);
    console.log(`[Scheduler] KIS WebSocket 스트림 시작 — ${codes.length}개 종목 / connected=${getStreamStatus().connected}`);
  }, { timezone: 'UTC' });

  // 워치독 — 09:05, 09:15, 09:30 KST 재시도. 초기 연결 실패/일시적 장애 복구.
  // PR-B-2: TRADING_DAY_ONLY.
  scheduledJob('5,15,30 0 * * 1-5', 'TRADING_DAY_ONLY', 'kis_stream_watchdog', async () => {
    const status = getStreamStatus();
    if (status.connected) return;
    const entries = loadWatchlist();
    const codes = selectSubscribableCodes(entries);
    if (codes.length === 0) return;
    console.warn(`[Scheduler] KIS WebSocket 미연결 감지 — 재시작 시도 (구독됐던 ${status.subscribedCount}개, 워치리스트 ${entries.length}개 → 상위 ${codes.length}개, 재연결 ${status.reconnectCount}회)`);
    await startKisStream(codes);
    console.log(`[Scheduler] KIS WebSocket 워치독 재시작 — connected=${getStreamStatus().connected}`);
  }, { timezone: 'UTC' });

  // 종료 — 평일 15:20 KST (UTC 06:20). KIS 서버가 이 시각 이후 실시간 송출을 끊으므로
  // 15:35 까지 끌고 가면 재연결 루프가 좀비로 도는 문제가 있어 15:20 으로 앞당긴다.
  // PR-B-2: TRADING_DAY_ONLY — 공휴일에 스트림 stop 호출 의미 없음 (이미 미연결).
  scheduledJob('20 6 * * 1-5', 'TRADING_DAY_ONLY', 'kis_stream_stop', () => {
    stopKisStream();
    console.log('[Scheduler] KIS WebSocket 스트림 종료');
  }, { timezone: 'UTC' });

  // 부팅 시 장중 즉시 연결 — 재배포/재시작 직후 다음 09:00 cron 을 기다리지 않고 구독 재개.
  // 이벤트 루프가 비워지도록 setTimeout 으로 지연 기동하여 다른 이니셜라이저와 경합을 피한다.
  if (isKstMarketHours()) {
    setTimeout(async () => {
      try {
        if (getStreamStatus().connected) return;
        const entries = loadWatchlist();
        const codes = selectSubscribableCodes(entries);
        if (codes.length === 0) {
          console.warn('[Scheduler] KIS WebSocket 부팅 자동 연결 건너뜀 — 워치리스트 비어있음');
          return;
        }
        console.log(`[Scheduler] KIS WebSocket 부팅 자동 연결 — 장중 감지, 워치리스트 ${entries.length}개 → 상위 ${codes.length}개 구독`);
        await startKisStream(codes);
        console.log(`[Scheduler] KIS WebSocket 부팅 자동 연결 완료 — connected=${getStreamStatus().connected}`);
      } catch (e) {
        console.error('[Scheduler] KIS WebSocket 부팅 자동 연결 실패:', e);
      }
    }, BOOT_START_DELAY_MS);
  }
}
