import fs from 'fs';
import nodemailer from 'nodemailer';
import { DART_FAST_SEEN_FILE, ensureDataDir } from '../persistence/paths.js';
import { type DartAlert, loadDartAlerts, saveDartAlerts } from '../persistence/dartRepo.js';
import { loadWatchlist } from '../persistence/watchlistRepo.js';
import { callGemini } from '../clients/geminiClient.js';
import { sendTelegramAlert } from './telegramClient.js';

// 고영향 공시 키워드 (가격 이동 유발 가능성 높은 공시 유형)
export const FAST_DART_KEYWORDS = [
  '무상증자', '자사주취득', '자사주소각', '영업이익', '잠정실적',
  '수주', '흑자전환', '분기실적', '연간실적', '대규모수주',
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
    text: `종목코드: ${alert.stock_code}\n공시명: ${alert.report_nm}\n접수일: ${alert.rcept_dt}\n\nDART 바로가기: https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${alert.rcept_no}`,
  });
  console.log(`[DART] 📧 알림 발송: ${alert.corp_name} — ${alert.report_nm}`);
}

/**
 * 아이디어 6: DART 공시 폴링
 * - 30분마다 신규 공시 수집
 * - MAJOR_POSITIVE + 워치리스트 종목 → 이메일 알림
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

  const newAlerts: DartAlert[] = [];

  for (const d of disclosures) {
    if (existingNos.has(d.rcept_no)) continue; // 이미 처리됨

    const sentiment = classifyDisclosure(d.report_nm ?? '');
    const alert: DartAlert = {
      corp_name:  d.corp_name  ?? '',
      stock_code: d.stock_code ?? '',
      report_nm:  d.report_nm  ?? '',
      rcept_dt:   d.rcept_dt   ?? today,
      rcept_no:   d.rcept_no   ?? '',
      sentiment,
      alertedAt:  new Date().toISOString(),
    };
    newAlerts.push(alert);

    // 워치리스트 종목 + MAJOR_POSITIVE → 이메일 + Telegram 알림
    if (sentiment === 'MAJOR_POSITIVE' && watchCodes.has(d.stock_code?.padStart(6, '0') ?? '')) {
      await sendDartAlert(alert).catch(console.error);
    }
    // NEGATIVE 공시도 Telegram으로 즉시 경고
    if ((sentiment === 'NEGATIVE' || sentiment === 'MAJOR_POSITIVE') &&
        watchCodes.has(d.stock_code?.padStart(6, '0') ?? '')) {
      const emoji = sentiment === 'MAJOR_POSITIVE' ? '📢' : '⚠️';
      await sendTelegramAlert(
        `${emoji} <b>[DART 공시] ${alert.corp_name}</b>\n` +
        `${alert.report_nm}\n` +
        `접수일: ${alert.rcept_dt}\n` +
        `감성: ${sentiment}\n` +
        `DART: https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${alert.rcept_no}`
      ).catch(console.error);
    }
  }

  if (newAlerts.length > 0) {
    saveDartAlerts([...existing, ...newAlerts]);
    console.log(`[DART] 신규 공시 ${newAlerts.length}건 수집`);
  }
}

/**
 * 아이디어 11: 1분 간격 DART 고속 폴링
 * - 오늘자 공시 목록에서 고영향 키워드 감지
 * - 워치리스트 종목 매칭 → Gemini 매수 관련성 판단 → Telegram 즉시 알림
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

  const seen    = loadFastSeenNos();
  const watchlist = loadWatchlist();
  const watchCodes = new Set(watchlist.map(w => w.code.padStart(6, '0')));
  let changed = false;

  for (const d of disclosures) {
    const rceptNo  = d.rcept_no  ?? '';
    const corpName = d.corp_name ?? '';
    const reportNm = d.report_nm ?? '';
    const stockCode = (d.stock_code ?? '').padStart(6, '0');

    if (seen.has(rceptNo)) continue;
    seen.add(rceptNo);
    changed = true;

    // 고영향 키워드 체크
    const isHighImpact = FAST_DART_KEYWORDS.some(kw => reportNm.includes(kw));
    if (!isHighImpact) continue;

    const isWatchlistStock = watchCodes.has(stockCode);

    // Gemini로 매수 관련성 판단 (워치리스트 종목이거나 키워드 매칭 시)
    const geminiPrompt = [
      '한국 주식 공시 내용을 보고 단기 매수 관련성을 "긍정", "부정", "중립" 중 하나와 이유 한 문장으로만 답하세요.',
      `공시: ${reportNm}`,
      `법인명: ${corpName}`,
      `워치리스트 종목: ${isWatchlistStock ? '예' : '아니오'}`,
    ].join('\n');

    const judgment = await callGemini(geminiPrompt).catch(() => null);
    const isPositive = judgment?.includes('긍정') ?? false;

    // 긍정 판단이거나 워치리스트 종목이면 Telegram 즉시 알림
    if (isPositive || isWatchlistStock) {
      const emoji = isPositive ? '🚀' : '📢';
      await sendTelegramAlert(
        `${emoji} <b>[DART 즉시 반응] ${corpName}</b>\n` +
        `${reportNm}\n` +
        (isWatchlistStock ? `⭐ <b>워치리스트 종목!</b>\n` : '') +
        `판단: ${judgment ?? '분석 불가'}\n` +
        `DART: https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${rceptNo}`
      ).catch(console.error);

      console.log(`[FastDART] ${emoji} ${corpName} — ${reportNm} (watch=${isWatchlistStock})`);
    }
  }

  if (changed) saveFastSeenNos(seen);
}
