// @responsibility RRR 붕괴 부분익절(rrrCollapseExit) 발동 빈도·수익률·사후 추세 분석 진단 스크립트
/**
 * scripts/analyze-rrr-collapse.mjs — "부분매도가 너무 빨리 발생하는가?" 진단 도구.
 *
 * exitEngine/rules/rrrCollapseExit.ts (RRR 붕괴 50% 익절) 의 실제 발동 통계를 집계한다.
 * 매매/학습 로직을 일절 건드리지 않는 read-only 진단 — data/ 의 영속 파일만 읽는다.
 *
 * 데이터 소스 (둘 다 자동 탐색, 있는 것만 사용):
 *   1) data/shadow-log.json            — event==='RRR_COLLAPSE_PARTIAL' (liveRRR·returnPct 직접 기록, 최근 500건)
 *   2) data/shadow-trades.json         — fills[].exitRuleTag==='RRR_COLLAPSE_PARTIAL' (영속 거래 전수, 사후 추세 포함)
 *
 * 실행 (운영 서버 = data/ 가 있는 곳에서):
 *   node scripts/analyze-rrr-collapse.mjs
 *   PERSIST_DATA_DIR=/app/data node scripts/analyze-rrr-collapse.mjs
 *   node scripts/analyze-rrr-collapse.mjs --data /path/to/data
 */

import fs from 'fs';
import path from 'path';

// ─── 데이터 디렉토리 해석 (paths.ts 와 동일 규칙) ────────────────────────────
function resolveDataDir() {
  const argIdx = process.argv.indexOf('--data');
  if (argIdx >= 0 && process.argv[argIdx + 1]) return path.resolve(process.argv[argIdx + 1]);
  if (process.env.PERSIST_DATA_DIR) return path.resolve(process.env.PERSIST_DATA_DIR);
  return path.resolve(process.cwd(), 'data');
}
const DATA_DIR = resolveDataDir();

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    console.warn(`[warn] ${path.basename(file)} 읽기 실패: ${e instanceof Error ? e.message : e}`);
    return fallback;
  }
}

// ─── 통계 헬퍼 ───────────────────────────────────────────────────────────────
function stats(nums) {
  const xs = nums.filter((n) => typeof n === 'number' && Number.isFinite(n)).slice().sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const sum = xs.reduce((a, b) => a + b, 0);
  const mid = Math.floor(xs.length / 2);
  const median = xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
  return { n: xs.length, avg: sum / xs.length, median, min: xs[0], max: xs[xs.length - 1] };
}
function pct(n) { return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`; }
function won(n) { return `${Math.round(n).toLocaleString()}원`; }
function bucketize(values, edges, labels) {
  const counts = new Array(labels.length).fill(0);
  for (const v of values) {
    let placed = false;
    for (let i = 0; i < edges.length; i++) {
      if (v < edges[i]) { counts[i]++; placed = true; break; }
    }
    if (!placed) counts[counts.length - 1]++;
  }
  return labels.map((l, i) => ({ label: l, count: counts[i] }));
}

// ─── 1) shadow-log.json: RRR_COLLAPSE_PARTIAL 이벤트 ─────────────────────────
function analyzeShadowLog() {
  const file = path.join(DATA_DIR, 'shadow-log.json');
  const logs = readJson(file, null);
  if (!Array.isArray(logs)) return { available: false };

  const events = logs.filter((e) => e && e.event === 'RRR_COLLAPSE_PARTIAL');
  const returnPcts = events.map((e) => e.returnPct).filter((n) => typeof n === 'number');
  const liveRRRs = events.map((e) => e.liveRRR).filter((n) => typeof n === 'number');
  const dates = events.map((e) => (e.ts || '').slice(0, 10)).filter(Boolean).sort();

  // 진입 후 경과시간 (signalTime → ts)
  const holdMinutes = events
    .map((e) => {
      if (!e.ts || !e.signalTime) return null;
      const ms = new Date(e.ts).getTime() - new Date(e.signalTime).getTime();
      return Number.isFinite(ms) && ms >= 0 ? ms / 60000 : null;
    })
    .filter((n) => n !== null);

  return {
    available: true,
    logCount: logs.length,
    count: events.length,
    dateRange: dates.length ? `${dates[0]} ~ ${dates[dates.length - 1]}` : 'N/A',
    returnStats: stats(returnPcts),
    rrrStats: stats(liveRRRs),
    holdStats: stats(holdMinutes),
    returnBuckets: bucketize(
      returnPcts,
      [0, 1, 2, 3, 5],
      ['<0% (손실중 발동?)', '0~1%', '1~2%', '2~3%', '3~5%', '5%+'],
    ),
    holdBuckets: bucketize(
      holdMinutes,
      [60, 240, 1440, 4320],
      ['<1시간', '1~4시간', '4시간~1일', '1~3일', '3일+'],
    ),
    samples: events.slice(-10).map((e) => ({
      ts: e.ts, name: e.stockName, code: e.stockCode,
      returnPct: e.returnPct, liveRRR: e.liveRRR, soldQty: e.soldQty, exitPrice: e.exitPrice,
    })),
  };
}

// ─── 2) shadow-trades.json: fills[].exitRuleTag === RRR_COLLAPSE_PARTIAL ─────
function analyzeShadowTrades() {
  const file = path.join(DATA_DIR, 'shadow-trades.json');
  const trades = readJson(file, null);
  if (!Array.isArray(trades)) return { available: false };

  const hits = [];
  for (const t of trades) {
    const fills = Array.isArray(t.fills) ? t.fills : [];
    for (const f of fills) {
      // 실현분만 집계 — PROVISIONAL(LIVE 접수만·CCLD 미확인)·REVERTED 제외.
      // aggregateFillStats SSOT 동일 정책. 레거시(status 미기록)는 CONFIRMED 간주.
      const realized = f && (f.status === undefined || f.status === 'CONFIRMED');
      if (f && f.exitRuleTag === 'RRR_COLLAPSE_PARTIAL' && realized) {
        // 사후 추세: 부분익절가 대비 그 후 도달한 고점(trailingHighWaterMark) / 최종 청산가
        const exitPx = f.price;
        const peak = typeof t.trailingHighWaterMark === 'number' ? t.trailingHighWaterMark : null;
        const finalExit = typeof t.exitPrice === 'number' ? t.exitPrice : null;
        const upsideLeftToPeakPct = peak && exitPx ? ((peak - exitPx) / exitPx) * 100 : null;
        const moveToFinalPct = finalExit && exitPx ? ((finalExit - exitPx) / exitPx) * 100 : null;
        const holdMs = f.timestamp && t.signalTime
          ? new Date(f.timestamp).getTime() - new Date(t.signalTime).getTime() : null;
        hits.push({
          name: t.stockName, code: t.stockCode,
          pnlPct: f.pnlPct, soldQty: f.qty, exitPrice: exitPx,
          entry: t.shadowEntryPrice, target: t.targetPrice,
          holdMinutes: Number.isFinite(holdMs) && holdMs >= 0 ? holdMs / 60000 : null,
          upsideLeftToPeakPct, moveToFinalPct,
          finalStatus: t.status,
        });
      }
    }
  }

  const pnls = hits.map((h) => h.pnlPct).filter((n) => typeof n === 'number');
  const upsides = hits.map((h) => h.upsideLeftToPeakPct).filter((n) => typeof n === 'number');
  const finals = hits.map((h) => h.moveToFinalPct).filter((n) => typeof n === 'number');

  return {
    available: true,
    tradeCount: trades.length,
    count: hits.length,
    pnlStats: stats(pnls),
    pnlBuckets: bucketize(pnls, [0, 1, 2, 3, 5], ['<0%', '0~1%', '1~2%', '2~3%', '3~5%', '5%+']),
    upsideToPeakStats: stats(upsides),
    moveToFinalStats: stats(finals),
    hits,
  };
}

// ─── 출력 ────────────────────────────────────────────────────────────────────
function printStatsLine(label, s, fmt = pct) {
  if (!s) { console.log(`  ${label}: (데이터 없음)`); return; }
  console.log(`  ${label}: 평균 ${fmt(s.avg)} | 중앙값 ${fmt(s.median)} | 최소 ${fmt(s.min)} | 최대 ${fmt(s.max)} (n=${s.n})`);
}
function printBuckets(label, buckets, total) {
  console.log(`  ${label}:`);
  for (const b of buckets) {
    const share = total ? ((b.count / total) * 100).toFixed(0) : '0';
    const bar = '█'.repeat(Math.round((b.count / Math.max(1, total)) * 20));
    console.log(`    ${b.label.padEnd(16)} ${String(b.count).padStart(4)}건 (${share.padStart(3)}%) ${bar}`);
  }
}

function main() {
  console.log('═'.repeat(70));
  console.log(' RRR 붕괴 부분익절 (rrrCollapseExit) 발동 분석');
  console.log(` DATA_DIR = ${DATA_DIR}`);
  console.log('═'.repeat(70));

  if (!fs.existsSync(DATA_DIR)) {
    console.error(`\n[오류] DATA_DIR 가 존재하지 않습니다: ${DATA_DIR}`);
    console.error('운영 서버에서 실행하거나 --data <경로> / PERSIST_DATA_DIR 로 지정하세요.');
    process.exit(1);
  }

  // 1) shadow-log
  console.log('\n■ [1] shadow-log.json (최근 이벤트 로그, 최대 500건 보관)');
  const log = analyzeShadowLog();
  if (!log.available) {
    console.log('  (shadow-log.json 없음 또는 형식 불일치)');
  } else if (log.count === 0) {
    console.log(`  RRR_COLLAPSE_PARTIAL 이벤트 0건 (로그 총 ${log.logCount}건). 발동 이력 없음.`);
  } else {
    console.log(`  발동 횟수: ${log.count}건 / 로그 ${log.logCount}건  (기간: ${log.dateRange})`);
    printStatsLine('발동 시점 수익률 returnPct', log.returnStats);
    printStatsLine('발동 시점 liveRRR        ', log.rrrStats, (n) => n.toFixed(2));
    printStatsLine('진입→발동 경과(분)        ', log.holdStats, (n) => `${Math.round(n)}분`);
    console.log('');
    printBuckets('발동 수익률 분포', log.returnBuckets, log.count);
    console.log('');
    printBuckets('진입→발동 시간 분포', log.holdBuckets, log.holdStats ? log.holdStats.n : 0);
    console.log('\n  최근 발동 샘플 (최대 10건):');
    for (const s of log.samples) {
      console.log(`    ${(s.ts || '').slice(0, 16)} ${s.name}(${s.code}) ` +
        `수익 ${typeof s.returnPct === 'number' ? pct(s.returnPct) : '?'} ` +
        `RRR ${typeof s.liveRRR === 'number' ? s.liveRRR.toFixed(2) : '?'} ` +
        `${s.soldQty ?? '?'}주 @${typeof s.exitPrice === 'number' ? won(s.exitPrice) : '?'}`);
    }
  }

  // 2) shadow-trades
  console.log('\n■ [2] shadow-trades.json (영속 거래 전수 + 사후 추세)');
  const tr = analyzeShadowTrades();
  if (!tr.available) {
    console.log('  (shadow-trades.json 없음 또는 형식 불일치)');
  } else if (tr.count === 0) {
    console.log(`  RRR_COLLAPSE_PARTIAL fill 0건 (거래 총 ${tr.tradeCount}건).`);
  } else {
    console.log(`  발동 fill: ${tr.count}건 / 거래 ${tr.tradeCount}건`);
    printStatsLine('실현 수익률 pnlPct       ', tr.pnlStats);
    console.log('');
    printBuckets('실현 수익률 분포', tr.pnlBuckets, tr.count);
    console.log('\n  ── 사후 추세 ("팔고 나서 더 올랐나?") ──');
    printStatsLine('부분익절가→이후 고점 추가상승', tr.upsideToPeakStats);
    printStatsLine('부분익절가→최종 청산가 변화  ', tr.moveToFinalStats);
    console.log('  ※ "이후 고점 추가상승"이 크게 양(+)이면 → 너무 일찍 팔아 상승분을 놓쳤다는 신호.');
    console.log('  ※ trailingHighWaterMark/exitPrice 미기록 거래는 자동 제외(표본 n 참고).');
  }

  console.log('\n' + '═'.repeat(70));
  console.log(' 해석 가이드');
  console.log('═'.repeat(70));
  console.log(' • "발동 시점 수익률"이 대부분 0~2% 구간 → 본전 수준에서 너무 빨리 발동.');
  console.log(' • "진입→발동 경과"가 대부분 <1시간/<1일 → 보유시간이 너무 짧음.');
  console.log(' • "이후 고점 추가상승" 평균이 크게 (+) → 조기 매도로 상승분 포기.');
  console.log(' → 위 신호가 보이면 rrrCollapseExit 에 최소 수익률/최소 보유시간 가드 추가를 검토.');
}

main();
