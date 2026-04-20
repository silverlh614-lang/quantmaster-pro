import fs from 'fs';
// Phase 5-⑩: 이메일 채널 제거 — DART 공시 알림은 Telegram 단일 채널로 통합.
import { DART_FAST_SEEN_FILE, DART_LLM_STATE_FILE, ensureDataDir } from '../persistence/paths.js';
import { type DartAlert, loadDartAlerts, saveDartAlerts } from '../persistence/dartRepo.js';
import { loadWatchlist, saveWatchlist, type WatchlistEntry } from '../persistence/watchlistRepo.js';
import { tryEvictWeakest, tryEvictMostDataStarved, CATALYST_MAX_SIZE } from '../screener/watchlistManager.js';
import { getStockCompletenessScore } from '../screener/dataCompletenessTracker.js';
import { loadShadowTrades } from '../persistence/shadowTradeRepo.js';
import { isOpenShadowStatus } from '../trading/entryEngine.js';
import { fetchCurrentPrice } from '../clients/kisClient.js';
import { callGemini } from '../clients/geminiClient.js';
import { sendTelegramAlert, escapeHtml } from './telegramClient.js';

// ── 인메모리 중복 방지 캐시 (서버 재시작 시 초기화 — 의도적) ─────────────────
// 파일 기반 seen Set(DART_FAST_SEEN_FILE)에 더해 메모리 캐시로 중복 Gemini 호출을 차단.
// 4시간 TTL: 당일 재반복 공시 방어 + 메모리 누수 방지.
const _processedIds     = new Set<string>();
const _PROCESSED_TTL_MS = 4 * 60 * 60 * 1000; // 4시간

function markProcessed(id: string): void {
  _processedIds.add(id);
  setTimeout(() => _processedIds.delete(id), _PROCESSED_TTL_MS);
}

// ── Telegram DART 알림 dedupe 옵션 헬퍼 ─────────────────────────────────────
// 같은 공시(rceptNo)는 24시간 내 1회만 발송. fastDartCheck(1분) ×
// pollDartDisclosures(30분)가 같은 공시를 중복 발견해도 Telegram 스팸 방지.
const DART_DEDUPE_TTL_MS = 24 * 60 * 60 * 1000;
function dartTelegramOpts(rceptNo: string, suffix = '') {
  return {
    dedupeKey: `dart:${suffix ? suffix + ':' : ''}${rceptNo}`,
    cooldownMs: DART_DEDUPE_TTL_MS,
  };
}

// 고영향 공시 키워드 (가격 이동 유발 가능성 높은 공시 유형)
export const FAST_DART_KEYWORDS = [
  '무상증자', '자사주취득', '자사주소각', '영업이익', '잠정실적',
  '수주', '흑자전환', '분기실적', '연간실적', '대규모수주',
];

// 지분 공시 무시 키워드 목록 — LLM 분석 대신 룰 기반 수급 분석 적용 대상
export const IGNORE_DISCLOSURES = [
  '임원',
  '주요주주',
  '소유상황',
  '특정증권',
  '지분공시',
  '주식등의 대량보유',
  '변동보고서',
];

// 내부자 매수 감지 키워드 (대주주/임원 장내매수)
const INSIDER_BUY_KEYWORDS = [
  '임원ㆍ주요주주특정증권등소유상황보고서',
  '주요주주특정증권등소유상황보고서',
  '장내매수', '장내 매수', '취득(장내매수)',
  '대표이사 매수', '대주주 매수', '내부자매수',
];

function loadFastSeenNos(): Set<string> {
  ensureDataDir();
  if (!fs.existsSync(DART_FAST_SEEN_FILE)) return new Set();
  try {
    const arr = JSON.parse(fs.readFileSync(DART_FAST_SEEN_FILE, 'utf-8')) as string[];
    return new Set(arr);
  } catch { return new Set(); }
}

function saveFastSeenNos(seen: Set<string>): void {
  ensureDataDir();
  // 최근 2000건만 유지 (파일 비대화 방지)
  const arr = [...seen].slice(-2000);
  fs.writeFileSync(DART_FAST_SEEN_FILE, JSON.stringify(arr, null, 2));
}

// ── 악재 소화 완료 캐시: 부정 공시 후 주가 미하락 종목 코드 → 공시 접수번호 ────
interface BadNewsState {
  /** stockCode → { rceptNo, alertedAt, priceAtAlert } */
  negativeAlerts: Record<string, { rceptNo: string; alertedAt: string; priceAtAlert?: number }>;
}

function loadDartLlmState(): BadNewsState {
  ensureDataDir();
  if (!fs.existsSync(DART_LLM_STATE_FILE)) return { negativeAlerts: {} };
  try { return JSON.parse(fs.readFileSync(DART_LLM_STATE_FILE, 'utf-8')); } catch {
    return { negativeAlerts: {} };
  }
}

function saveDartLlmState(state: BadNewsState): void {
  ensureDataDir();
  fs.writeFileSync(DART_LLM_STATE_FILE, JSON.stringify(state, null, 2));
}

/** 공시 제목 키워드 기반 감성 분류 */
export function classifyDisclosure(reportName: string): DartAlert['sentiment'] {
  const pos = ['수주', '계약', '영업이익', '흑자', '특허', '신약', '승인', '상장', '유상증자 철회'];
  const major = ['대규모 수주', '영업이익 서프라이즈', '임상 성공', '최대 실적'];
  const neg = ['유상증자', '전환사채', '소송', '적자', '손실', '부도', '상장폐지', '횡령'];

  if (major.some((k) => reportName.includes(k))) return 'MAJOR_POSITIVE';
  if (pos.some((k)   => reportName.includes(k))) return 'POSITIVE';
  if (neg.some((k)   => reportName.includes(k))) return 'NEGATIVE';
  return 'NEUTRAL';
}

/**
 * 내부자 매수 여부 감지.
 * 임원/대주주 장내매수 관련 공시 제목이면 true.
 */
export function detectInsiderBuy(reportName: string): boolean {
  return INSIDER_BUY_KEYWORDS.some((kw) => reportName.includes(kw));
}

/**
 * 지분 공시 여부 확인 — true이면 LLM 분석 대신 룰 기반 수급 분석을 사용한다.
 * 임원/대주주 소유 현황 보고, 대량보유 변동 등 지분 관련 공시가 해당된다.
 */
export function isOwnershipDisclosure(title: string): boolean {
  return IGNORE_DISCLOSURES.some((k) => title.includes(k));
}

/**
 * 지분 공시 룰 기반 수급 분석.
 * LLM보다 룰 기반이 더 정확한 영역 — 매수/매도/소폭변동 3단계로 분류한다.
 * - 임원·대주주 매수 → POSITIVE (긍정적 수급 신호)
 * - 임원·대주주 매도 → NEGATIVE (수급 압력)
 * - 단순 보고·소폭 변동 → NEUTRAL (무시)
 * NEUTRAL이면서 Gemini API 키가 있으면 LLM fallback을 실행한다.
 */
export async function analyzeOwnershipChange(
  corpName: string,
  reportNm: string,
): Promise<{ sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL'; reason: string }> {
  const buyPatterns  = ['장내매수', '장내 매수', '취득'];
  const sellPatterns = ['장내매도', '장내 매도', '처분', '매도'];

  if (buyPatterns.some((k) => reportNm.includes(k))) {
    return { sentiment: 'POSITIVE', reason: `${corpName} 임원·대주주 매수 — 긍정적 수급 신호` };
  }
  if (sellPatterns.some((k) => reportNm.includes(k))) {
    return { sentiment: 'NEGATIVE', reason: `${corpName} 임원·대주주 매도 — 수급 압력` };
  }

  // LLM fallback: 패턴으로 판단 불가한 경우 Gemini에 위임
  if (process.env.GEMINI_API_KEY) {
    try {
      const result = await classifyImpactWithLlm(corpName, reportNm);
      if (result.impact > 0) return { sentiment: 'POSITIVE', reason: result.reason };
      if (result.impact < 0) return { sentiment: 'NEGATIVE', reason: result.reason };
    } catch { /* fallback to NEUTRAL */ }
  }

  return { sentiment: 'NEUTRAL', reason: '소폭 변동 또는 단순 보고 — 무시' };
}

/**
 * Gemini를 이용해 공시의 단기 주가 임팩트를 5단계로 분류한다.
 * -2 / -1 / 0 / +1 / +2
 * Gemini 호출 실패 시 0(중립) 반환.
 */
async function classifyImpactWithLlm(
  corpName: string,
  reportName: string,
): Promise<{ impact: number; reason: string }> {
  const prompt =
    `한국 주식 공시가 해당 종목의 단기(1~5거래일) 주가에 미칠 임팩트를 5단계로 분류하라.\n` +
    `분류 기준:\n` +
    `  +2: 매우 긍정적 (주가 상승 강도 높음)\n` +
    `  +1: 긍정적\n` +
    `   0: 중립 또는 불확실\n` +
    `  -1: 부정적\n` +
    `  -2: 매우 부정적 (주가 하락 가능성 높음)\n\n` +
    `종목명: ${corpName}\n` +
    `공시명: ${reportName}\n\n` +
    `JSON 형식으로만 응답: {"impact": <숫자>, "reason": "<한 문장 근거>"}`;

  try {
    const raw = await callGemini(prompt, 'dart-impact');
    if (!raw) return { impact: 0, reason: '분석 불가' };
    const match = raw.match(/\{[\s\S]*?\}/);
    if (!match) return { impact: 0, reason: '파싱 실패' };
    const parsed = JSON.parse(match[0]) as { impact?: unknown; reason?: unknown };
    const impact = Number(parsed.impact);
    if (![-2, -1, 0, 1, 2].includes(impact)) return { impact: 0, reason: String(parsed.reason ?? '범위 오류') };
    return { impact, reason: String(parsed.reason ?? '') };
  } catch {
    return { impact: 0, reason: 'Gemini 오류' };
  }
}

// ── 공시 유형별 차등 점수 맵 ─────────────────────────────────────────────────
const DART_SCORE_MAP: Record<string, number> = {
  '내부자매수':     4,   // 임원 대규모 취득
  '내부자소규모':  2,   // 소규모 취득
  '무상증자':       3,
  '유상증자':      -1,   // 희석 우려
  '자사주취득':    3,
  '자사주소각':    4,
  '실적서프라이즈': 3,
  '일반호재':        1,
};

/**
 * Phase 4-⑤: 내부자 매수 가산점 조건 분기.
 *
 *  - 임원 직접 매수 (reportNm 에 '임원' 포함)          → 4점 (고신뢰 고확신 신호)
 *  - 대주주/외부인 매수 또는 소규모 지분 변경         → 2점 (일반 확인 신호)
 *
 * 기존 일률 +4 는 수급량 ≥ 0.5% 또는 임원 직접 매수 기준을 충족하지 않는 사례에도
 * 동일한 가중치를 부여해 recommendationTracker 가 내부자 매수 신호의 실효를
 * 과대평가하는 편향을 만들었다. 이 함수는 reportNm 기반 휴리스틱으로 구분한다.
 */
export function computeInsiderBuyScore(reportNm: string): number {
  // '임원' 이 들어간 보고서는 임원·주요주주 특정증권 소유상황 보고서 — 직접 매수 가능성 높음
  const isExecutiveReport = reportNm.includes('임원');
  // 대주주 변동 (0.5% 이상 대량 변동 — 구체 파싱은 향후 확장) 가정 키워드
  const hasBulkChange = reportNm.includes('대량') || reportNm.includes('취득') && reportNm.includes('장내');
  if (isExecutiveReport || hasBulkChange) return 4;
  return 2;
}

/**
 * 공시 제목에서 DART_SCORE_MAP 키를 매칭하여 점수를 반환.
 * 매칭 안 되면 insiderBuy=true이면 computeInsiderBuyScore, impact 기반 기본값 반환.
 */
function getDartScore(reportNm: string, insiderBuy: boolean, impact: number): number {
  for (const [key, score] of Object.entries(DART_SCORE_MAP)) {
    if (reportNm.includes(key)) return score;
  }
  // Phase 4-⑤: 내부자 매수는 reportNm 기반으로 +4/+2 차등 (기존 일률 +4 폐지)
  if (insiderBuy) return computeInsiderBuyScore(reportNm);
  // LLM 임팩트 기반 기본값
  if (impact >= 2) return 3;
  if (impact >= 1) return 1;
  if (impact <= -1) return impact; // 부정 점수 전달
  return 0;
}

// ── 공시 이벤트 해시 기반 중복 방지 (종목코드 + 공시일 + 공시유형 + 보고인) ────
// 동일 공시가 다른 rceptNo로 중복 접수되거나, 같은 건에 대해
// 보고인만 다른 경우 점수가 중복 누적되는 문제 방지
const _processedDartHashes = new Set<string>();
const _DART_HASH_TTL_MS    = 24 * 60 * 60 * 1000; // 24시간

function makeDartHash(code: string, date: string, type: string, reporter: string): string {
  return `${code}_${date}_${type}_${reporter}`;
}

function isDartHashProcessed(hash: string): boolean {
  return _processedDartHashes.has(hash);
}

function markDartHash(hash: string): void {
  _processedDartHashes.add(hash);
  setTimeout(() => _processedDartHashes.delete(hash), _DART_HASH_TTL_MS);
}

// ── DART 공시 → 워치리스트 연동 (방향 1+3 전략) ──────────────────────────────
// 방향 3: 내부자 매수 → 유일하게 즉시 워치리스트 신규 추가 허용 (룰 기반 고신뢰 신호)
// 방향 1: 일반 호재 (+1/+2) → 기존 워치리스트 종목 강화 전용 (gateScore 보너스 + Track B 승격)
//         워치리스트에 없는 종목은 추가하지 않음 — 공시 후 급등 가격에 진입하는 문제 방지
// 악재 공시 (-1/-2): 워치리스트에 있으면 즉시 제거, 포지션이 있으면 exitEngine 경보
// 안전장치: DART 추가 종목은 expiresAt=3일, addedBy='DART' 표시
/** DART 추가 종목 기본 만료 기간 (밀리초) — 3일 */
const DART_WATCHLIST_EXPIRY_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * DART 보너스 누적 후 gateScore 상한.
 * 악재 제거/품질 경쟁을 거친 종목이라도 무한정 점수가 쌓이면 품질 경쟁이 고장난다.
 * 동일 공시가 rceptNo/해시 dedupe을 우회해 들어오더라도 최대값 이상으로 부풀지 않도록 제한.
 */
const DART_GATE_SCORE_CAP = 8.0;

// ── rceptNo 기반 gateScore 적용 중복 방지 ──────────────────────────────────────
// fastDartCheck()와 pollDartDisclosures()가 별도 dedup 메커니즘을 사용하므로,
// 같은 공시가 양쪽에서 applyDartToWatchlist()를 호출할 수 있다.
// rceptNo를 키로 이미 gateScore 보너스를 적용한 공시를 추적한다.
const _appliedRceptNos     = new Set<string>();
const _APPLIED_TTL_MS      = 24 * 60 * 60 * 1000; // 24시간 (당일 공시 전체 커버)

function markRceptNoApplied(rceptNo: string): void {
  _appliedRceptNos.add(rceptNo);
  setTimeout(() => _appliedRceptNos.delete(rceptNo), _APPLIED_TTL_MS);
}

export async function applyDartToWatchlist(params: {
  stockCode: string;
  corpName: string;
  impact: number;        // -2 ~ +2 (Gemini 판정 또는 룰 기반)
  insiderBuy: boolean;
  reason: string;
  rceptNo: string;
  reportNm?: string;     // 공시 제목 — 차등 점수 산정용
  filingDate?: string;   // 공시일 (YYYYMMDD) — 이벤트 해시 dedup용
  reporter?: string;     // 보고인 — 이벤트 해시 dedup용
}): Promise<void> {
  const code = params.stockCode.padStart(6, '0');
  if (!code || code === '000000') return;

  // ── 동일 공시 중복 적용 방지 (rceptNo 기준) ─────────────────────────────────
  // fastDartCheck()와 pollDartDisclosures() 양쪽에서 호출될 수 있으므로
  // rceptNo 기준으로 이미 처리된 공시는 스킵한다.
  if (_appliedRceptNos.has(params.rceptNo)) {
    console.log(`[DART→WL] ⏭️ 중복 스킵: ${params.corpName}(${code}) — rceptNo ${params.rceptNo} 이미 적용됨`);
    return;
  }

  // ── 이벤트 해시 기반 중복 방지 (종목코드 + 공시일 + 공시유형 + 보고인) ────────
  // 같은 날 같은 건에 대해 보고인만 다른 공시가 들어와도 점수 중복 누적 방지
  if (params.filingDate && params.reportNm) {
    const dartHash = makeDartHash(code, params.filingDate, params.reportNm, params.reporter ?? '');
    if (isDartHashProcessed(dartHash)) {
      console.log(`[DART→WL] ⏭️ 해시 중복 스킵: ${params.corpName}(${code}) — ${dartHash}`);
      return;
    }
    markDartHash(dartHash);
  }

  markRceptNoApplied(params.rceptNo);

  const watchlist = loadWatchlist();
  const existing = watchlist.find(w => w.code === code);

  // ── 악재 공시 (-1/-2) ──────────────────────────────────────────────────────
  if (params.impact < 0) {
    // 워치리스트에 있으면 즉시 제거
    if (existing) {
      const updated = watchlist.filter(w => w.code !== code);
      saveWatchlist(updated);
      console.log(`[DART→WL] ❌ 악재 제거: ${params.corpName}(${code}) — ${params.reason}`);
      await sendTelegramAlert(
        `⚠️ <b>[DART 악재 → 워치리스트 제거]</b> ${escapeHtml(params.corpName)} (${escapeHtml(code)})\n` +
        `공시 임팩트: ${params.impact} — ${escapeHtml(params.reason)}\n` +
        `워치리스트에서 즉시 제거됨`,
        dartTelegramOpts(params.rceptNo, 'neg_remove'),
      ).catch(console.error);
    }

    // 포지션이 있으면 exitEngine 경보
    const shadows = loadShadowTrades();
    const activePosition = shadows.find(
      s => s.stockCode === code && isOpenShadowStatus(s.status),
    );
    if (activePosition) {
      console.log(`[DART→WL] 🚨 악재 경보: ${params.corpName}(${code}) — 활성 포지션 보유 중`);
      await sendTelegramAlert(
        `🚨 <b>[DART 악재 경보 — 포지션 보유 중!]</b> ${escapeHtml(params.corpName)} (${escapeHtml(code)})\n` +
        `공시 임팩트: ${params.impact} — ${escapeHtml(params.reason)}\n` +
        `보유 수량: ${activePosition.quantity}주 @${activePosition.shadowEntryPrice.toLocaleString()}원\n` +
        `⚡ <b>손절선 점검 필요</b>\n` +
        `DART: https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${params.rceptNo}`,
        { ...dartTelegramOpts(params.rceptNo, 'neg_position'), priority: 'HIGH' },
      ).catch(console.error);
    }
    return;
  }

  // ── 호재 공시 (+1/+2) 또는 내부자 매수 ─────────────────────────────────────
  const isPositive = params.impact > 0 || params.insiderBuy;
  if (!isPositive) return; // impact=0이면서 insiderBuy도 아니면 무시

  if (existing) {
    // ── 방향 1: 기존 워치리스트 종목 강화 (확인 신호) ──────────────────────────
    // Pre-Breakout이나 Gate로 이미 워치리스트에 있는 종목에 호재 공시가 겹치면
    // gateScore 보너스 + Track B 강제 승격 → 진짜 강한 신호
    const bonus = getDartScore(params.reportNm ?? '', params.insiderBuy, params.impact);
    const prevScore = existing.gateScore ?? 0;
    existing.gateScore = Math.min(prevScore + bonus, DART_GATE_SCORE_CAP);
    // 내부자 매수 → CATALYST 섹션, 일반 호재 → SWING 승격
    existing.section = params.insiderBuy ? 'CATALYST' : 'SWING';
    existing.track = 'B';
    existing.isFocus = true;
    existing.memo = `${existing.memo ?? ''} | DART(${params.insiderBuy ? '내부자매수' : `+${params.impact}`}): ${params.reason}`.trim();
    saveWatchlist(watchlist);
    console.log(
      `[DART→WL] ⬆️ 확인신호 강화: ${params.corpName}(${code}) → ${existing.section} (gateScore +${bonus}, 합계 ${existing.gateScore})`,
    );
    await sendTelegramAlert(
      `📊 <b>[DART 확인신호 → 기존 종목 강화]</b> ${escapeHtml(params.corpName)} (${escapeHtml(code)})\n` +
      `${params.insiderBuy ? '🕵️ 내부자 매수 감지' : `임팩트: +${params.impact}`} — ${escapeHtml(params.reason)}\n` +
      `gateScore: +${bonus} (합계 ${existing.gateScore}) | ${existing.section} 승격\n` +
      `전략: 기존 워치리스트 종목에 호재 공시 겹침 → 강한 매수 신호`,
      dartTelegramOpts(params.rceptNo, 'confirm'),
    ).catch(console.error);
  } else if (params.insiderBuy) {
    // ── 방향 3: 내부자 매수만 즉시 신규 추가 (고신뢰 룰 기반 신호) ──────────────
    // 임원/대주주 장내매수는 Gemini 판단과 달리 오류가 없는 룰 기반 신호.
    // 이 경우에만 워치리스트에 새로 추가한다.
    let entryPrice = 0;
    let stopLoss = 0;
    let targetPrice = 0;

    try {
      const price = await fetchCurrentPrice(code);
      if (price && price > 0) {
        entryPrice = price;
        stopLoss = Math.round(price * 0.92);
        targetPrice = Math.round(price * 1.20);
      }
    } catch { /* 시세 조회 실패 — 다음 스캔에서 채움 */ }

    const expiresAt = new Date(Date.now() + DART_WATCHLIST_EXPIRY_MS).toISOString();
    const newEntry: WatchlistEntry = {
      code,
      name: params.corpName,
      entryPrice,
      stopLoss,
      targetPrice,
      addedAt: new Date().toISOString(),
      addedBy: 'DART',
      section: 'CATALYST',
      track: 'B',
      isFocus: true,
      expiresAt,
      memo: `DART(내부자매수): ${params.reason}`,
      gateScore: 3,
      rrr: entryPrice > 0 ? parseFloat(((targetPrice - entryPrice) / (entryPrice - stopLoss || 1)).toFixed(2)) : 0,
    };
    // CATALYST 만석 시 품질 경쟁: 기존 최저 gateScore 종목을 밀어냄
    // 1차 — gateScore 경쟁; 2차 — 데이터 빈곤 종목 우선 교체 (DART 확신도 점수 1.0 기준).
    const catalystCount = watchlist.filter(w => w.section === 'CATALYST').length;
    if (catalystCount >= CATALYST_MAX_SIZE) {
      const evicted = tryEvictWeakest(watchlist, newEntry.gateScore ?? 0, 'CATALYST');
      if (!evicted) {
        // DART 내부자매수 이벤트는 실측 완성도 1.0 — 기존 데이터 빈곤 종목과 비교
        const evictedStarved = tryEvictMostDataStarved(
          watchlist,
          1.0,
          getStockCompletenessScore,
          'CATALYST',
          0.3,
        );
        if (!evictedStarved) {
          console.log(`[DART→WL] ⏭️ CATALYST 만석 + 기존 종목이 더 우수 → ${params.corpName}(${code}) 추가 불가`);
          return;
        }
        console.log(
          `[DART→WL] ♻️ 데이터빈곤 교체: ${evictedStarved.name}(${evictedStarved.code}) ` +
          `→ ${params.corpName}(${code}) 대체 (DART 실증 신호 우선)`,
        );
      }
    }
    watchlist.push(newEntry);
    saveWatchlist(watchlist);
    console.log(
      `[DART→WL] ✅ 내부자매수 추가: ${params.corpName}(${code}) [CATALYST] (만료: 3일)`,
    );
    await sendTelegramAlert(
      `🕵️ <b>[내부자 매수 → 워치리스트 추가]</b> ${escapeHtml(params.corpName)} (${escapeHtml(code)})\n` +
      `${escapeHtml(params.reason)}\n` +
      `섹션: CATALYST (고신뢰 룰 기반 신호) | 만료: 3일\n` +
      (entryPrice > 0 ? `진입가: ${entryPrice.toLocaleString()}원 | 손절: ${stopLoss.toLocaleString()}원 | 목표: ${targetPrice.toLocaleString()}원\n` : '⚠️ 시세 미조회 — 다음 스캔에서 갱신 예정\n') +
      `DART: https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${params.rceptNo}`,
      dartTelegramOpts(params.rceptNo, 'insider_add'),
    ).catch(console.error);
  } else {
    // ── 일반 호재 (+1/+2) but 워치리스트에 없음 → 추가하지 않음 ────────────────
    // 비워치리스트 참고용 알림은 Telegram 스팸 유발 → debug 로그로만 남기고 발송하지 않는다.
    // Pre-Breakout 스캔이 이 종목을 먼저 발견하면 그때 워치리스트에 들어오고,
    // 이후 공시가 나오면 방향 1(확인 신호)로 강화되어 정식 알림이 발송된다.
    console.log(
      `[DART→WL] ⏭️ 스킵(무알림): ${params.corpName}(${code}) — 일반 호재(+${params.impact}) 워치리스트 미등록 | ${params.reason}`,
    );
  }
}

// Phase 5-⑩: 이메일 기반 DART 알림 제거 — Telegram 워치리스트 감성 알림으로 대체됨(상단 코드 경로).
async function sendDartAlert(_alert: DartAlert): Promise<void> {
  // no-op: 이메일 채널 폐쇄. DART MAJOR_POSITIVE + 워치리스트 조합은
  // dartTelegramOpts('watchlist_sentiment') 경로에서 이미 발송 중.
}

/**
 * 아이디어 6: DART 공시 폴링 (LLM 임팩트 분류 업그레이드)
 * - 30분마다 신규 공시 수집
 * - Gemini로 5단계 임팩트 분류 (-2~+2)
 * - 내부자 매수 감지 → 별도 Telegram 알림
 * - MAJOR_POSITIVE + 워치리스트 종목 → 이메일 + Telegram 알림
 */
export async function pollDartDisclosures(): Promise<void> {
  if (!process.env.DART_API_KEY) {
    console.warn('[DART] DART_API_KEY 미설정 — 건너뜀');
    return;
  }

  const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const url = `https://opendart.fss.or.kr/api/list.json` +
    `?crtfc_key=${process.env.DART_API_KEY}&bgn_de=${today}&sort=date&sort_mth=desc&page_no=1&page_count=40`;

  let disclosures: Record<string, string>[] = [];
  try {
    const res = await fetch(url);
    const data = await res.json() as { status: string; list?: Record<string, string>[] };
    if (data.status !== '000' || !data.list) return;
    disclosures = data.list;
  } catch (e: unknown) {
    console.error('[DART] 공시 조회 실패:', e instanceof Error ? e.message : e);
    return;
  }

  const existing = loadDartAlerts();
  const existingNos = new Set(existing.map((a) => a.rcept_no));
  const watchlist = loadWatchlist();
  const watchCodes = new Set(watchlist.map((w) => w.code.padStart(6, '0')));
  const llmState = loadDartLlmState();

  const newAlerts: DartAlert[] = [];

  for (const d of disclosures) {
    if (existingNos.has(d.rcept_no)) continue; // 이미 처리됨

    const reportNm   = d.report_nm ?? '';
    const corpName   = d.corp_name ?? '';
    const sentiment  = classifyDisclosure(reportNm);
    const insiderBuy = detectInsiderBuy(reportNm);
    const stockCode  = (d.stock_code ?? '').padStart(6, '0');
    const isWatchlist = watchCodes.has(stockCode);

    // ── 지분 공시 → LLM 대신 룰 기반 수급 분석 ──────────────────────────────
    let llmImpact: number | undefined;
    let llmReason: string | undefined;
    let ownershipSignal: DartAlert['ownershipSignal'];

    if (isOwnershipDisclosure(reportNm)) {
      ownershipSignal = await analyzeOwnershipChange(corpName, reportNm);
    } else {
      // LLM 임팩트 분류 — 워치리스트 종목 또는 고영향 공시만 실행 (비용 절감)
      const shouldClassify = isWatchlist ||
        FAST_DART_KEYWORDS.some(kw => reportNm.includes(kw)) ||
        insiderBuy;

      if (shouldClassify && process.env.GEMINI_API_KEY) {
        const classified = await classifyImpactWithLlm(corpName, reportNm)
          .catch(() => ({ impact: 0, reason: '오류' }));
        llmImpact = classified.impact;
        llmReason = classified.reason;
      }
    }

    const alert: DartAlert = {
      corp_name:  corpName,
      stock_code: d.stock_code ?? '',
      report_nm:  reportNm,
      rcept_dt:   d.rcept_dt   ?? today,
      rcept_no:   d.rcept_no   ?? '',
      sentiment,
      alertedAt:  new Date().toISOString(),
      llmImpact,
      llmReason,
      insiderBuy,
      ownershipSignal,
    };
    newAlerts.push(alert);

    // ── 지분 공시 수급 이벤트 알림 (긍정/부정만) ────────────────────────────
    if (ownershipSignal && ownershipSignal.sentiment !== 'NEUTRAL') {
      const emoji = ownershipSignal.sentiment === 'POSITIVE' ? '📈' : '📉';
      await sendTelegramAlert(
        `${emoji} <b>[수급 이벤트] ${escapeHtml(alert.corp_name)}</b>\n` +
        `${escapeHtml(alert.report_nm)}\n` +
        `접수일: ${alert.rcept_dt}\n` +
        (isWatchlist ? `⭐ <b>워치리스트 종목!</b>\n` : '') +
        `수급: ${escapeHtml(ownershipSignal.reason)}\n` +
        `DART: https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${alert.rcept_no}`,
        dartTelegramOpts(alert.rcept_no, 'ownership'),
      ).catch(console.error);
      console.log(`[DART] ${emoji} 수급이벤트: ${alert.corp_name} (${ownershipSignal.sentiment}) — ${alert.report_nm}`);
    }

    // ── 내부자 매수 → 즉시 특별 Telegram 알림 ─────────────────────────────
    // 지분 공시로 이미 수급 이벤트 알림을 보낸 경우(POSITIVE/NEGATIVE)에는 중복 발송하지 않는다.
    if (insiderBuy && (!ownershipSignal || ownershipSignal.sentiment === 'NEUTRAL')) {
      await sendTelegramAlert(
        `🕵️ <b>[내부자 매수 감지] ${escapeHtml(alert.corp_name)}</b>\n` +
        `${escapeHtml(alert.report_nm)}\n` +
        `접수일: ${alert.rcept_dt}\n` +
        (isWatchlist ? `⭐ <b>워치리스트 종목!</b>\n` : '') +
        (llmImpact !== undefined ? `LLM 임팩트: ${llmImpact > 0 ? '+' : ''}${llmImpact} — ${escapeHtml(llmReason ?? '')}\n` : '') +
        `DART: https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${alert.rcept_no}`,
        dartTelegramOpts(alert.rcept_no, 'insider_poll'),
      ).catch(console.error);
      console.log(`[DART] 🕵️ 내부자 매수: ${alert.corp_name} — ${alert.report_nm}`);
    }

    // ── 부정(-2/-1) 공시 → 악재 소화 추적 등록 ──────────────────────────────
    if (llmImpact !== undefined && llmImpact < 0 && stockCode) {
      llmState.negativeAlerts[stockCode] = {
        rceptNo: d.rcept_no ?? '',
        alertedAt: new Date().toISOString(),
      };
    }

    // ── 워치리스트 + MAJOR_POSITIVE → 이메일 + Telegram ──────────────────────
    if (sentiment === 'MAJOR_POSITIVE' && isWatchlist) {
      await sendDartAlert(alert).catch(console.error);
    }
    // NEGATIVE 공시도 Telegram 즉시 경고
    if ((sentiment === 'NEGATIVE' || sentiment === 'MAJOR_POSITIVE') && isWatchlist) {
      const emoji = sentiment === 'MAJOR_POSITIVE' ? '📢' : '⚠️';
      const impactLine = llmImpact !== undefined
        ? `LLM 임팩트: ${llmImpact > 0 ? '+' : ''}${llmImpact} — ${escapeHtml(llmReason ?? '')}\n`
        : '';
      await sendTelegramAlert(
        `${emoji} <b>[DART 공시] ${escapeHtml(alert.corp_name)}</b>\n` +
        `${escapeHtml(alert.report_nm)}\n` +
        `접수일: ${alert.rcept_dt}\n` +
        `감성: ${sentiment}\n` +
        impactLine +
        `DART: https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${alert.rcept_no}`,
        dartTelegramOpts(alert.rcept_no, 'watchlist_sentiment'),
      ).catch(console.error);
    }

    // ── DART 공시 → 워치리스트 자동 연동 ──────────────────────────────────────
    const effectiveImpact = llmImpact
      ?? (ownershipSignal?.sentiment === 'POSITIVE' ? 1 : ownershipSignal?.sentiment === 'NEGATIVE' ? -1 : 0);
    if (effectiveImpact !== 0 || insiderBuy) {
      await applyDartToWatchlist({
        stockCode,
        corpName,
        impact: effectiveImpact,
        insiderBuy,
        reason: llmReason ?? ownershipSignal?.reason ?? reportNm,
        rceptNo: d.rcept_no ?? '',
        reportNm,
        filingDate: d.rcept_dt ?? today,
        reporter: d.flr_nm ?? '',
      }).catch(e => console.error(`[DART→WL] 워치리스트 연동 실패:`, e));
    }
  }

  saveDartLlmState(llmState);

  if (newAlerts.length > 0) {
    saveDartAlerts([...existing, ...newAlerts]);
    console.log(`[DART] 신규 공시 ${newAlerts.length}건 수집`);
  }
}

/**
 * 악재 소화 완료 감지 — 부정 공시(-2/-1) 후 주가가 실제로 하락하지 않은 종목 처리.
 * 공시 후 약 30분 시점 현재가(currentPrice)를 받아 악재 소화 여부를 판단한다.
 *
 * @param stockCode   종목코드 (6자리 패딩)
 * @param currentPrice 현재가
 * @param priceAtAlert 공시 직후 가격 (없으면 저장된 값 사용)
 */
export async function checkBadNewsAbsorbed(
  stockCode: string,
  currentPrice: number,
  priceAtAlert?: number,
): Promise<boolean> {
  const state = loadDartLlmState();
  const entry = state.negativeAlerts[stockCode];
  if (!entry) return false;

  const basePrice = priceAtAlert ?? entry.priceAtAlert;
  if (!basePrice) {
    // 최초 가격 기록
    entry.priceAtAlert = currentPrice;
    saveDartLlmState(state);
    return false;
  }

  // 부정 공시 후 주가가 오히려 0% 이상 유지 → 악재 소화 완료
  const changePct = ((currentPrice - basePrice) / basePrice) * 100;
  if (changePct >= 0) {
    // 악재 소화 완료 알림
    const existing = loadDartAlerts();
    const alertEntry = existing.find(a => a.rcept_no === entry.rceptNo);
    if (alertEntry && !alertEntry.badNewsAbsorbed) {
      alertEntry.badNewsAbsorbed = true;
      saveDartAlerts(existing);
      await sendTelegramAlert(
        `🔄 <b>[악재 소화 완료] ${escapeHtml(alertEntry.corp_name)}</b>\n` +
        `공시: ${escapeHtml(alertEntry.report_nm)}\n` +
        `LLM 임팩트: ${alertEntry.llmImpact} → 주가 미하락 (+${changePct.toFixed(1)}%)\n` +
        `⚡ <b>진입 후보 등록 — 악재 선반영 완료 신호</b>\n` +
        `DART: https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${entry.rceptNo}`,
        dartTelegramOpts(entry.rceptNo, 'absorbed'),
      ).catch(console.error);
      console.log(`[DART] 🔄 악재 소화 완료: ${alertEntry.corp_name} (+${changePct.toFixed(1)}%)`);
    }
    // 추적 완료 → 상태에서 제거
    delete state.negativeAlerts[stockCode];
    saveDartLlmState(state);
    return true;
  }

  return false;
}

/**
 * 아이디어 11: 1분 간격 DART 고속 폴링 (LLM 임팩트 분류 통합)
 * - 오늘자 공시 목록에서 고영향 키워드 감지
 * - 워치리스트 종목 매칭 → Gemini 5단계 임팩트 판단 → Telegram 즉시 알림
 * - 내부자 매수 패턴 자동 감지 → 별도 알림
 * - googleSearch 없음 (DART API 직접 호출 + Gemini 판단)
 */
export async function fastDartCheck(): Promise<void> {
  if (!process.env.DART_API_KEY) return;

  // 주말(토·일) 및 장외 시간(KST 08:00 미만 또는 16:30 초과)은 스킵 — 불필요한 API 소모 방지
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const dow = kst.getUTCDay();
  const kstT = kst.getUTCHours() * 100 + kst.getUTCMinutes();
  if (dow === 0 || dow === 6) return;
  if (kstT < 800 || kstT > 1630) return;

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const url = `https://opendart.fss.or.kr/api/list.json` +
    `?crtfc_key=${process.env.DART_API_KEY}` +
    `&bgn_de=${today}&end_de=${today}` +
    `&sort=rcp_dt&sort_mth=desc&page_count=20`;

  let disclosures: Record<string, string>[] = [];
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const data = await res.json() as { status: string; list?: Record<string, string>[] };
    if (data.status !== '000' || !data.list) return;
    disclosures = data.list;
  } catch {
    return; // 타임아웃/네트워크 오류는 조용히 무시 (1분마다 재시도)
  }

  const seen       = loadFastSeenNos();
  const watchlist  = loadWatchlist();
  const watchCodes = new Set(watchlist.map(w => w.code.padStart(6, '0')));
  let changed      = false;

  // ── 1단계: seen·processedIds 필터링 → 배치 대상 수집 ──────────────────────
  type Candidate = {
    rceptNo: string; corpName: string; reportNm: string;
    stockCode: string; isWatchlist: boolean; insiderBuy: boolean;
    isOwnership: boolean; filingDate: string; reporter: string;
  };
  const toAnalyze: Candidate[] = [];

  for (const d of disclosures) {
    const rceptNo   = d.rcept_no  ?? '';
    const corpName  = d.corp_name ?? '';
    const reportNm  = d.report_nm ?? '';
    const stockCode = (d.stock_code ?? '').padStart(6, '0');
    const filingDate = d.rcept_dt ?? today;
    const reporter   = d.flr_nm  ?? '';

    if (seen.has(rceptNo)) continue;
    seen.add(rceptNo);
    changed = true;

    const isOwnership  = isOwnershipDisclosure(reportNm);
    const isHighImpact = FAST_DART_KEYWORDS.some(kw => reportNm.includes(kw));
    const insiderBuy   = detectInsiderBuy(reportNm);

    // 지분 공시는 워치리스트 종목에 한해서만 룰 기반 수급 분석을 실행한다.
    // 비워치리스트 지분 공시는 대부분 단순 보유 현황 보고로 주가 영향이 미미하므로 제외.
    // 일반 공시 → 고영향 키워드 OR 내부자 매수 OR 워치리스트 종목만 분석 대상
    const shouldInclude = isOwnership
      ? watchCodes.has(stockCode)
      : (isHighImpact || insiderBuy || watchCodes.has(stockCode));
    if (!shouldInclude) continue;

    const id = `${rceptNo}_${stockCode}`;
    if (_processedIds.has(id)) continue; // 4시간 내 이미 처리됨 → 스킵
    markProcessed(id);

    toAnalyze.push({
      rceptNo, corpName, reportNm,
      stockCode, isWatchlist: watchCodes.has(stockCode), insiderBuy,
      isOwnership, filingDate, reporter,
    });
  }

  if (changed) saveFastSeenNos(seen);

  if (toAnalyze.length === 0) return;

  // ── 2a단계: 지분 공시 → 룰 기반 수급 분석 (LLM 불필요) ─────────────────────
  const ownershipCandidates = toAnalyze.filter(c => c.isOwnership);
  for (const c of ownershipCandidates) {
    const ownershipSignal = await analyzeOwnershipChange(c.corpName, c.reportNm);
    if (ownershipSignal.sentiment !== 'NEUTRAL') {
      const emoji = ownershipSignal.sentiment === 'POSITIVE' ? '📈' : '📉';
      await sendTelegramAlert(
        `${emoji} <b>[수급 이벤트] ${escapeHtml(c.corpName)}</b>\n` +
        `${escapeHtml(c.reportNm)}\n` +
        (c.isWatchlist ? `⭐ <b>워치리스트 종목!</b>\n` : '') +
        `수급: ${escapeHtml(ownershipSignal.reason)}\n` +
        `DART: https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${c.rceptNo}`,
        dartTelegramOpts(c.rceptNo, 'ownership_fast'),
      ).catch(console.error);
      console.log(`[FastDART] ${emoji} 수급이벤트: ${c.corpName} (${ownershipSignal.sentiment}) — ${c.reportNm}`);

      // DART 공시 → 워치리스트 연동
      const ownerImpact = ownershipSignal.sentiment === 'POSITIVE' ? 1 : -1;
      await applyDartToWatchlist({
        stockCode: c.stockCode,
        corpName: c.corpName,
        impact: ownerImpact,
        insiderBuy: c.insiderBuy,
        reason: ownershipSignal.reason,
        rceptNo: c.rceptNo,
        reportNm: c.reportNm,
        filingDate: c.filingDate,
        reporter: c.reporter,
      }).catch(e => console.error(`[FastDART→WL] 워치리스트 연동 실패:`, e));
    }
  }

  // ── 2b단계: 일반 공시 → 배치 Gemini 5단계 임팩트 분류 (N개 → 1회 호출) ────
  const llmCandidates = toAnalyze.filter(c => !c.isOwnership);

  if (llmCandidates.length === 0) {
    if (ownershipCandidates.length > 0) {
      console.log(`[FastDART] 수급 분석: ${ownershipCandidates.length}건 (LLM 없음)`);
    }
    return;
  }

  const batchLines = llmCandidates.map((c, i) =>
    `${i}. [${c.corpName}] ${c.reportNm}` +
    ` (워치리스트:${c.isWatchlist ? '예' : '아니오'}, 내부자매수:${c.insiderBuy ? '예' : '아니오'})`
  ).join('\n');

  const batchPrompt =
    `한국 주식 공시 목록의 단기 주가 임팩트를 5단계(-2/-1/0/+1/+2)로 분류하라.\n` +
    `분류 기준: -2=매우부정, -1=부정, 0=중립, +1=긍정, +2=매우긍정\n` +
    `각 항목의 임팩트 숫자와 이유 한 문장을 JSON 배열로 응답하라.\n` +
    `형식: [{"i":0,"impact":<숫자>,"r":"이유"}, ...]\n\n` +
    `공시 목록:\n${batchLines}`;

  interface BatchItem { i: number; impact: number; r: string }
  let batchResults: BatchItem[] = [];
  try {
    const raw = await callGemini(batchPrompt, 'dart-fast');
    if (raw) {
      const match = raw.match(/\[[\s\S]*?\]/);
      if (match) batchResults = JSON.parse(match[0]) as BatchItem[];
    }
  } catch { /* Gemini 실패 시 빈 결과 — 아래 루프에서 기본값 처리 */ }

  const llmState = loadDartLlmState();
  let llmStateChanged = false;

  // ── 3단계: 결과 처리 + Telegram 알림 ─────────────────────────────────────
  for (let i = 0; i < llmCandidates.length; i++) {
    const c       = llmCandidates[i];
    const result  = batchResults.find(r => r.i === i);
    const impact  = result?.impact ?? 0;
    const reason  = result?.r ?? '분석 불가';
    const impactClamp = Math.max(-2, Math.min(2, impact));

    // 내부자 매수 → 즉시 특별 알림
    if (c.insiderBuy) {
      await sendTelegramAlert(
        `🕵️ <b>[내부자 매수 감지] ${escapeHtml(c.corpName)}</b>\n` +
        `${escapeHtml(c.reportNm)}\n` +
        (c.isWatchlist ? `⭐ <b>워치리스트 종목!</b>\n` : '') +
        `임팩트: ${impactClamp > 0 ? '+' : ''}${impactClamp} — ${escapeHtml(reason)}\n` +
        `DART: https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${c.rceptNo}`,
        dartTelegramOpts(c.rceptNo, 'insider_fast'),
      ).catch(console.error);
      console.log(`[FastDART] 🕵️ 내부자매수: ${c.corpName} — ${c.reportNm}`);
    }

    // 부정 공시 → 악재 소화 추적 등록
    if (impactClamp < 0 && c.stockCode) {
      llmState.negativeAlerts[c.stockCode] = {
        rceptNo: c.rceptNo,
        alertedAt: new Date().toISOString(),
      };
      llmStateChanged = true;
    }

    // 긍정(+1/+2) 또는 워치리스트 → 알림
    const isPositive = impactClamp >= 1;
    if (isPositive || c.isWatchlist) {
      const emoji = impactClamp >= 2 ? '🚀' : impactClamp >= 1 ? '📈' : '📢';
      await sendTelegramAlert(
        `${emoji} <b>[DART 인텔리전스] ${escapeHtml(c.corpName)}</b>\n` +
        `${escapeHtml(c.reportNm)}\n` +
        (c.isWatchlist ? `⭐ <b>워치리스트 종목!</b>\n` : '') +
        `임팩트: ${impactClamp > 0 ? '+' : ''}${impactClamp} — ${escapeHtml(reason)}\n` +
        `DART: https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${c.rceptNo}`,
        dartTelegramOpts(c.rceptNo, 'intel_fast'),
      ).catch(console.error);
      console.log(`[FastDART] ${emoji} ${c.corpName} (임팩트:${impactClamp}) — ${c.reportNm}`);
    }

    // ── DART 공시 → 워치리스트 자동 연동 ──────────────────────────────────────
    if (impactClamp !== 0 || c.insiderBuy) {
      await applyDartToWatchlist({
        stockCode: c.stockCode,
        corpName: c.corpName,
        impact: impactClamp,
        insiderBuy: c.insiderBuy,
        reason,
        rceptNo: c.rceptNo,
        reportNm: c.reportNm,
        filingDate: c.filingDate,
        reporter: c.reporter,
      }).catch(e => console.error(`[FastDART→WL] 워치리스트 연동 실패:`, e));
    }
  }

  if (llmStateChanged) saveDartLlmState(llmState);

  console.log(`[FastDART] 배치 분석: ${llmCandidates.length}건 → Gemini 1회 호출`);
}

