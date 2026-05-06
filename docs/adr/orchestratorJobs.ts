import { resolveTradingContext } from '../context/marketTruthLayer';
import { TradingContext } from '../context/tradingContext';

// TODO: 실제 하위 잡(Job) 모듈 경로로 변경해야 합니다.
// import { runSectorEnergy } from './sectorEnergyJob';
// import { runWatchlistRefresh } from './watchlistJob';
// import { runShadowLearning } from './learningJob';

/**
 * 임시 로거 (실제 프로젝트에서 사용하는 winston/pino 등의 logger로 교체하십시오)
 */
const logger = {
  info: (msg: string, meta?: any) => console.log(`[INFO] ${msg}`, meta || ''),
  warn: (msg: string, meta?: any) => console.warn(`[WARN] ${msg}`, meta || ''),
  error: (msg: string, meta?: any) => console.error(`[ERROR] ${msg}`, meta || ''),
};

/**
 * 매일 지정된 스케줄에 따라 실행되는 메인 오케스트레이션 잡.
 * 시간축 부채를 해결하기 위해 단일 TradingContext를 생성하고 주입합니다.
 */
export async function runDailyOrchestration() {
  logger.info('Starting daily orchestration job...');

  try {
    // 1. 단일 진실 원천(SSOT) 컨텍스트 생성
    // 이 컨텍스트 하나가 전체 하위 모듈이 공유하는 '현재 시장의 현실'이 됩니다.
    const context: TradingContext = await resolveTradingContext({ market: 'KRX' });
    
    logger.info('[MarketTruthLayer] TradingContext resolved.', {
      calendarDate: context.calendarDate,
      sessionState: context.sessionState,
      effectiveTradingDate: context.effectiveTradingDate,
      dataMode: context.dataMode,
    });

    // 2. 하위 모듈에 Context 주입 (Dependency Injection)
    // 각 하위 모듈은 더 이상 내부적으로 new Date()를 호출하지 않습니다.

    // [예시] 섹터 에너지 갱신
    // await runSectorEnergy({ context });
    logger.info('Executed Sector Energy Job with context.', { effectiveDate: context.effectiveTradingDate });

    // [예시] 워치리스트 갱신 - 휴장일/주말 여부에 따라 권한(Permissions) 통제
    if (context.permissions.allowWatchlistRefresh) {
      // await runWatchlistRefresh({ context });
      logger.info('Executed Watchlist Refresh Job.');
    } else {
      logger.info('Skipped Watchlist Refresh due to TradingPermissions.');
    }

    // [예시] 섀도우 러닝 (휴장일에는 backfill 모드로 동작 가능)
    if (context.permissions.allowShadowLearning) {
      // await runShadowLearning({ context });
      logger.info('Executed Shadow Learning Job.');
    } else {
      logger.info('Skipped Shadow Learning due to TradingPermissions.');
    }

  } catch (error) {
    logger.error('Error occurred during daily orchestration execution:', error);
    throw error;
  }
}