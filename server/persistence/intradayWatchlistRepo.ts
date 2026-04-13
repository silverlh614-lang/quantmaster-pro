import fs from 'fs';
import { INTRADAY_WATCHLIST_FILE, ensureDataDir } from './paths.js';

/**
 * 장중(Intraday) 워치리스트 항목.
 *
 * Pre-Market 워치리스트와 분리 운영되며, 장중 돌파·거래량 급증 종목을
 * 실시간 발굴하여 등록한다. 즉시 매수 금지 — 30분 경과 후 재검증 통과 시에만
 * signalScanner가 진입을 허용한다.
 */
export interface IntradayWatchlistEntry {
  code: string;              // 종목코드 6자리
  name: string;
  addedAt: string;           // ISO — 장중 발굴 시각
  firstSeenPrice: number;    // 발굴 시점 현재가
  openPrice: number;         // 당일 시가 (발굴 시점)
  high20d: number;           // 20일 최고가 (발굴 시점, 돌파 기준)
  volumeRatio: number;       // 거래량 / 5일 평균거래량 비율
  changeRatePct: number;     // 등락률 (%) — 발굴 시점
  entryPrice: number;        // 예상 진입가 (재검증 시 갱신)
  stopLoss: number;          // 절대가 손절선 (진입가의 5% 하락)
  targetPrice: number;       // 목표가 (진입가의 10% 상승)
  sector?: string;           // 섹터 정보
  /** 진입 준비 완료: 30분 경과 + 가격 강도 재검증 통과 시 true */
  intradayReady: boolean;
  confirmedAt?: string;      // intradayReady = true가 된 시각 (ISO)
}

export function loadIntradayWatchlist(): IntradayWatchlistEntry[] {
  ensureDataDir();
  if (!fs.existsSync(INTRADAY_WATCHLIST_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(INTRADAY_WATCHLIST_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

export function saveIntradayWatchlist(list: IntradayWatchlistEntry[]): void {
  ensureDataDir();
  fs.writeFileSync(INTRADAY_WATCHLIST_FILE, JSON.stringify(list, null, 2));
}

/** 장 마감 후 당일 장중 워치리스트 전체 삭제 */
export function clearIntradayWatchlist(): void {
  saveIntradayWatchlist([]);
  console.log('[IntradayWatchlist] 당일 장중 워치리스트 초기화 완료');
}
