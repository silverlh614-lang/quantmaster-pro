import fs from 'fs';
import { WATCHLIST_FILE, ensureDataDir } from './paths.js';

export interface WatchlistEntry {
  code: string;          // 종목코드 6자리
  name: string;
  entryPrice: number;    // 관심 진입가
  stopLoss: number;      // 절대가 손절선
  targetPrice: number;   // 목표가
  addedAt: string;       // ISO
  gateScore?: number;    // 스크리닝 신뢰도 점수 (0~27)
  // 아이디어 6: 진입 근거 메모 & 메타데이터
  addedBy: 'AUTO' | 'MANUAL';     // 자동 발굴 vs 수동 추가
  memo?: string;                   // 진입 근거 ("외국인 5일 연속 순매수, 52주 신고가 돌파")
  sector?: string;                 // 섹터 정보 (섹터별 성과 분석용)
  rrr?: number;                    // Risk-Reward Ratio (목표가-진입가) / (진입가-손절가)
  conditionKeys?: string[];        // 아이디어 6: 진입 당시 통과한 Gate 조건 키 목록
}

export function loadWatchlist(): WatchlistEntry[] {
  ensureDataDir();
  if (!fs.existsSync(WATCHLIST_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(WATCHLIST_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

export function saveWatchlist(list: WatchlistEntry[]): void {
  ensureDataDir();
  fs.writeFileSync(WATCHLIST_FILE, JSON.stringify(list, null, 2));
}
