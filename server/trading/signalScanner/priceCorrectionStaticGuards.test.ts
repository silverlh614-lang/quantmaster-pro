/**
 * @responsibility ADR-0414 Stage 1 Read-Only Mode — 정적 grep 가드 (≥9 케이스)
 *
 * 작업 지침서 §10 22~30 — 절대 원칙 영구 차단:
 *   - LIVE 본체 0줄 변경 (signalScanner / entryEngine / exitEngine / order executor)
 *   - KIS 주문 함수 import 0건
 *   - persistence 원본 quote/master/daily overwrite 0건
 *   - 외부 API 직접 호출 0건
 *   - corrected 값을 LIVE decision 에 사용 0건
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const REPO_ROOT = resolve(__dirname, '../../..');

const PRICE_CORRECTION_ENGINE = resolve(
  REPO_ROOT,
  'server/trading/signalScanner/priceCorrectionEngine.ts',
);
const PRICE_INTEGRITY_CHECKER = resolve(
  REPO_ROOT,
  'server/trading/signalScanner/priceIntegrityChecker.ts',
);
const PRICE_CORRECTION_LINEAGE = resolve(
  REPO_ROOT,
  'server/trading/signalScanner/priceCorrectionLineage.ts',
);
const SCAN_DIAGNOSTICS = resolve(
  REPO_ROOT,
  'server/trading/signalScanner/scanDiagnostics.ts',
);

function readSrc(path: string): string {
  return readFileSync(path, 'utf8');
}

/**
 * 모든 KIS 주문 함수 5종 — ADR-0146 PR 자가 review §A 정합.
 */
const KIS_ORDER_FN_PATTERNS = [
  /\bplaceKisMarketOrder\b/,
  /\bplaceKisSellOrder\b/,
  /\bcancelKisOrder\b/,
  /\bplaceKisStopLossOrder\b/,
  /\bplaceKisTakeProfitOrder\b/,
];

describe('ADR-0414 §10 정적 grep 가드 — Stage 1 Read-Only invariant', () => {
  it('테스트 22: priceCorrectionEngine.ts KIS 주문 함수 5종 import 0건', () => {
    const src = readSrc(PRICE_CORRECTION_ENGINE);
    for (const pattern of KIS_ORDER_FN_PATTERNS) {
      expect(src).not.toMatch(pattern);
    }
  });

  it('테스트 23: priceCorrectionEngine.ts autoTradeEngine import 0건', () => {
    const src = readSrc(PRICE_CORRECTION_ENGINE);
    expect(src).not.toMatch(/from\s+['"][^'"]*autoTradeEngine[^'"]*['"]/);
    expect(src).not.toMatch(/import\s+[^'"]*['"][^'"]*autoTradeEngine[^'"]*['"]/);
  });

  it('테스트 24: priceCorrectionEngine.ts order executor import 0건 (orchestrator/tradingOrchestrator 등)', () => {
    const src = readSrc(PRICE_CORRECTION_ENGINE);
    expect(src).not.toMatch(/from\s+['"][^'"]*orchestrator\/tradingOrchestrator[^'"]*['"]/);
    expect(src).not.toMatch(/from\s+['"][^'"]*orderExecutor[^'"]*['"]/);
    expect(src).not.toMatch(/from\s+['"][^'"]*kisClient\/orders[^'"]*['"]/);
  });

  it('테스트 25: persistence 원본 quote/master/daily overwrite 0건 (saveStockMaster / saveQuoteSnapshot 등 호출 부재)', () => {
    const src = readSrc(PRICE_CORRECTION_ENGINE);
    // 영속 write 함수 패턴 — saveStockMaster / saveQuoteSnapshot / saveDailyCandle 등
    expect(src).not.toMatch(/\bsaveStockMaster\b/);
    expect(src).not.toMatch(/\bsaveQuoteSnapshot\b/);
    expect(src).not.toMatch(/\bsaveDailyCandle\b/);
    expect(src).not.toMatch(/\bappendStockMaster\b/);
    expect(src).not.toMatch(/\bupsertStockMaster\b/);
    // 일반적인 persistence write 패턴 — writeFile / fs.write* 부재
    expect(src).not.toMatch(/writeFileSync/);
    expect(src).not.toMatch(/\bfs\.writeFile\b/);
  });

  it('테스트 26: signalScanner / entryEngine / exitEngine / order executor 가 corrected 값을 live decision 에 사용하지 않음 (정적 grep)', () => {
    // 본 PR 에서 priceCorrectionEngine 호출자 0건 — *코드베이스 grep* 기반 검증.
    // 호출자가 추가되면 본 테스트가 자동 fail 하여 회귀 가드 작동.
    //
    // entryEngine / exitEngine / order executor 본체가 evaluatePriceCorrection 또는
    // priceCorrectionEngine 모듈을 import 하는지 검사.
    const targets = [
      'server/trading/entryEngine.ts',
      'server/trading/signalScanner.ts',
      'server/trading/signalScanner/index.ts',
      'server/trading/signalScanner/preflight.ts',
      'server/trading/signalScanner/perSymbol/buyListLoop.ts',
      'server/trading/signalScanner/perSymbol/intradayLoop.ts',
      'server/trading/signalScanner/perSymbolEvaluation.ts',
      'server/trading/exitEngine/index.ts',
    ];
    for (const t of targets) {
      const path = resolve(REPO_ROOT, t);
      try {
        const src = readSrc(path);
        // import path 검사 — `priceCorrectionEngine` 또는 `priceIntegrityChecker` import 부재
        expect(src).not.toMatch(/from\s+['"][^'"]*priceCorrectionEngine[^'"]*['"]/);
        expect(src).not.toMatch(/from\s+['"][^'"]*priceIntegrityChecker[^'"]*['"]/);
        // `evaluatePriceCorrection` / `evaluatePriceIntegrity` 직접 호출 부재
        expect(src).not.toMatch(/\bevaluatePriceCorrection\b/);
        expect(src).not.toMatch(/\bevaluatePriceIntegrity\b/);
      } catch (e) {
        // 파일 부재는 무시 (코드베이스 분해로 일부 파일 없을 수 있음)
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
    }
  });

  it('테스트 27: Stage 1 entryEngine.ts 수정 0줄 (priceCorrectionEngine import / 호출 0건)', () => {
    const path = resolve(REPO_ROOT, 'server/trading/entryEngine.ts');
    try {
      const src = readSrc(path);
      // entryEngine 본체가 ADR-0414 모듈에 의존 0건 — Stage 1 정책
      expect(src).not.toMatch(/priceCorrectionEngine/);
      expect(src).not.toMatch(/priceIntegrityChecker/);
      expect(src).not.toMatch(/correctedPrice/);
      expect(src).not.toMatch(/correctedGapPct/);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  });

  it('테스트 28: Stage 1 exitEngine/** 수정 0줄 (priceCorrectionEngine import / 호출 0건)', () => {
    const targets = [
      'server/trading/exitEngine/index.ts',
      'server/trading/exitEngine/rules/hardStopLoss.ts',
      'server/trading/exitEngine/rules/r6EmergencyExit.ts',
      'server/trading/exitEngine/rules/legacyTakeProfit.ts',
      'server/trading/exitEngine/rules/trailingStop.ts',
    ];
    for (const t of targets) {
      const path = resolve(REPO_ROOT, t);
      try {
        const src = readSrc(path);
        expect(src).not.toMatch(/priceCorrectionEngine/);
        expect(src).not.toMatch(/priceIntegrityChecker/);
        expect(src).not.toMatch(/correctedPrice/);
        expect(src).not.toMatch(/correctedGapPct/);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
    }
  });

  it('테스트 29: priceCorrectionEngine.ts 외부 API 직접 호출 0건 (fetch/axios/node-fetch 0건)', () => {
    const src = readSrc(PRICE_CORRECTION_ENGINE);
    // fetch 호출 (global 또는 named import) 부재
    expect(src).not.toMatch(/\bfetch\(/);
    // axios import 부재
    expect(src).not.toMatch(/from\s+['"]axios['"]/);
    // node-fetch import 부재
    expect(src).not.toMatch(/from\s+['"]node-fetch['"]/);
    // guardedFetch / kisGet / kisPost 부재 (외부 호출 layer)
    expect(src).not.toMatch(/\bguardedFetch\b/);
    expect(src).not.toMatch(/\bkisGet\b/);
    expect(src).not.toMatch(/\bkisPost\b/);
    // kisClient 본체 import 부재 (ADR-0414 Stage 1 — 데이터 수집 layer 무관)
    expect(src).not.toMatch(/from\s+['"][^'"]*kisClient[^'"]*['"]/);
  });

  it('테스트 30: priceCorrectionEngine.ts 가 이미 수집된 입력 데이터만 사용 (외부 의존성 0)', () => {
    const extractImportPaths = (src: string): string[] => {
      const paths: string[] = [];
      const re = /from\s+['"]([^'"]+)['"]/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        paths.push(m[1]);
      }
      return paths;
    };

    const src = readSrc(PRICE_CORRECTION_ENGINE);
    const importPaths = extractImportPaths(src);

    // 허용된 import — priceIntegrityChecker (타입), priceCorrectionLineage (헬퍼), 그 외 자체 모듈만
    const allowedPatterns = [
      /priceIntegrityChecker/,
      /priceCorrectionLineage/,
    ];

    for (const path of importPaths) {
      const isAllowed = allowedPatterns.some((p) => p.test(path));
      expect(
        isAllowed,
        `Unexpected import in priceCorrectionEngine.ts: ${path}`,
      ).toBe(true);
    }

    // priceIntegrityChecker.ts 도 외부 의존성 0 검증
    const integritySrc = readSrc(PRICE_INTEGRITY_CHECKER);
    const integrityPaths = extractImportPaths(integritySrc);
    expect(integrityPaths.length).toBe(0); // 외부 import 0건 (사용자 명시 절대 원칙 #10)
  });

  it('보너스 1: priceCorrectionLineage.ts 외부 의존성 0 (자체 타입 import 만)', () => {
    const src = readSrc(PRICE_CORRECTION_LINEAGE);
    const importLines = src.match(/^import\s+.*$/gm) ?? [];
    // priceCorrectionEngine 의 PriceCorrectionType 타입 import 만 허용
    for (const line of importLines) {
      expect(line).toMatch(/priceCorrectionEngine/);
    }
  });

  it('보너스 2: scanDiagnostics.ts ADR-0414 wiring — format 헬퍼 2종 + ScanSummary 옵셔널 필드 2종', () => {
    const src = readSrc(SCAN_DIAGNOSTICS);
    expect(src).toMatch(/formatPriceIntegritySection/);
    expect(src).toMatch(/formatPriceCorrectionOverlaySection/);
    expect(src).toMatch(/priceIntegrity\?:/);
    expect(src).toMatch(/priceCorrection\?:/);
    expect(src).toMatch(/ADR-0414/);
  });

  it('보너스 3: Stage 1 dead code — 본 PR 신규 모듈 호출자 0건 (검증)', () => {
    // 코드베이스 전체에서 priceCorrectionEngine 호출자 검사 — 본 PR 에서는 0건 의도
    // (Stage 2/3 후속 PR 에서 wiring)
    const callerCandidates = [
      'server/trading/signalScanner/index.ts',
      'server/trading/signalScanner/preflight.ts',
      'server/trading/signalScanner/perSymbol/buyListLoop.ts',
      'server/trading/signalScanner/perSymbol/intradayLoop.ts',
      'server/trading/signalScanner/perSymbolEvaluation.ts',
      'server/trading/entryEngine.ts',
      'server/trading/exitEngine/index.ts',
      'server/trading/buyPipeline.ts',
      'server/trading/orchestrator/tradingOrchestrator.ts',
      'server/orchestrator/tradingOrchestrator.ts',
      'server/trading/autoTradeEngine.ts',
    ];

    for (const t of callerCandidates) {
      const path = resolve(REPO_ROOT, t);
      try {
        const src = readSrc(path);
        // priceCorrectionEngine 또는 evaluatePriceCorrection 호출 0건
        expect(src).not.toMatch(/from\s+['"][^'"]*priceCorrectionEngine[^'"]*['"]/);
        expect(src).not.toMatch(/from\s+['"][^'"]*priceIntegrityChecker[^'"]*['"]/);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
    }
  });
});
