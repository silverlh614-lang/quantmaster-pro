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

// PR-3 #8: 섹션별 하드 상한 — watchlistManager.SECTION_MAX 와 동일 값.
// 순환 import 를 피하기 위해 상수를 복제해 놓는다. 값이 바뀌면 양쪽 동기 필요.
//
// 기존에는 16:00 KST cleanupWatchlist 스케줄에서만 상한을 강제했기 때문에, 사이
// 시점에 addToWatchlist 가 연속 호출되면 MOMENTUM 이 50 → 91 까지 방치되는 사례가
// 발생했다 (2026-04-23 Telegram 경보 이력). saveWatchlist 시점에 즉시 trim.
const SECTION_HARD_MAX: Record<'SWING' | 'CATALYST' | 'MOMENTUM', number> = {
  SWING:     8,
  CATALYST:  5,
  MOMENTUM: 50,
};

function sectionOf(entry: WatchlistEntry): 'SWING' | 'CATALYST' | 'MOMENTUM' {
  if (entry.section) return entry.section;
  // 레거시 track 필드 fallback (track='A' = MOMENTUM, 'B' = SWING)
  if (entry.track === 'A') return 'MOMENTUM';
  if (entry.track === 'B') return 'SWING';
  return 'MOMENTUM';
}

/**
 * 섹션별 하드 상한을 강제한다. gateScore 내림차순으로 정렬해 상위만 유지,
 * 나머지는 드롭. LeadershipBridge(동적 편입) 표식은 같은 점수일 때 먼저 드롭.
 */
function enforceSectionCaps(list: WatchlistEntry[]): {
  trimmed: WatchlistEntry[];
  dropped: Record<'SWING' | 'CATALYST' | 'MOMENTUM', number>;
} {
  const dropped = { SWING: 0, CATALYST: 0, MOMENTUM: 0 };
  const bySection: Record<'SWING' | 'CATALYST' | 'MOMENTUM', WatchlistEntry[]> = {
    SWING: [], CATALYST: [], MOMENTUM: [],
  };
  for (const entry of list) bySection[sectionOf(entry)].push(entry);

  const rankKey = (e: WatchlistEntry): number =>
    (e.gateScore ?? 0) - (e.leadershipBridge ? 0.5 : 0);

  for (const section of ['SWING', 'CATALYST', 'MOMENTUM'] as const) {
    const arr = bySection[section];
    const max = SECTION_HARD_MAX[section];
    if (arr.length <= max) continue;
    arr.sort((a, b) => rankKey(b) - rankKey(a));
    bySection[section] = arr.slice(0, max);
    dropped[section] = arr.length - max;
  }

  return {
    trimmed: [...bySection.SWING, ...bySection.CATALYST, ...bySection.MOMENTUM],
    dropped,
  };
}

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
  /**
   * ADR-0004 / PreMarket: 마지막 preMarketOrderPrep 루프에서 이 종목이 스킵된 사유.
   * 값 예: 'SKIP_NO_DATA' | 'SKIP_STALE' | 'SKIP_DATA_ERROR' | 'GATE_SKIP' | 'GUARD_*'
   * 장전 Telegram 브리핑·대시보드에서 "왜 주문 안 들어갔는가" 단일 원천.
   */
  lastSkipReason?: string;
  /** lastSkipReason 이 기록된 시각 (ISO). */
  lastSkipAt?: string;
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

  // PR-3 #8: 섹션별 하드 상한 강제. 상한 초과 시 gateScore 상위만 유지.
  // 이전에는 cleanupWatchlist (16:00 KST) 만 상한을 강제해, 사이 시점에 autoPopulate
  // 가 연속 호출되면 MOMENTUM 91개 누적 사례가 발생했다. 이제 매 저장마다 즉시 trim.
  const { trimmed, dropped } = enforceSectionCaps(list);
  const totalDropped = dropped.SWING + dropped.CATALYST + dropped.MOMENTUM;

  fs.writeFileSync(WATCHLIST_FILE, JSON.stringify(trimmed, null, 2));

  const momentumCount = trimmed.filter((entry) =>
    entry.section === 'MOMENTUM' || (!entry.section && entry.track === 'A'),
  ).length;

  // 트림이 실제로 일어났다면 운영자에게 알림 (쿨다운 15분 — 과잉 스팸 방지).
  if (totalDropped > 0) {
    const dropLines = (['SWING', 'CATALYST', 'MOMENTUM'] as const)
      .filter(sec => dropped[sec] > 0)
      .map(sec => `  ${sec}: ${dropped[sec]}개 드롭 → ${SECTION_HARD_MAX[sec]}개 유지`)
      .join('\n');
    void sendTelegramAlert(
      `✂️ <b>[Watchlist Auto-Trim]</b>\n` +
      `섹션 상한 초과로 ${totalDropped}개 자동 정리:\n${dropLines}\n` +
      `기준: gateScore 상위 유지, LeadershipBridge 우선 드롭.`,
      {
        priority: 'NORMAL',
        dedupeKey: 'watchlist-autotrim',
        cooldownMs: 15 * 60 * 1000,
      },
    ).catch(console.error);
  }

  // 자동 trim 이후에도 MOMENTUM 이 여전히 임계치 초과면(= 50/50 근접) 포화 경보.
  // 의미: gateScore 가 고르게 높아 trim 이 배제하지 못할 만큼 모멘텀 종목이 많다.
  if (momentumCount > MOMENTUM_ALERT_THRESHOLD) {
    void sendTelegramAlert(
      `🚨 <b>[Watchlist 포화]</b>\n` +
      `MOMENTUM 섹션이 상한 근접: ${momentumCount}개 / 경보 기준: ${MOMENTUM_ALERT_THRESHOLD}개\n` +
      `신호 발굴 필터를 재검토하세요.`,
      {
        priority: 'HIGH',
        dedupeKey: 'watchlist-momentum-overflow',
        cooldownMs: 30 * 60 * 1000,
      },
    ).catch(console.error);
  }
}
