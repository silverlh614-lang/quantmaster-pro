/**
 * pipelineDiagnosis.ts — 파이프라인 자가진단 (아이디어 11)
 *
 * 새벽 02:00 KST cron에서 호출. 장 시작 7시간 전에 치명 이슈를 감지한다.
 * 개별 체크는 독립적으로 실행하여 한 체크 실패가 다른 체크를 막지 않는다.
 */
import fs from 'fs';
import { DATA_DIR } from '../persistence/paths.js';
import { loadWatchlist } from '../persistence/watchlistRepo.js';
import { refreshKisToken, getKisTokenRemainingHours } from '../clients/kisClient.js';

export interface DiagnosisResult {
  hasCriticalIssue: boolean;
  issues: string[];
  warnings: string[];
  checkedAt: string;
}

/**
 * 전체 파이프라인 자가진단.
 * CRITICAL: 장 개시 전 반드시 해결해야 하는 이슈
 * WARNING:  운영에 영향이 있으나 즉각 대응 불필요
 */
export async function runPipelineDiagnosis(): Promise<DiagnosisResult> {
  const issues: string[]   = [];
  const warnings: string[] = [];

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

  // ⑤ Yahoo Finance 응답성 테스트 (SK하이닉스 000660.KS)
  try {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 8_000);
    const res = await fetch(
      'https://query1.finance.yahoo.com/v8/finance/chart/000660.KS?interval=1d&range=1d',
      { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } },
    );
    clearTimeout(timeout);
    if (!res.ok) {
      warnings.push(`🌐 Yahoo Finance 응답 이상 (HTTP ${res.status}) — Gate 재평가 실패 가능`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('abort') || msg.includes('timeout')) {
      warnings.push('🌐 Yahoo Finance 응답 타임아웃 (8초) — Gate 재평가 속도 저하 가능');
    } else {
      issues.push(`🌐 Yahoo Finance 연결 실패 — Gate 재평가 불가, 매수 신호 차단됨: ${msg}`);
    }
  }

  return {
    hasCriticalIssue: issues.length > 0,
    issues,
    warnings,
    checkedAt: new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) + ' KST',
  };
}
