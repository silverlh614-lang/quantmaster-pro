#!/usr/bin/env node
/**
 * @responsibility 배포 금지 창(장중 KST 평일 08:30~16:30) 진입 시 exit 1로 파이프라인을 차단한다.
 *
 * 근거: 장중 배포는 포지션 상태·주문 큐·실시간 피드 재접속을 동시 촉발해
 *       고빈도 결함을 유발한다. 배포는 반드시 장외 시간에만 허용.
 *
 * 사용:
 *   node scripts/check_deploy_window.js         # 현재 KST 시각 검증
 *   ALLOW_DEPLOY_WINDOW=1 node scripts/check_deploy_window.js   # 강제 허용
 *
 * 허용 창:
 *   - 주말(토·일) 전일
 *   - 평일 00:00~08:29, 16:31~23:59 (장외)
 *   - 공휴일 API가 없으므로 평일 판정만 수행 — 공휴일 장중에는 운영자가 판단
 *
 * Exit code:
 *   0 — 배포 허용
 *   1 — 배포 금지(장중)
 *   2 — 잘못된 환경(TZ 계산 실패 등)
 */

const KST_OFFSET_MIN = 9 * 60;
const MARKET_OPEN_MIN  = 8 * 60 + 30;   // 08:30
const MARKET_CLOSE_MIN = 16 * 60 + 30;  // 16:30

function nowKst(now = new Date()) {
  const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const kstTotalMin = (utcMin + KST_OFFSET_MIN + 24 * 60) % (24 * 60);
  // KST day-of-week: shift UTC by +9h then read weekday
  const shifted = new Date(now.getTime() + KST_OFFSET_MIN * 60 * 1000);
  return {
    weekday: shifted.getUTCDay(),   // 0=Sun, 6=Sat
    minuteOfDay: kstTotalMin,
    iso: shifted.toISOString(),
  };
}

function isDeployBlocked(ts) {
  // 주말(토·일)은 항상 허용
  if (ts.weekday === 0 || ts.weekday === 6) return false;
  // 평일 장중이면 차단
  return ts.minuteOfDay >= MARKET_OPEN_MIN && ts.minuteOfDay <= MARKET_CLOSE_MIN;
}

function fmt(ts) {
  const h = String(Math.floor(ts.minuteOfDay / 60)).padStart(2, '0');
  const m = String(ts.minuteOfDay % 60).padStart(2, '0');
  const wd = ['일', '월', '화', '수', '목', '금', '토'][ts.weekday];
  return `KST ${wd}요일 ${h}:${m}`;
}

function main() {
  try {
    const ts = nowKst();
    const label = fmt(ts);

    if (process.env.ALLOW_DEPLOY_WINDOW === '1') {
      console.log(`[DeployWindow] 🟡 강제 허용(ALLOW_DEPLOY_WINDOW=1) — ${label}`);
      process.exit(0);
    }

    if (isDeployBlocked(ts)) {
      console.error(
        `[DeployWindow] ❌ 장중 배포 금지 — ${label}\n` +
        `  평일 08:30~16:30 은 배포 금지 창입니다. 주말 또는 장외 시간에 배포하세요.\n` +
        `  비상 상황이면 ALLOW_DEPLOY_WINDOW=1 을 명시적으로 설정하세요.`
      );
      process.exit(1);
    }

    console.log(`[DeployWindow] ✅ 배포 허용 — ${label}`);
    process.exit(0);
  } catch (e) {
    console.error(`[DeployWindow] 시각 계산 실패:`, e instanceof Error ? e.message : e);
    process.exit(2);
  }
}

// 테스트 가능하게 export (Node ESM)
export { nowKst, isDeployBlocked, MARKET_OPEN_MIN, MARKET_CLOSE_MIN };

// CLI 진입점
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) main();
