// @responsibility ADR-0413 stockMaster cron 1일 2회 발동 정적 grep 가드 — 회귀 차단
/**
 * maintenanceJobsStockMasterCronAdr0413.test.ts (ADR-0413)
 *
 * `maintenanceJobs.ts` 의 `stock_master_auto_enrichment` cron 정적 검증.
 *
 * 본 PR 후 1일 2회 발동 의무:
 *   - 장전 KST 평일 06:00 (UTC 21:00 전일) — `0 21 * * 0-4`
 *   - 장후 KST 평일 19:00 (UTC 10:00) — `0 10 * * 1-5` (ADR-0413 신규)
 *
 * 회귀 차단 정책:
 *   - 동일 jobName `stock_master_auto_enrichment` 정확 2건 등록 (KIS 토큰 cron 패턴 정합)
 *   - ScheduleClass='TRADING_DAY_ONLY' 모두 적용 (KRX 휴장일 자동 skip)
 *   - `runStockMasterEnrichmentCron(label)` SSOT 헬퍼 사용 — cron 본체 inline 정의 부재
 *   - LIVE 매매 본체 무수정 (kisClient/orchestrator/autoTradeEngine import 0건)
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SOURCE_PATH = path.resolve(__dirname, 'maintenanceJobs.ts');

function loadSource(): string {
  return fs.readFileSync(SOURCE_PATH, 'utf-8');
}

/** 주석 strip — false positive 차단. */
function stripComments(src: string): string {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '');
  out = out.replace(/(^|[^:])\/\/.*$/gm, '$1');
  return out;
}

describe('ADR-0413 stockMaster cron 1일 2회 발동 정적 가드', () => {
  describe('cron 등록 매트릭스', () => {
    it('stock_master_auto_enrichment jobName 정확 2건 등록 (KIS 토큰 cron 패턴 정합)', () => {
      const src = stripComments(loadSource());
      const matches = src.match(/'stock_master_auto_enrichment'/g) ?? [];
      expect(matches.length).toBe(2);
    });

    it('장전 06:00 KST cron 등록 — `0 21 * * 0-4` (UTC 21:00 전일)', () => {
      const src = stripComments(loadSource());
      // 장전 cron expression + ScheduleClass + jobName 동일 라인 또는 인접 호출 검증
      expect(src).toMatch(
        /scheduledJob\(\s*'0 21 \* \* 0-4',\s*'TRADING_DAY_ONLY',\s*'stock_master_auto_enrichment'/,
      );
    });

    it('장후 19:00 KST cron 등록 — `0 10 * * 1-5` (UTC 10:00, ADR-0413 신규)', () => {
      const src = stripComments(loadSource());
      expect(src).toMatch(
        /scheduledJob\(\s*'0 10 \* \* 1-5',\s*'TRADING_DAY_ONLY',\s*'stock_master_auto_enrichment'/,
      );
    });

    it('두 cron 모두 ScheduleClass="TRADING_DAY_ONLY" — KRX 휴장일 자동 skip (ADR-0045 정합)', () => {
      const src = stripComments(loadSource());
      // jobName 매칭 안에 'ALWAYS_ON' 같은 다른 ScheduleClass 사용 부재 검증
      const re = /scheduledJob\(\s*'[^']+',\s*'(\w+)',\s*'stock_master_auto_enrichment'/g;
      const classes: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        classes.push(m[1]);
      }
      expect(classes.length).toBe(2);
      expect(classes.every((c) => c === 'TRADING_DAY_ONLY')).toBe(true);
    });
  });

  describe('runStockMasterEnrichmentCron SSOT 헬퍼', () => {
    it('`runStockMasterEnrichmentCron` 헬퍼 정의 1건 (cron 본체 inline 부재)', () => {
      const src = loadSource(); // 주석 포함 — function 정의 검증
      const defMatches = src.match(/async function runStockMasterEnrichmentCron\(/g) ?? [];
      expect(defMatches.length).toBe(1);
    });

    it('두 cron 모두 `runStockMasterEnrichmentCron(label)` 호출 — drift 차단', () => {
      const src = stripComments(loadSource());
      // cron 콜백 위치에서 헬퍼 호출 정확히 2건
      const callMatches = src.match(/runStockMasterEnrichmentCron\(/g) ?? [];
      // 정의 1건 + 호출 2건 = 3건
      expect(callMatches.length).toBeGreaterThanOrEqual(3);
    });

    it('label 인자 — `장전 06:00 KST` + `장후 19:00 KST` 두 시간대 명시', () => {
      const src = stripComments(loadSource());
      expect(src).toMatch(/runStockMasterEnrichmentCron\('장전 06:00 KST'\)/);
      expect(src).toMatch(/runStockMasterEnrichmentCron\('장후 19:00 KST'\)/);
    });

    it('헬퍼 본체 — autoEnrichAndVerifyStockMaster 호출 + try/catch 격리', () => {
      const src = stripComments(loadSource());
      // 헬퍼 안에서 본체 함수 호출 + label 진단 로그
      expect(src).toMatch(/await autoEnrichAndVerifyStockMaster\(\)/);
      expect(src).toMatch(/\[StockMasterAutoEnrichment\] \(\$\{label\}\)/);
    });
  });

  describe('LIVE 매매 본체 무수정 (절대 규칙 #2/#3/#4)', () => {
    it('KIS 주문 함수 5종 import 0건 (kisClient orders.ts 본체 무관)', () => {
      const src = loadSource();
      expect(src).not.toMatch(/placeKisMarketOrder/);
      expect(src).not.toMatch(/placeKisSellOrder/);
      expect(src).not.toMatch(/cancelKisOrder/);
      expect(src).not.toMatch(/placeKisStopLossOrder/);
      expect(src).not.toMatch(/placeKisTakeProfitOrder/);
    });

    it('autoTradeEngine import 0건', () => {
      const src = loadSource();
      expect(src).not.toMatch(/from ['"][^'"]*autoTradeEngine['"]/);
    });

    it('orchestrator/tradingOrchestrator 본체 import 0건', () => {
      const src = loadSource();
      // 본 cron 은 maintenance 경로 — orchestrator 분리
      expect(src).not.toMatch(/from ['"][^'"]*tradingOrchestrator['"]/);
    });
  });

  describe('ENV 우회 보존 — STOCK_MASTER_AUTO_ENRICHMENT_DISABLED', () => {
    it('cron 라벨에 ENV 우회 안내 보존 (ADR-0242 호환)', () => {
      const src = loadSource(); // 주석 포함
      expect(src).toMatch(/STOCK_MASTER_AUTO_ENRICHMENT_DISABLED/);
    });

    it('신규 ENV 도입 0건 — `STOCK_MASTER_EVENING_DISABLED` 등 부재', () => {
      const src = loadSource();
      expect(src).not.toMatch(/STOCK_MASTER_EVENING/);
      expect(src).not.toMatch(/STOCK_MASTER_MORNING/);
      expect(src).not.toMatch(/STOCK_MASTER_AUTO_ENRICHMENT_EVENING/);
    });
  });

  describe('ADR-0413 추적성', () => {
    it('cron 등록 인접 주석에 ADR-0413 명시', () => {
      const src = loadSource();
      expect(src).toMatch(/ADR-0413/);
    });

    it('KIS 토큰 cron 패턴 정합 명시 (사용자 명시 정책)', () => {
      const src = loadSource();
      expect(src).toMatch(/KIS 토큰[^\n]*패턴/);
    });
  });
});
