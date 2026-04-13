import fs from 'fs';
import nodemailer from 'nodemailer';
import { DART_FAST_SEEN_FILE, DART_LLM_STATE_FILE, ensureDataDir } from '../persistence/paths.js';
import { type DartAlert, loadDartAlerts, saveDartAlerts } from '../persistence/dartRepo.js';
import { loadWatchlist } from '../persistence/watchlistRepo.js';
import { callGemini } from '../clients/geminiClient.js';
import { sendTelegramAlert } from './telegramClient.js';

// ── 인메모리 중복 방지 캐시 (서버 재시작 시 초기화 — 의도적) ─────────────────
// 파일 기반 seen Set(DART_FAST_SEEN_FILE)에 더해 메모리 캐시로 중복 Gemini 호출을 차단.
// 4시간 TTL: 당일 재반복 공시 방어 + 메모리 누수 방지.
const _processedIds     = new Set<string>();
const _PROCESSED_TTL_MS = 4 * 60 * 60 * 1000; // 4시간

function markProcessed(id: string): void {
  _processedIds.add(id);
  setTimeout(() => _processedIds.delete(id), _PROCESSED_TTL_MS);
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

async function sendDartAlert(alert: DartAlert): Promise<void> {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return;
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });
  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: process.env.REPORT_EMAIL ?? process.env.EMAIL_USER,
    subject: `📢 [QuantMaster] 공시 알림: ${alert.corp_name} — ${alert.report_nm}`,
    text: `종목코드: ${alert.stock_code}\n공시명: ${alert.report_nm}\n접수일: ${alert.rcept_dt}\n` +
      `LLM 임팩트: ${alert.llmImpact ?? 'N/A'} (${alert.llmReason ?? ''})\n\n` +
      `DART 바로가기: https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${alert.rcept_no}`,
  });
  console.log(`[DART] 📧 알림 발송: ${alert.corp_name} — ${alert.report_nm}`);
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
        `${emoji} <b>[수급 이벤트] ${alert.corp_name}</b>\n` +
        `${alert.report_nm}\n` +
        `접수일: ${alert.rcept_dt}\n` +
        (isWatchlist ? `⭐ <b>워치리스트 종목!</b>\n` : '') +
        `수급: ${ownershipSignal.reason}\n` +
        `DART: https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${alert.rcept_no}`
      ).catch(console.error);
      console.log(`[DART] ${emoji} 수급이벤트: ${alert.corp_name} (${ownershipSignal.sentiment}) — ${alert.report_nm}`);
    }

    // ── 내부자 매수 → 즉시 특별 Telegram 알림 ─────────────────────────────
    if (insiderBuy && !ownershipSignal) {
      await sendTelegramAlert(
        `🕵️ <b>[내부자 매수 감지] ${alert.corp_name}</b>\n` +
        `${alert.report_nm}\n` +
        `접수일: ${alert.rcept_dt}\n` +
        (isWatchlist ? `⭐ <b>워치리스트 종목!</b>\n` : '') +
        (llmImpact !== undefined ? `LLM 임팩트: ${llmImpact > 0 ? '+' : ''}${llmImpact} — ${llmReason}\n` : '') +
        `DART: https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${alert.rcept_no}`
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
        ? `LLM 임팩트: ${llmImpact > 0 ? '+' : ''}${llmImpact} — ${llmReason}\n`
        : '';
      await sendTelegramAlert(
        `${emoji} <b>[DART 공시] ${alert.corp_name}</b>\n` +
        `${alert.report_nm}\n` +
        `접수일: ${alert.rcept_dt}\n` +
        `감성: ${sentiment}\n` +
        impactLine +
        `DART: https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${alert.rcept_no}`
      ).catch(console.error);
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
        `🔄 <b>[악재 소화 완료] ${alertEntry.corp_name}</b>\n` +
        `공시: ${alertEntry.report_nm}\n` +
        `LLM 임팩트: ${alertEntry.llmImpact} → 주가 미하락 (+${changePct.toFixed(1)}%)\n` +
        `⚡ <b>진입 후보 등록 — 악재 선반영 완료 신호</b>\n` +
        `DART: https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${entry.rceptNo}`
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
    isOwnership: boolean;
  };
  const toAnalyze: Candidate[] = [];

  for (const d of disclosures) {
    const rceptNo   = d.rcept_no  ?? '';
    const corpName  = d.corp_name ?? '';
    const reportNm  = d.report_nm ?? '';
    const stockCode = (d.stock_code ?? '').padStart(6, '0');

    if (seen.has(rceptNo)) continue;
    seen.add(rceptNo);
    changed = true;

    const isOwnership  = isOwnershipDisclosure(reportNm);
    const isHighImpact = FAST_DART_KEYWORDS.some(kw => reportNm.includes(kw));
    const insiderBuy   = detectInsiderBuy(reportNm);

    // 지분 공시 → 워치리스트 종목만 룰 기반 수급 분석 대상으로 포함
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
      isOwnership,
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
        `${emoji} <b>[수급 이벤트] ${c.corpName}</b>\n` +
        `${c.reportNm}\n` +
        (c.isWatchlist ? `⭐ <b>워치리스트 종목!</b>\n` : '') +
        `수급: ${ownershipSignal.reason}\n` +
        `DART: https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${c.rceptNo}`
      ).catch(console.error);
      console.log(`[FastDART] ${emoji} 수급이벤트: ${c.corpName} (${ownershipSignal.sentiment}) — ${c.reportNm}`);
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
        `🕵️ <b>[내부자 매수 감지] ${c.corpName}</b>\n` +
        `${c.reportNm}\n` +
        (c.isWatchlist ? `⭐ <b>워치리스트 종목!</b>\n` : '') +
        `임팩트: ${impactClamp > 0 ? '+' : ''}${impactClamp} — ${reason}\n` +
        `DART: https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${c.rceptNo}`
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
        `${emoji} <b>[DART 인텔리전스] ${c.corpName}</b>\n` +
        `${c.reportNm}\n` +
        (c.isWatchlist ? `⭐ <b>워치리스트 종목!</b>\n` : '') +
        `임팩트: ${impactClamp > 0 ? '+' : ''}${impactClamp} — ${reason}\n` +
        `DART: https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${c.rceptNo}`
      ).catch(console.error);
      console.log(`[FastDART] ${emoji} ${c.corpName} (임팩트:${impactClamp}) — ${c.reportNm}`);
    }
  }

  if (llmStateChanged) saveDartLlmState(llmState);

  console.log(`[FastDART] 배치 분석: ${llmCandidates.length}건 → Gemini 1회 호출`);
}

