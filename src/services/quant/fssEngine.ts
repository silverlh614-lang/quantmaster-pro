import {
  ForeignSupplyDayRecord,
  FssDailyScore,
  FssAlertLevel,
  FssResult,
} from '../../types/quant';

// ─── 아이디어 4: FSS 외국인 수급 방향 전환 스코어 ─────────────────────────────────

/**
 * 외국인 일별 수급 데이터를 분류하여 일별 FSS 점수를 계산한다.
 *
 *   Passive + Active 동반 순매도 → -3
 *   한쪽만 순매도              → -1
 *   혼합 (한쪽 0 등)           →  0
 *   한쪽만 순매수              → +1
 *   동반 순매수                → +3
 */
export function classifyForeignSupplyDay(record: ForeignSupplyDayRecord): FssDailyScore {
  const { date, passiveNetBuy, activeNetBuy } = record;
  const passiveSelling = passiveNetBuy < 0;
  const activeSelling = activeNetBuy < 0;
  const passiveBuying = passiveNetBuy > 0;
  const activeBuying = activeNetBuy > 0;

  let score: number;
  let label: FssDailyScore['label'];

  if (passiveSelling && activeSelling) {
    score = -3;
    label = 'BOTH_SELL';
  } else if (passiveBuying && activeBuying) {
    score = 3;
    label = 'BOTH_BUY';
  } else if (passiveSelling || activeSelling) {
    score = -1;
    label = 'PARTIAL_SELL';
  } else if (passiveBuying || activeBuying) {
    score = 1;
    label = 'PARTIAL_BUY';
  } else {
    score = 0;
    label = 'MIXED';
  }

  return { date, score, label, passiveNetBuy, activeNetBuy };
}

/**
 * FSS (Foreign Supply Shift Score) — 외국인 수급 방향 전환 스코어.
 *
 * 최근 5거래일 일별 외국인 Passive + Active 순매수 데이터를 받아
 * 5일 누적 점수를 산출하고 경보 단계를 결정한다.
 *
 * 임계치:
 *   누적 > -3           → NORMAL   (정상)
 *   -5 < 누적 ≤ -3      → CAUTION  (주의)
 *   누적 ≤ -5           → HIGH_ALERT (수급 이탈 경보)
 *
 * @param records 최근 5거래일 일별 외국인 수급 기록 (최신→과거 또는 과거→최신 모두 가능)
 */
export function computeFSS(records: ForeignSupplyDayRecord[]): FssResult {
  const now = new Date().toISOString();

  // 날짜 오름차순 정렬 후 최근 5일만 사용
  const sorted = [...records]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-5);

  const dailyScores = sorted.map(classifyForeignSupplyDay);
  const cumulativeScore = dailyScores.reduce((sum, d) => sum + d.score, 0);

  // 동반 순매도 연속 일수 (최신일부터 역순 카운트)
  let consecutiveBothSellDays = 0;
  for (let i = dailyScores.length - 1; i >= 0; i--) {
    if (dailyScores[i].label === 'BOTH_SELL') {
      consecutiveBothSellDays++;
    } else {
      break;
    }
  }

  // 경보 단계 결정
  let alertLevel: FssAlertLevel;
  if (cumulativeScore <= -5) {
    alertLevel = 'HIGH_ALERT';
  } else if (cumulativeScore <= -3) {
    alertLevel = 'CAUTION';
  } else {
    alertLevel = 'NORMAL';
  }

  // 행동 권고
  let actionMessage: string;
  if (alertLevel === 'HIGH_ALERT') {
    actionMessage = `🔴 FSS ${cumulativeScore}점 — 외국인 Passive+Active 동반 수급 이탈. 신규 매수 중단 및 기존 포지션 30% 축소 권고.`;
  } else if (alertLevel === 'CAUTION') {
    actionMessage = `⚠️ FSS ${cumulativeScore}점 — 외국인 수급 약화 감지. 신규 매수 자제 및 손절 라인 점검 권고.`;
  } else {
    actionMessage = `🟢 FSS ${cumulativeScore}점 — 외국인 수급 정상. 시스템 신호에 따라 운용 유지.`;
  }

  return {
    cumulativeScore,
    alertLevel,
    dailyScores,
    consecutiveBothSellDays,
    actionMessage,
    supplyExitDefenseRecommended: alertLevel === 'HIGH_ALERT',
    lastUpdated: now,
  };
}
