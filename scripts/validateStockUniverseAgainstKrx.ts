#!/usr/bin/env tsx
// @responsibility STOCK_UNIVERSE 시드 ↔ KRX 마스터 정합성 일회성 검증 (ADR-0262)
/**
 * scripts/validateStockUniverseAgainstKrx.ts
 *
 * 사용자 5/6 보고: 054300 / 298060 같은 종목이 STOCK_UNIVERSE 시드 (~225 entries)
 * 에 없거나 시장 분류가 KRX 와 다른 결함. 본 스크립트는 STOCK_UNIVERSE 시드를
 * KRX 마스터 (fetchKrxMasterEntries — MDCSTAT01901 raw fetch) 와 비교해 불일치
 * 종목을 리포트.
 *
 * 사용법:
 *   $ npx tsx scripts/validateStockUniverseAgainstKrx.ts
 *   $ npx tsx scripts/validateStockUniverseAgainstKrx.ts --json > report.json
 *
 * Output:
 *   - 콘솔: 사람 읽기용 표 (코드 / 시드 vs KRX 차이)
 *   - --json 플래그: 머신 읽기용 JSON (자동 PR 생성용)
 *
 * 안전성:
 *   - Read-only — STOCK_UNIVERSE / KRX 마스터 *직접 수정 0건*
 *   - 운영자가 결과 검토 후 수동 또는 ADR-0242 cron 으로 갱신
 *   - 주말 / 평일 18:00 이전 KRX 호출 자체 skip (휴장 / 통계 미확정)
 */

import { STOCK_UNIVERSE } from '../server/screener/stockUniverse.js';
import { fetchKrxMasterEntries, type StockMasterEntry } from '../server/persistence/krxStockMasterRepo.js';

interface MismatchEntry {
  code: string;
  seedName: string;
  seedMarket: 'KOSPI' | 'KOSDAQ' | 'UNKNOWN';
  krxName: string | '없음';
  krxMarket: string | '없음';
  reason: 'NOT_IN_KRX' | 'NAME_MISMATCH' | 'MARKET_MISMATCH' | 'BOTH_MISMATCH';
}

function parseMarketFromSymbol(symbol: string): 'KOSPI' | 'KOSDAQ' | 'UNKNOWN' {
  if (symbol.endsWith('.KS')) return 'KOSPI';
  if (symbol.endsWith('.KQ')) return 'KOSDAQ';
  return 'UNKNOWN';
}

async function validate(): Promise<void> {
  const wantJson = process.argv.includes('--json');

  if (!wantJson) {
    console.log('━━━ STOCK_UNIVERSE ↔ KRX 마스터 정합성 검증 (ADR-0262) ━━━');
    console.log(`STOCK_UNIVERSE 시드: ${STOCK_UNIVERSE.length}개`);
    console.log('KRX 마스터 페치 중...');
  }

  const krxResult = await fetchKrxMasterEntries();
  if (!krxResult.ok) {
    const msg = `KRX 페치 실패: reason=${krxResult.reason ?? 'UNKNOWN'} detail=${krxResult.detail ?? ''}`;
    if (wantJson) {
      console.log(JSON.stringify({ ok: false, reason: krxResult.reason, detail: krxResult.detail }, null, 2));
    } else {
      console.error(msg);
    }
    process.exit(1);
  }

  const krxMap = new Map<string, StockMasterEntry>();
  for (const entry of krxResult.entries) krxMap.set(entry.code, entry);

  if (!wantJson) console.log(`KRX 마스터: ${krxResult.entries.length}개\n`);

  const mismatches: MismatchEntry[] = [];
  for (const seed of STOCK_UNIVERSE) {
    const seedMarket = parseMarketFromSymbol(seed.symbol);
    const krx = krxMap.get(seed.code);
    if (!krx) {
      mismatches.push({
        code: seed.code,
        seedName: seed.name,
        seedMarket,
        krxName: '없음',
        krxMarket: '없음',
        reason: 'NOT_IN_KRX',
      });
      continue;
    }
    const nameMismatch = seed.name !== krx.name;
    const marketMismatch = seedMarket !== krx.market;
    if (nameMismatch || marketMismatch) {
      const reason: MismatchEntry['reason'] = nameMismatch && marketMismatch
        ? 'BOTH_MISMATCH'
        : nameMismatch ? 'NAME_MISMATCH' : 'MARKET_MISMATCH';
      mismatches.push({
        code: seed.code,
        seedName: seed.name,
        seedMarket,
        krxName: krx.name,
        krxMarket: krx.market,
        reason,
      });
    }
  }

  // Output
  if (wantJson) {
    console.log(JSON.stringify({
      ok: true,
      seedTotal: STOCK_UNIVERSE.length,
      krxTotal: krxResult.entries.length,
      mismatchTotal: mismatches.length,
      mismatches,
    }, null, 2));
  } else {
    console.log(`총 ${mismatches.length}개 불일치 발견${mismatches.length === 0 ? ' ✅' : ' ⚠️'}`);
    if (mismatches.length === 0) {
      console.log('STOCK_UNIVERSE 시드 ↔ KRX 마스터 완전 일치.');
    } else {
      console.log('');
      console.log('코드   | 사유            | 시드 (이름·시장)        | KRX (이름·시장)');
      console.log('───────┼─────────────────┼─────────────────────────┼─────────────────────────');
      for (const m of mismatches) {
        const seedStr = `${m.seedName} (${m.seedMarket})`.padEnd(24);
        const krxStr = `${m.krxName} (${m.krxMarket})`.padEnd(24);
        console.log(`${m.code} | ${m.reason.padEnd(15)} | ${seedStr} | ${krxStr}`);
      }
      console.log('');
      console.log('운영자 액션:');
      console.log('  1. NAME_MISMATCH: STOCK_UNIVERSE.ts 종목명 KRX 기준 갱신');
      console.log('  2. MARKET_MISMATCH: 시장 이전 종목 — symbol .KS/.KQ 정정');
      console.log('  3. NOT_IN_KRX: 상장폐지 가능성 — STOCK_UNIVERSE.ts 에서 제거');
      console.log('  4. ADR-0242 cron 활성 시 stockMaster (data/krx-stock-master.json) 는 자동 갱신됨');
    }
  }

  process.exit(mismatches.length === 0 ? 0 : 1);
}

validate().catch((e) => {
  console.error('스크립트 실행 오류:', e);
  process.exit(2);
});
