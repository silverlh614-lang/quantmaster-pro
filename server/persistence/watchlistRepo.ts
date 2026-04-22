import fs from 'fs';
import { WATCHLIST_FILE, ensureDataDir } from './paths.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';

/**
 * 워치리스트 섹션 — 신호 품질에 따라 매매 파라미터를 차등 적용
 *
 *   SWING     — 스윙 주도주 (Discovery Pipeline, Gate 상위, MANUAL)
 *              최대 8개 · 보유 3~15일 · 표준 포지션 · ATR 동적 손절 · 만료 7영업일
 *   CATALYST  — 촉매 기반 (DART 공시, 내부자 매수)
 *              최대 5개 · 보유 1~5일 · 60% 축소 포지션 · 고정 -5% 손절 · 만료 3일
 *   MOMENTUM  — 모멘텀 관찰 (autoPopulateWatchlist AUTO, 거래량 상위)
 *              최대 20개 · 매매 안 함 · SWING 승격 시만 매수 · 만료 2영업일
 */
export type WatchlistSection = 'SWING' | 'CATALYST' | 'MOMENTUM';

const MOMENTUM_ALERT_THRESHOLD = 30;

export interface WatchlistEntry {
  code: string;          // 종목코드 6자리
  name: string;
  entryPrice: number;    // 관심 진입가
  stopLoss: number;      // 절대가 손절선
  targetPrice: number;   // 목표가
  addedAt: string;       // ISO
  gateScore?: number;    // 스크리닝 신뢰도 점수 (0~27)
  addedBy: 'AUTO' | 'MANUAL' | 'DART';  // 자동 발굴 vs 수동 추가 vs DART 공시
  memo?: string;                   // 진입 근거 ("외국인 5일 연속 순매수, 52주 신고가 돌파")
  sector?: string;                 // 섹터 정보 (섹터별 성과 분석용)
  rrr?: number;                    // Risk-Reward Ratio (목표가-진입가) / (진입가-손절가)
  conditionKeys?: string[];        // 진입 당시 통과한 Gate 조건 키 목록
  profileType?: 'A' | 'B' | 'C' | 'D'; // 종목 프로파일 (A=대형주도 B=중형성장 C=소형모멘텀 D=촉매)
  entryRegime?: string;   // 진입 시 레짐 (AI 파이프라인 메타)
  expiresAt?: string;     // 자동 만료 시각 ISO — 섹션별 차등 (SWING 7일 / CATALYST 3일 / MOMENTUM 2일)
  entryFailCount?: number; // 진입 시도 실패 횟수 (임계값 초과 시 자동 제거)
  isFocus?: boolean;      // Focus Watchlist 포함 여부 (SWING 섹션 = true)
  // Regret Asymmetry Filter
  cooldownUntil?: string; // 쿨다운 종료 시각 ISO — 직전 5일 +15% 초과 급등 시 설정
  recentHigh?: number;    // 쿨다운 진입 시점의 현재가 — 되돌림(-5~-8%) 판단 기준
  // 3-섹션 구조 — Track A/B 대체
  section?: WatchlistSection;  // SWING=매수대상 / CATALYST=촉매단기 / MOMENTUM=관찰전용
  /** @deprecated section 필드로 대체. 하위 호환용. */
  track?: 'A' | 'B';
  /**
   * Phase 4-④: LeadershipBridge 로 자동 편입된 다이내믹 MOMENTUM 종목 표시.
   * 기본 MOMENTUM(base layer) 과 구분해 4h TTL 로 자동 만료시킨다.
   */
  leadershipBridge?: boolean;
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

  const momentumCount = list.filter((entry) =>
    entry.section === 'MOMENTUM' || (!entry.section && entry.track === 'A'),
  ).length;

  if (momentumCount > MOMENTUM_ALERT_THRESHOLD) {
    void sendTelegramAlert(
      `🚨 <b>[Watchlist Overflow]</b>\n` +
      `MOMENTUM 수량이 비정상적으로 증가했습니다.\n` +
      `현재: ${momentumCount}개 / 경보 기준: ${MOMENTUM_ALERT_THRESHOLD}개`,
      {
        priority: 'HIGH',
        dedupeKey: 'watchlist-momentum-overflow',
        cooldownMs: 30 * 60 * 1000,
      },
    ).catch(console.error);
  }
}
