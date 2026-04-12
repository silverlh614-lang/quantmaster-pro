/**
 * newsSupplyLogger.ts — 뉴스-수급 시차 학습 데이터베이스
 *
 * 공급망 경보·섹터 ETF 경보 발생 시 이벤트를 기록하고,
 * 이후 T+1·T+3·T+5 거래일 후 실제 수급/주가 변화를 추적해
 * "A유형 뉴스 → B섹터 평균 T+Xd 후 반응"  패턴을 학습한다.
 *
 * 추적 지표:
 *   t1EwyChange  — T+1 거래일 EWY 변화율 (외국인 수급 프록시)
 *   t3EwyChange  — T+3 거래일 EWY 변화율
 *   t5StockAvg   — T+5 거래일 해당 한국 주식 평균 가격 변화율
 *
 * 이 데이터가 3~6개월 누적되면 어떤 공개 DB에도 없는
 * 개인화된 알파 패턴을 발굴할 수 있다.
 */

import fs from 'fs';
import { NEWS_SUPPLY_FILE, ensureDataDir } from '../persistence/paths.js';
import { fetchCloses } from '../trading/marketDataRefresh.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';

// ── 타입 ──────────────────────────────────────────────────────────────────────

export interface NewsSupplyRecord {
  id:              string;
  date:            string;    // YYYY-MM-DD — 감지 날짜
  newsType:        string;    // '방산수주' | '반도체수주' | '조선계약' | 'EWY경보' | '섹터ETF경보' 등
  source:          'SUPPLY_CHAIN' | 'EWY_FOREIGN' | 'SECTOR_FLOW';
  sector:          string;    // 한국 섹터명
  koreanStockCodes: string[]; // Yahoo Finance 심볼 (예: '012450.KS')
  koreanNames:     string[];  // 종목 한국명
  detectedAt:      string;    // ISO 8601 감지 시각
  newsHeadline:    string;    // 뉴스 헤드라인 또는 경보 설명
  significance:    'HIGH' | 'MEDIUM' | 'LOW';
  // ── 추적 데이터 (나중에 채워짐) ───────────────────────────────────────────
  t1EwyChange?:    number;   // T+1 EWY 변화율 (%)
  t3EwyChange?:    number;   // T+3 EWY 변화율 (%)
  t5StockAvg?:     number;   // T+5 관련 종목 평균 주가 변화율 (%)
  t5StockDetail?:  Record<string, number>; // 종목별 T+5 변화율
  trackedAt?:      string;   // 마지막 추적 시각
  isComplete:      boolean;  // T+5 데이터 수집 완료 여부
}

export interface NewsSupplyPattern {
  newsType:       string;
  count:          number;    // 표본 수
  avgT1EwyChange: number;   // T+1 EWY 평균 변화율
  avgT3EwyChange: number;   // T+3 EWY 평균 변화율
  avgT5StockAvg:  number;   // T+5 주가 평균 변화율
  winRate:        number;    // T+5 양수 비율 (%)
}

// ── 영업일 계산 ───────────────────────────────────────────────────────────────

function businessDaysElapsed(from: Date, to: Date): number {
  let count = 0;
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  while (d < end) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

/** N 거래일 전 Yahoo Finance 종가 대비 현재 변화율 계산 (근사치) */
async function fetchNDayChange(symbol: string, nBusinessDays: number): Promise<number | null> {
  // 거래일 N개 ≈ 캘린더 N + ceil(N/5)*2 일 → 여유 있게 range 요청
  const calDays = nBusinessDays + Math.ceil(nBusinessDays / 5) * 2 + 2;
  const range = `${calDays}d`;
  const closes = await fetchCloses(symbol, range);
  if (!closes || closes.length < 2) return null;
  // 배열 끝이 '현재', 끝-N이 'T+0 근사'
  const idx = Math.max(0, closes.length - 1 - nBusinessDays);
  const past    = closes[idx];
  const current = closes[closes.length - 1];
  if (!past || past === 0) return null;
  return parseFloat(((current - past) / past * 100).toFixed(2));
}

// ── 영속성 ────────────────────────────────────────────────────────────────────

export function loadNewsSupplyRecords(): NewsSupplyRecord[] {
  ensureDataDir();
  if (!fs.existsSync(NEWS_SUPPLY_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(NEWS_SUPPLY_FILE, 'utf-8')); } catch { return [] }
}

function saveNewsSupplyRecords(records: NewsSupplyRecord[]): void {
  ensureDataDir();
  // 최대 1000건 유지 (오래된 것부터 제거)
  const kept = records.slice(-1000);
  fs.writeFileSync(NEWS_SUPPLY_FILE, JSON.stringify(kept, null, 2));
}

// ── 공개 API ──────────────────────────────────────────────────────────────────

/**
 * 새 뉴스-수급 이벤트를 DB에 기록한다.
 * 같은 날 동일 newsType + sector 조합은 중복 기록하지 않는다.
 */
export function logNewsSupplyEvent(event: Omit<NewsSupplyRecord, 'id' | 'date' | 'isComplete'>): void {
  const records = loadNewsSupplyRecords();
  const today   = new Date().toISOString().slice(0, 10);

  // 중복 방지: 같은 날 같은 newsType + sector
  const isDup = records.some(
    r => r.date === today && r.newsType === event.newsType && r.sector === event.sector
  );
  if (isDup) {
    console.log(`[NewsSupply] 중복 기록 스킵: ${event.newsType} / ${event.sector} (${today})`);
    return;
  }

  const record: NewsSupplyRecord = {
    id:         `ns_${Date.now()}`,
    date:       today,
    isComplete: false,
    ...event,
  };
  records.push(record);
  saveNewsSupplyRecords(records);
  console.log(`[NewsSupply] 기록: ${event.newsType} / ${event.sector} — ${event.newsHeadline.slice(0, 60)}`);
}

/**
 * 미완료 레코드를 순회하며 T+1·T+3·T+5 추적 데이터를 채운다.
 * 매일 KST 09:10 cron에서 호출 (시장 개장 후 전날 데이터 반영).
 */
export async function trackPendingRecords(): Promise<void> {
  const records = loadNewsSupplyRecords();
  const now     = new Date();
  let updated   = 0;

  for (const r of records) {
    if (r.isComplete) continue;

    const detectedAt = new Date(r.detectedAt);
    const elapsed    = businessDaysElapsed(detectedAt, now);

    // T+1: 1~2 거래일 경과
    if (elapsed >= 1 && r.t1EwyChange === undefined) {
      r.t1EwyChange = await fetchNDayChange('EWY', elapsed).catch(() => undefined);
      if (r.t1EwyChange !== undefined) updated++;
    }

    // T+3: 3~4 거래일 경과
    if (elapsed >= 3 && r.t3EwyChange === undefined) {
      r.t3EwyChange = await fetchNDayChange('EWY', elapsed).catch(() => undefined);
      if (r.t3EwyChange !== undefined) updated++;
    }

    // T+5: 5+ 거래일 경과 → 개별 종목 추적 + 완료 처리
    if (elapsed >= 5 && r.t5StockAvg === undefined) {
      const changes: Record<string, number> = {};
      for (const code of r.koreanStockCodes) {
        const chg = await fetchNDayChange(code, elapsed).catch(() => null);
        if (chg !== null) changes[code] = chg;
      }
      if (Object.keys(changes).length > 0) {
        r.t5StockDetail = changes;
        const vals = Object.values(changes);
        r.t5StockAvg = parseFloat((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2));
        r.isComplete  = true;
        r.trackedAt   = new Date().toISOString();
        updated++;
        console.log(`[NewsSupply] T+5 완료: ${r.newsType}/${r.sector} → 평균 ${r.t5StockAvg}%`);
      }
    }
  }

  if (updated > 0) {
    saveNewsSupplyRecords(records);
    console.log(`[NewsSupply] 추적 갱신: ${updated}건`);
  } else {
    console.log('[NewsSupply] 추적 갱신 없음');
  }
}

/**
 * 완료 레코드를 newsType별로 집계해 패턴을 반환한다.
 * 최소 3건 이상인 newsType만 포함.
 */
export function analyzeNewsSupplyPatterns(): NewsSupplyPattern[] {
  const records   = loadNewsSupplyRecords().filter(r => r.isComplete);
  const byType    = new Map<string, NewsSupplyRecord[]>();

  for (const r of records) {
    if (!byType.has(r.newsType)) byType.set(r.newsType, []);
    byType.get(r.newsType)!.push(r);
  }

  const patterns: NewsSupplyPattern[] = [];

  for (const [newsType, recs] of byType) {
    if (recs.length < 3) continue; // 통계적 최소 표본

    const t1s    = recs.map(r => r.t1EwyChange).filter((v): v is number => v !== undefined);
    const t3s    = recs.map(r => r.t3EwyChange).filter((v): v is number => v !== undefined);
    const t5s    = recs.map(r => r.t5StockAvg).filter((v): v is number => v !== undefined);
    const avg    = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b) / arr.length : 0;
    const winCnt = t5s.filter(v => v > 0).length;

    patterns.push({
      newsType,
      count:          recs.length,
      avgT1EwyChange: parseFloat(avg(t1s).toFixed(2)),
      avgT3EwyChange: parseFloat(avg(t3s).toFixed(2)),
      avgT5StockAvg:  parseFloat(avg(t5s).toFixed(2)),
      winRate:        t5s.length ? parseFloat((winCnt / t5s.length * 100).toFixed(1)) : 0,
    });
  }

  return patterns.sort((a, b) => b.count - a.count);
}

/**
 * 월간 패턴 요약을 Telegram으로 발송.
 * 매월 1일 또는 수동 호출.
 */
export async function reportNewsSupplyPatterns(): Promise<void> {
  const patterns = analyzeNewsSupplyPatterns();
  if (patterns.length === 0) {
    console.log('[NewsSupply] 패턴 분석 데이터 부족 (완료 레코드 < 3건)');
    return;
  }

  const lines = patterns.map(p => {
    const t5sign = p.avgT5StockAvg >= 0 ? '+' : '';
    return (
      `📌 <b>${p.newsType}</b> (n=${p.count})\n` +
      `   T+1 EWY: ${p.avgT1EwyChange >= 0 ? '+' : ''}${p.avgT1EwyChange}%\n` +
      `   T+3 EWY: ${p.avgT3EwyChange >= 0 ? '+' : ''}${p.avgT3EwyChange}%\n` +
      `   T+5 주가: ${t5sign}${p.avgT5StockAvg}% (승률 ${p.winRate}%)`
    );
  }).join('\n\n');

  await sendTelegramAlert(
    `📊 <b>[뉴스-수급 시차 패턴 분석]</b>\n` +
    `완료 이벤트 기반 학습 결과:\n\n` +
    `${lines}\n\n` +
    `⚠️ 표본이 적을수록 신뢰도 낮음 — 3~6개월 축적 후 신뢰 가능`
  ).catch(console.error);
}
