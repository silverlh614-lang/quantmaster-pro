// @responsibility EntryGate Chain of Responsibility 시그니처 SSOT
/**
 * entryGates/types.ts — Phase B Chain of Responsibility 타입 (ADR-0030).
 *
 * PR-57 PoC: 동기 게이트 3개 (blacklist/addBuyBlock/rrr).
 * PR-58 확장: async 시그니처 + 4 신규 게이트 (cooldown/sectorConcentration/
 *             sectorPreGuard/portfolioRisk). EntryGateResult 가 pass 시 옵셔널
 *             로그 메시지(통과 후 부수효과) 도 표현.
 */

import type { WatchlistEntry } from '../../../persistence/watchlistRepo.js';
import type { ServerShadowTrade } from '../../../persistence/shadowTradeRepo.js';
import type { ScanCounters } from '../scanDiagnostics.js';
import type { BuyListLoopMutables } from '../perSymbolEvaluation.js';

export interface EntryGateContext {
  stock: WatchlistEntry;
  shadows: ServerShadowTrade[];
  scanCounters: ScanCounters;
  /** PR-58: 섹터 집중도 가드 — 전체 워치리스트의 활성 종목 섹터 카운트 산출. */
  watchlist: WatchlistEntry[];
  /** PR-58: cooldown 해제·sectorPreGuard 의 mutables 접근. */
  mutables: BuyListLoopMutables;
  /** PR-58: cooldown 해제 판정 + sectorPreGuard 후보 가치 산출. */
  currentPrice: number;
  /** PR-58: sectorPreGuard estCandidateValue 계산. */
  totalAssets: number;
  /** Legacy compatibility input; Simplification Step 2 ignores it for sizing and guard estimates. */
  kellyMultiplier: number;
  /**
   * ADR-0067 (PR-Q, 페어 B #2): Multi-Timeframe Confluence 입력 (옵셔널).
   * 데이터 부재 시 timeframeConfluenceGate 가 자동 skip (PASS).
   * 데이터 주입 wiring 은 후속 PR (perSymbolEvaluation 가 stock 의
   * 일목/MA20 정렬 boolean 을 채워 ctx 에 첨부).
   */
  timeframeConfluence?: TimeframeAlignment;
}

/**
 * ADR-0067: 3 timeframe 의 일목균형표 + MA20 정렬 boolean.
 * 각 필드 true = 해당 timeframe 에서 종가가 일목 구름대 위 AND MA20 정배열.
 * undefined = 해당 timeframe 데이터 미수집 (게이트가 카운트에서 제외).
 */
export interface TimeframeAlignment {
  daily?: boolean;
  weekly?: boolean;
  intraday30m?: boolean;
}

export type EntryGateResult =
  | {
      pass: true;
      /** orchestrator 가 console.log 로 출력할 메시지 (옵션). */
      passLogMessage?: string;
      /** orchestrator 가 console.warn 으로 출력할 메시지 (옵션). */
      passWarnMessage?: string;
    }
  | {
      pass: false;
      /** orchestrator 가 console.log 로 출력할 차단 메시지. */
      logMessage: string;
      /** stageLog[key] = value (pushTrace 시 같이 영속). */
      stageLog?: { key: string; value: string };
      /** ScanCounters 의 numeric 카운터 키. */
      counter?: 'quoteFails' | 'gateMisses' | 'rrrMisses' | 'entries' | 'counterfactualRecordedToday';
      /** orchestrator 가 pushTrace() 를 호출할지 여부. */
      pushTrace?: boolean;
      /** 옵션 — 차단 시 텔레그램 알림 메시지. orchestrator 가 sendTelegramAlert 일괄 발송. */
      telegramMessage?: string;
    };

/** 동기 또는 async 게이트 — PR-58 union 확장. */
export type EntryGate = (ctx: EntryGateContext) => EntryGateResult | Promise<EntryGateResult>;
