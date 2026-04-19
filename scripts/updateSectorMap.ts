/**
 * scripts/updateSectorMap.ts — KRX 전종목 섹터 스냅샷 CLI
 *
 * 실행: npx tsx scripts/updateSectorMap.ts [--verbose]
 *
 * 부트스트랩(최초 설치 직후) 또는 수동 갱신용. 정기 갱신은 스케줄러
 * (server/scheduler/maintenanceJobs.ts) 에서 주간 cron 으로 자동 실행된다.
 *
 * 핵심 로직은 server/screener/sectorMapUpdater.ts 의 updateKrxSectorMap() 에 있다.
 * 이 파일은 CLI 진입점·종료 코드 처리만 담당한다.
 */

import { updateKrxSectorMap } from '../server/screener/sectorMapUpdater.js';

const VERBOSE = process.argv.includes('--verbose');

updateKrxSectorMap({ verbose: VERBOSE })
  .then((result) => {
    console.log(
      `[updateSectorMap] ✅ 완료 — ${result.count}개 종목 저장 ` +
      `(source=${result.source}, trdDd=${result.trdDd}, updatedAt=${result.updatedAt})`,
    );
    if (result.source !== 'KRX' && VERBOSE) {
      console.log('[updateSectorMap] 폴백 경로로 갱신됨. 진단:');
      for (const d of result.diagnostics) console.log(`  • ${d}`);
    }
    process.exit(0);
  })
  .catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[updateSectorMap] ❌ 실패 — ${msg}`);
    console.error('[updateSectorMap] 기존 파일 유지. 스케줄러가 다음 주기에 재시도합니다.');
    process.exit(1);
  });
