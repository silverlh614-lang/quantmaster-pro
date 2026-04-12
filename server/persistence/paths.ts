import path from 'path';
import fs from 'fs';

// Railway Volume 마운트 경로 우선, 미설정 시 기본 data/
export const DATA_DIR = process.env.PERSIST_DATA_DIR
  ? path.resolve(process.env.PERSIST_DATA_DIR)
  : path.resolve(process.cwd(), 'data');

export const WATCHLIST_FILE          = path.join(DATA_DIR, 'watchlist.json');

/** 레짐별 가중치 파일 경로 (예: data/condition-weights-R2_BULL.json) */
export function conditionWeightsRegimeFile(regime: string): string {
  // 파일명 안전 처리: 영숫자·_만 허용
  const safe = regime.replace(/[^A-Za-z0-9_]/g, '_');
  return path.join(DATA_DIR, `condition-weights-${safe}.json`);
}
export const SHADOW_FILE             = path.join(DATA_DIR, 'shadow-trades.json');
export const SHADOW_LOG_FILE         = path.join(DATA_DIR, 'shadow-log.json');
export const MACRO_STATE_FILE        = path.join(DATA_DIR, 'macro-state.json');
export const CONDITION_WEIGHTS_FILE  = path.join(DATA_DIR, 'condition-weights.json');
export const BLACKLIST_FILE          = path.join(DATA_DIR, 'blacklist.json');
export const FSS_RECORDS_FILE        = path.join(DATA_DIR, 'fss-records.json');
export const DART_ALERTS_FILE        = path.join(DATA_DIR, 'dart-alerts.json');
export const RECOMMENDATIONS_FILE    = path.join(DATA_DIR, 'recommendations.json');
export const SCREENER_FILE           = path.join(DATA_DIR, 'screener-cache.json');
export const PENDING_ORDERS_FILE     = path.join(DATA_DIR, 'pending-orders.json');
export const BEAR_ALERT_FILE         = path.join(DATA_DIR, 'bear-alert-state.json');
export const MHS_MORNING_ALERT_FILE  = path.join(DATA_DIR, 'mhs-morning-alert-state.json');
export const IPS_ALERT_FILE          = path.join(DATA_DIR, 'ips-alert-state.json');
export const REAL_TRADE_FLAG_FILE    = path.join(DATA_DIR, 'real-trade-ready.flag');
export const DART_FAST_SEEN_FILE     = path.join(DATA_DIR, 'dart-fast-seen.json');
export const ORCHESTRATOR_STATE_FILE = path.join(DATA_DIR, 'orchestrator-state.json');
export const TRANCHE_FILE            = path.join(DATA_DIR, 'tranche-schedule.json');

export function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  // Railway 배포 시 파일시스템 초기화 경고
  if (process.env.RAILWAY_STATIC_URL && !process.env.PERSIST_DATA_DIR) {
    console.warn(
      '[AutoTrade] ⚠️  Railway 감지됨 — PERSIST_DATA_DIR 미설정. ' +
      '배포마다 data/ 가 초기화됩니다. Railway Volume을 /app/data에 마운트한 뒤 ' +
      'PERSIST_DATA_DIR=/app/data 를 환경변수에 추가하세요.'
    );
  }
}
