/**
 * supplyChainAgent.ts — 공급망 역추적 알고리즘
 *
 * 미국 방산·반도체·조선·에너지 대기업의 수주/계약 공시를
 * Gemini Google Search로 실시간 스캔하고, 사전 구축된
 * 글로벌기업 ↔ 한국부품사 공급망 매핑 테이블과 교차해
 * 국내 수혜주를 T+0 당일에 포착한다.
 *
 * 수혜 알림 흐름:
 *   [미국 기업 수주 발표]
 *   → Gemini Search 탐지
 *   → SUPPLY_CHAIN_MAP 교차
 *   → 국내 부품사 Telegram 경보
 *   → NewsSupplyLogger 기록 (T+1·T+3·T+5 추적 시작)
 */

import { callGeminiWithSearch } from '../clients/geminiClient.js';
import { sendTelegramBroadcast } from './telegramClient.js';
import { logNewsSupplyEvent } from '../learning/newsSupplyLogger.js';
import { CHANNEL_SEPARATOR } from './channelFormatter.js';

// ── 공급망 매핑 DB ────────────────────────────────────────────────────────────
// 글로벌 기업 키워드 → 한국 공급망 수혜주
// 영문 키워드는 Gemini 응답의 company 필드와 매칭됨

interface SupplyChainEntry {
  triggers:    string[];  // 미국 기업명 키워드 (대소문자 무관 매칭)
  sector:      string;    // 한국 섹터명
  newsType:    string;    // NewsSupplyRecord.newsType
  koreanNames: string[];  // 한국 종목명
  codes:       string[];  // Yahoo Finance 심볼 (*.KS)
  leadDays:    string;    // 예상 선행 기간
}

const SUPPLY_CHAIN_MAP: SupplyChainEntry[] = [
  // ── 방산 ──────────────────────────────────────────────────────────────────
  {
    triggers:    ['Lockheed Martin', 'Lockheed'],
    sector:      '방산',
    newsType:    '방산수주',
    koreanNames: ['한화에어로스페이스', 'LIG넥스원', '한국항공우주'],
    codes:       ['012450.KS', '079550.KS', '047810.KS'],
    leadDays:    '3~5일',
  },
  {
    triggers:    ['Boeing'],
    sector:      '항공/방산',
    newsType:    '방산수주',
    koreanNames: ['한국항공우주', '퍼스텍', '한화에어로스페이스'],
    codes:       ['047810.KS', '010820.KS', '012450.KS'],
    leadDays:    '3~5일',
  },
  {
    triggers:    ['Raytheon', 'RTX'],
    sector:      '방산',
    newsType:    '방산수주',
    koreanNames: ['LIG넥스원', '한화에어로스페이스', '현대로템'],
    codes:       ['079550.KS', '012450.KS', '064350.KS'],
    leadDays:    '3~5일',
  },
  {
    triggers:    ['Northrop Grumman', 'Northrop'],
    sector:      '방산',
    newsType:    '방산수주',
    koreanNames: ['한화에어로스페이스', 'LIG넥스원'],
    codes:       ['012450.KS', '079550.KS'],
    leadDays:    '3~5일',
  },
  {
    triggers:    ['L3Harris', 'L3 Harris', 'General Dynamics'],
    sector:      '방산/통신',
    newsType:    '방산수주',
    koreanNames: ['한화에어로스페이스', 'LIG넥스원', '한화시스템'],
    codes:       ['012450.KS', '079550.KS', '272210.KS'],
    leadDays:    '2~4일',
  },
  // ── 반도체 ─────────────────────────────────────────────────────────────────
  {
    triggers:    ['NVIDIA', 'Nvidia'],
    sector:      '반도체/HBM',
    newsType:    '반도체수주',
    koreanNames: ['SK하이닉스', '삼성전자', '한미반도체'],
    codes:       ['000660.KS', '005930.KS', '042700.KS'],
    leadDays:    '1~3일',
  },
  {
    triggers:    ['Intel'],
    sector:      '반도체',
    newsType:    '반도체수주',
    koreanNames: ['SK하이닉스', '삼성전자'],
    codes:       ['000660.KS', '005930.KS'],
    leadDays:    '1~3일',
  },
  {
    triggers:    ['AMD', 'Advanced Micro'],
    sector:      '반도체',
    newsType:    '반도체수주',
    koreanNames: ['SK하이닉스', '삼성전자'],
    codes:       ['000660.KS', '005930.KS'],
    leadDays:    '1~3일',
  },
  {
    triggers:    ['Apple'],
    sector:      '반도체/디스플레이',
    newsType:    '반도체수주',
    koreanNames: ['삼성전자', 'LG디스플레이', 'SK하이닉스'],
    codes:       ['005930.KS', '034220.KS', '000660.KS'],
    leadDays:    '1~2일',
  },
  {
    triggers:    ['Microsoft', 'Amazon', 'Google', 'Meta'],
    sector:      '반도체/데이터센터',
    newsType:    '반도체수주',
    koreanNames: ['SK하이닉스', '삼성전자'],
    codes:       ['000660.KS', '005930.KS'],
    leadDays:    '1~3일',
  },
  // ── 조선/에너지 ────────────────────────────────────────────────────────────
  {
    triggers:    ['Shell', 'Royal Dutch Shell'],
    sector:      '조선/LNG',
    newsType:    '조선계약',
    koreanNames: ['삼성중공업', 'HD현대중공업', '한화오션'],
    codes:       ['010140.KS', '329180.KS', '042660.KS'],
    leadDays:    '3~5일',
  },
  {
    triggers:    ['ExxonMobil', 'Exxon'],
    sector:      '조선/에너지',
    newsType:    '조선계약',
    koreanNames: ['삼성중공업', 'HD한국조선해양'],
    codes:       ['010140.KS', '009540.KS'],
    leadDays:    '3~5일',
  },
  {
    triggers:    ['BP', 'British Petroleum'],
    sector:      '조선/에너지',
    newsType:    '조선계약',
    koreanNames: ['삼성중공업', '한화오션'],
    codes:       ['010140.KS', '042660.KS'],
    leadDays:    '3~5일',
  },
  {
    triggers:    ['Qatar', 'QatarEnergy', 'Qatar Energy'],
    sector:      '조선/LNG',
    newsType:    '조선계약',
    koreanNames: ['HD한국조선해양', '삼성중공업', '한화오션'],
    codes:       ['009540.KS', '010140.KS', '042660.KS'],
    leadDays:    '2~4일',
  },
  {
    triggers:    ['TotalEnergies', 'Total', 'Chevron', 'ConocoPhillips'],
    sector:      '조선/LNG',
    newsType:    '조선계약',
    koreanNames: ['삼성중공업', 'HD현대중공업'],
    codes:       ['010140.KS', '329180.KS'],
    leadDays:    '3~5일',
  },
  // ── 자동차 ──────────────────────────────────────────────────────────────────
  {
    triggers:    ['GM', 'General Motors'],
    sector:      '자동차부품',
    newsType:    '자동차수주',
    koreanNames: ['현대모비스', '만도'],
    codes:       ['012330.KS', '204320.KS'],
    leadDays:    '2~4일',
  },
  {
    triggers:    ['Ford'],
    sector:      '자동차부품',
    newsType:    '자동차수주',
    koreanNames: ['현대모비스', '한온시스템'],
    codes:       ['012330.KS', '018880.KS'],
    leadDays:    '2~4일',
  },
  {
    triggers:    ['Volkswagen', 'VW', 'BMW', 'Mercedes'],
    sector:      '자동차부품',
    newsType:    '자동차수주',
    koreanNames: ['현대모비스', '만도', '성우하이텍'],
    codes:       ['012330.KS', '204320.KS', '015750.KS'],
    leadDays:    '2~4일',
  },
];

// ── 공시 탐지 ─────────────────────────────────────────────────────────────────

interface GeminiNewsItem {
  company:      string;
  newsType:     string;
  sector:       string;
  headline:     string;
  amount?:      string;
  significance: 'HIGH' | 'MEDIUM' | 'LOW';
}

/** Gemini JSON 응답에서 뉴스 항목 배열 파싱 */
function parseGeminiNews(text: string): GeminiNewsItem[] {
  // JSON 배열 추출 (마크다운 코드블록 포함 처리)
  const match = text.match(/\[[\s\S]*?\]/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is GeminiNewsItem =>
        typeof item?.company === 'string' && typeof item?.headline === 'string'
    );
  } catch {
    return [];
  }
}

/** 뉴스 항목에 매칭되는 공급망 항목 탐색 */
function matchSupplyChain(news: GeminiNewsItem): SupplyChainEntry | null {
  const companyLower = news.company.toLowerCase();
  for (const entry of SUPPLY_CHAIN_MAP) {
    if (entry.triggers.some(t => companyLower.includes(t.toLowerCase()))) {
      return entry;
    }
  }
  return null;
}

// ── 메인 함수 ─────────────────────────────────────────────────────────────────

/**
 * 공급망 역추적 스캔 실행.
 * globalScanAgent.ts (KST 06:00)에서 호출.
 */
export async function runSupplyChainScan(): Promise<void> {
  console.log('[SupplyChain] 공급망 뉴스 스캔 시작 (Gemini Search)');

  const today = new Date().toLocaleDateString('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  });

  const prompt =
    `오늘 날짜: ${today} (KST)\n` +
    `Google Search로 지난 24시간 이내에 발표된 미국 주요 기업의 수주, 계약, 납품 결정 뉴스를 검색하라.\n` +
    `우선 탐색 기업: Lockheed Martin, Boeing, Raytheon, Northrop Grumman, L3Harris, ` +
    `NVIDIA, Intel, AMD, Apple, Microsoft, Amazon, Google, Meta, ` +
    `Shell, ExxonMobil, BP, QatarEnergy, TotalEnergies, Chevron, ` +
    `GM, Ford, Volkswagen\n\n` +
    `결과를 다음 JSON 배열 형식으로만 출력하라:\n` +
    `[{"company": "회사명(영문)", "newsType": "수주|계약|납품결정", "sector": "방산|반도체|조선|에너지|자동차", ` +
    `"headline": "핵심 내용 (한국어 번역)", "amount": "계약 금액 (없으면 빈 문자열)", ` +
    `"significance": "HIGH|MEDIUM|LOW"}]\n` +
    `뉴스가 없으면 빈 배열 []을 반환하라. JSON 외 텍스트는 출력하지 마라.`;

  const raw = await callGeminiWithSearch(prompt, 'supply-chain').catch(() => null);
  if (!raw) {
    console.warn('[SupplyChain] Gemini Search 응답 없음 — 스킵');
    return;
  }

  const newsItems = parseGeminiNews(raw);
  if (newsItems.length === 0) {
    console.log('[SupplyChain] 오늘 주요 수주 뉴스 없음');
    return;
  }

  console.log(`[SupplyChain] 탐지된 뉴스: ${newsItems.length}건`);

  // 경보 발송 + 기록
  for (const news of newsItems) {
    if (news.significance === 'LOW') continue; // 낮은 중요도 스킵

    const entry = matchSupplyChain(news);
    if (!entry) continue; // 공급망 매핑 없음

    const emoji = news.significance === 'HIGH' ? '🚨' : '🔔';
    const amountLine = news.amount ? `\n💰 계약 규모: ${news.amount}` : '';

    // 수혜 경로 시각화 — "미국 기업 → 한국 수혜주" 각 링크별 1줄
    const pathLines = entry.koreanNames
      .map((n, i) => `  ${news.company} → <b>${n}</b>${entry.codes[i] ? ` (${entry.codes[i].replace(/\.KS$/, '')})` : ''}`)
      .join('\n');

    const isHigh = news.significance === 'HIGH';

    await sendTelegramBroadcast(
      `${emoji} <b>[공급망 수혜 탐지] T+0 선점</b>\n` +
      `${CHANNEL_SEPARATOR}\n` +
      `📡 트리거: ${news.company} ${news.newsType}\n` +
      `${news.headline}${amountLine}\n\n` +
      `🔗 <b>국내 수혜 경로</b>:\n${pathLines}\n\n` +
      `🏭 섹터: ${entry.sector}\n` +
      `⏱️ 예상 선행: ${entry.leadDays} 영업일\n` +
      `📊 신뢰도: ${isHigh ? '●●●●○' : '●●●○○'} (Gemini Search 확인)`,
      {
        priority:  isHigh ? 'HIGH' : 'NORMAL',
        tier:      isHigh ? 'T1_ALARM' : 'T2_REPORT',
        category:  'supply_chain',
        dedupeKey: `supply_chain:${news.company}:${new Date().toISOString().slice(0, 10)}`,
        disableChannelNotification: !isHigh,
      },
    ).catch(console.error);

    // NewsSupplyLogger에 기록 (T+1·T+3·T+5 추적 시작)
    logNewsSupplyEvent({
      newsType:         entry.newsType,
      source:           'SUPPLY_CHAIN',
      sector:           entry.sector,
      koreanStockCodes: entry.codes,
      koreanNames:      entry.koreanNames,
      detectedAt:       new Date().toISOString(),
      newsHeadline:     `${news.company}: ${news.headline}`,
      significance:     news.significance as 'HIGH' | 'MEDIUM' | 'LOW',
    });
  }

  console.log(`[SupplyChain] 완료 — 경보 ${newsItems.filter(n => n.significance !== 'LOW').length}건`);
}
