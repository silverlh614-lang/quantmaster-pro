// @responsibility pipelineDiagnosis 매매 엔진 모듈
/**
 * pipelineDiagnosis.ts — 파이프라인 자가진단 (아이디어 11)
 *
 * 새벽 06:30 KST cron에서 호출 (ADR-0056 v4 — NYSE 마감 직후 + 한국장 개장 2.5h 전).
 * 개별 체크는 독립적으로 실행하여 한 체크 실패가 다른 체크를 막지 않는다.
 *
 * 알림 등급 (ADR-0056):
 *   - issues       : OPERATIONAL CRITICAL — 즉시 텔레그램 푸시 (장 시작 전 조치 필요)
 *   - warnings     : OPERATIONAL WARNING — 즉시 텔레그램 푸시 (운영 영향 있음)
 *   - informational: 누적 통계 — 일일 요약에만 (단발성 503 등 운영 무관)
 */
import fs from 'fs';
import { DATA_DIR } from '../persistence/paths.js';
import { loadWatchlist } from '../persistence/watchlistRepo.js';
import { refreshKisToken, getKisTokenRemainingHours } from '../clients/kisClient.js';
import {
  getCompletenessSnapshot,
  type CompletenessSnapshot,
} from '../screener/dataCompletenessTracker.js';
import { getYahooHealthSnapshot } from './marketDataRefresh.js';

export interface DiagnosisResult {
  hasCriticalIssue: boolean;
  issues: string[];
  warnings: string[];
  /** ADR-0056 v4 — 운영 무관 정보 (단발성 503 등). 일일 요약에만 노출. */
  informational: string[];
  checkedAt: string;
  /** 데이터 빈곤 스캔 스냅샷 — 진단 API가 함께 반환해 UI에서 활용. */
  dataCompleteness?: CompletenessSnapshot;
}

/**
 * 전체 파이프라인 자가진단.
 * CRITICAL: 장 개시 전 반드시 해결해야 하는 이슈
 * WARNING:  운영에 영향이 있으나 즉각 대응 불필요
 */
export async function runPipelineDiagnosis(): Promise<DiagnosisResult> {
  const issues: string[]        = [];
  const warnings: string[]      = [];
  const informational: string[] = [];

  // ① Volume 마운트 / 데이터 디렉터리 쓰기 가능 여부
  try {
    fs.accessSync(DATA_DIR, fs.constants.W_OK);
  } catch {
    issues.push(`💾 PERSIST 볼륨 쓰기 불가 — DATA_DIR=${DATA_DIR} 접근 실패. Railway Volume 마운트 확인 필요`);
  }

  // ② 워치리스트 비어 있음
  try {
    const watchlist = loadWatchlist();
    if (watchlist.length === 0) {
      issues.push('📋 워치리스트 비어 있음 — 오늘 08:35 autoPopulateWatchlist 실행 전까지 매수 불가');
    } else {
      const focusCount = watchlist.filter(w => w.isFocus).length;
      if (focusCount === 0) {
        const swingCount = watchlist.filter(w => w.section === 'SWING').length;
        const catalystCount = watchlist.filter(w => w.section === 'CATALYST').length;
        warnings.push(`📋 워치리스트 ${watchlist.length}개이나 SWING/CATALYST 0개 (SWING ${swingCount} / CATALYST ${catalystCount}) — 매수 후보 없음`);
      }
    }
  } catch (e) {
    warnings.push(`📋 워치리스트 로드 실패: ${e instanceof Error ? e.message : e}`);
  }

  // ③ KIS 토큰 상태 — 만료됐으면 갱신 시도
  if (process.env.KIS_APP_KEY) {
    const remaining = getKisTokenRemainingHours();
    if (remaining === 0) {
      try {
        await refreshKisToken();
        warnings.push('🔑 KIS 토큰 만료 — 자가진단 중 갱신 완료. 장 중 자동 갱신 여부 확인 권장');
      } catch (e) {
        issues.push(`🔑 KIS 토큰 갱신 실패 — LIVE 모드 주문 불가: ${e instanceof Error ? e.message : e}`);
      }
    }
    // 3시간 미만 남은 경우 경고 (장 시작 전 만료 위험)
    else if (remaining < 3) {
      warnings.push(`🔑 KIS 토큰 ${remaining}시간 미만 남음 — 장 중 만료 위험`);
    }
  } else if (process.env.AUTO_TRADE_ENABLED === 'true') {
    issues.push('🔑 KIS_APP_KEY 미설정 — 자동매매 활성화 상태이나 KIS 연결 불가');
  }

  // ④ AUTO_TRADE_ENABLED 꺼져 있음
  if (process.env.AUTO_TRADE_ENABLED !== 'true') {
    warnings.push('🚫 AUTO_TRADE_ENABLED=false — 매수 신호가 발생해도 주문 없음');
  }

  // ⑤ Yahoo Finance 헬스 — SSOT(getYahooHealthSnapshot) 누적 통계 read-only (ADR-0056)
  //
  // 자체 fetch 제거 — 단발성 503/timeout 알림 폭주 차단. 대신 24h 누적 통계로 분기:
  //   OK / STALE        → 알림 없음
  //   DEGRADED          → informational (일일 요약에만)
  //   DOWN              → issues (즉시 텔레그램, 5회 연속 실패 = 진짜 장애)
  //   UNKNOWN           → informational (cron 첫 실행 시 정상)
  const yahooHealth = getYahooHealthSnapshot();
  if (yahooHealth.status === 'DOWN') {
    issues.push(
      `🌐 Yahoo Finance 장애 (${yahooHealth.consecutiveFailures}회 연속 실패) — Gate 재평가 불가, 매수 신호 차단 위험`,
    );
  } else if (yahooHealth.status === 'STALE') {
    // 4시간 이내 success 가 있었으나 1시간 이내엔 없음 — 비활성 시간대 정상.
    informational.push(
      `🌐 Yahoo Finance 비활성 (마지막 성공 ${formatLagMinutes(yahooHealth.lastSuccessAt)}분 전) — 새벽 cron 정상 패턴`,
    );
  } else if (yahooHealth.status === 'UNKNOWN') {
    // 부팅 직후 cron 첫 실행 — 호출 이력 0건. informational 으로만 기록.
    informational.push('🌐 Yahoo Finance 호출 이력 없음 — 부팅 직후 cron 첫 실행');
  }
  // status === 'OK' → 알림 없음 (정상)

  // ⑥ Data Degradation Detector — 종목별 MTAS/DART 완성도 집계
  //
  // 빈 스캔을 '신호 부재'와 '데이터 부재'로 분리한다.
  // 집계 실패율 > 30% & 표본 충분 → '데이터 빈곤 스캔' 경고.
  // 상위 레이어(signalScanner)는 isDataStarvedScan() 체크로 매수를 보류한다.
  const completeness = getCompletenessSnapshot();
  if (completeness.isDataStarved) {
    warnings.push(
      `🧪 데이터 빈곤 스캔 — MTAS 실패 ${(completeness.mtasFailRate * 100).toFixed(1)}% / ` +
      `DART null ${(completeness.dartNullRate * 100).toFixed(1)}% (시도 M${completeness.mtasAttempts}·D${completeness.dartAttempts}). ` +
      `매수 보류 권장 — KIS 차트/DART API 상태 점검 필요.`,
    );
  } else if (completeness.mtasAttempts > 0 || completeness.dartAttempts > 0) {
    // 경계선 근처(20~30%)는 debug 수준으로만
    if (completeness.aggregateFailRate > 0.20) {
      warnings.push(
        `🧪 데이터 완성도 경계 — MTAS ${(completeness.mtasFailRate * 100).toFixed(1)}% / DART ${(completeness.dartNullRate * 100).toFixed(1)}%`,
      );
    }
  }

  return {
    hasCriticalIssue: issues.length > 0,
    issues,
    warnings,
    informational,
    checkedAt: new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) + ' KST',
    dataCompleteness: completeness,
  };
}

/** lastSuccessAt epoch → 현재 기준 경과 분 (0 = 미수집). */
function formatLagMinutes(lastSuccessAt: number): string {
  if (!lastSuccessAt) return '미수집';
  const minutes = Math.round((Date.now() - lastSuccessAt) / 60_000);
  return String(minutes);
}
