/**
 * sectorSources.ts — KRX 섹터맵 갱신용 대체 데이터 소스 체인
 *
 * @responsibility KRX 정보데이터시스템이 장애(HTTP 400/500·타임아웃)일 때
 * 섹터 분류를 보전하기 위한 4단계 폴백 체인을 제공한다. 원본(KRX)·준원본(Naver)·
 * 보조(Yahoo)·최후의 수단(Gemini) 각각의 수집 + 빌더와, 이를 순서대로 시도해
 * 최대 커버리지를 확보하는 오케스트레이터(buildSectorMapWithFallback)를 노출한다.
 *
 * 설계 원칙:
 *   1. "원자적 쓰기"와 "기존 파일 보존"은 상위(sectorMapUpdater)가 담당한다.
 *      이 모듈은 "가능한 최대 커버리지의 맵을 반환"한 가지 책임만.
 *   2. 실패 격리 — 각 소스는 throw 해도 오케스트레이터가 다음 소스로 넘어간다.
 *   3. 비용 관리 — Yahoo는 동시성/타임아웃 제한, Gemini는 월 예산 회로차단기 준수.
 *   4. 영업일 역산 — KRX가 "오늘 trdDd"로 400을 반환하면 최근 영업일 최대 5일까지 역추적.
 *   5. Naver 는 인증 없이 업종별 HTML 을 스크레이핑하므로 KRX API 키 발급 전
 *      공백 기간에 한국어 네이티브 분류를 무료로 공급한다.
 *
 * 폴백 우선순위:
 *   ① KRX 벌크 스냅샷 (MDCSTAT03901) — 전종목 한 번에 수집 (인증 필요 시 400)
 *   ② Naver Finance 업종별 HTML 스크레이프 (인증 불필요, 한글 섹터 원문)
 *   ③ Yahoo Finance 개별 종목 assetProfile (영문 섹터 → 한글 매핑)
 *   ④ Gemini 배치 분류 (prefetchedContext 전달, 검색 금지) — 최후
 */

import fs from 'fs';
import { SECTOR_MAP as MANUAL_OVERRIDES } from './pipelineHelpers.js';
import { callGeminiInterpret, isBudgetBlocked } from '../clients/geminiClient.js';
import { guardedFetch } from '../utils/egressGuard.js';

// ── 공통 타입 ────────────────────────────────────────────────────────────────

export interface SectorSourceResult {
  /** 6자리 코드 → 한글 섹터명 맵 */
  map: Record<string, string>;
  /** 소스 라벨 (통합 meta 기록용) */
  source: 'KRX' | 'Naver' | 'Yahoo' | 'Gemini' | 'none';
  /** 진단용: 각 소스별 수집량·오류 */
  diagnostics: string[];
}

// ── 영문 섹터(Yahoo Finance) → 프로젝트 표준 한글 섹터 매핑 ──────────────────
// Yahoo Finance 는 GICS 계열 영문 섹터·산업을 반환한다. 프로젝트의 LEADING_SECTORS
// 및 SECTOR_ALIASES와 충돌하지 않는 상위 섹터 레벨로 축약 매핑한다.
const YAHOO_SECTOR_KO: Record<string, string> = {
  Technology:             'IT서비스',
  'Communication Services':'통신',
  'Consumer Cyclical':    '유통',
  'Consumer Defensive':   '식품',
  'Financial Services':   '금융',
  Healthcare:             '바이오',
  Industrials:            '기계',
  'Basic Materials':      '소재',
  Energy:                 '에너지',
  Utilities:              '유틸리티',
  'Real Estate':          '건설',
};
const YAHOO_INDUSTRY_KO: Record<string, string> = {
  Semiconductors:                      '반도체',
  'Semiconductor Equipment & Materials':'반도체장비',
  'Auto Manufacturers':                '자동차',
  'Auto Parts':                        '자동차부품',
  'Drug Manufacturers - General':      '제약',
  'Biotechnology':                     '바이오',
  'Aerospace & Defense':               '방산',
  'Shipping & Ports':                  '해운',
  'Electrical Equipment & Parts':      '전력기기',
  'Uranium':                           '원자력',
};

function mapYahooToKorean(sector?: string, industry?: string): string | null {
  // industry가 더 구체적이므로 우선 매칭. 실패 시 sector 레벨로 fallback.
  if (industry && YAHOO_INDUSTRY_KO[industry]) return YAHOO_INDUSTRY_KO[industry];
  if (sector && YAHOO_SECTOR_KO[sector])       return YAHOO_SECTOR_KO[sector];
  return null;
}

// ── ② Naver Finance 업종별 스크레이프 ───────────────────────────────────────
// Naver Finance 는 인증 없이 업종별 종목 목록을 HTML 로 제공한다.
// 인덱스 페이지(type=upjong)에서 업종 링크(no=N) 목록을 얻고, 각 업종 상세에서
// 종목코드를 추출한다. HTML 은 EUC-KR 이므로 TextDecoder 로 직접 디코드한다.

const NAVER_SECTOR_TIMEOUT_MS = 8_000;
const NAVER_SECTOR_CONCURRENCY = 4;
const NAVER_SECTOR_INDEX_URL  = 'https://finance.naver.com/sise/sise_group.naver?type=upjong';
const NAVER_SECTOR_DETAIL_URL = 'https://finance.naver.com/sise/sise_group_detail.naver';
const NAVER_MAX_INDUSTRIES    = Number(process.env.SECTOR_FALLBACK_NAVER_MAX ?? '200');

/**
 * Naver 원문 업종명 → 프로젝트 표준 섹터명.
 * 특정성(specificity) 우선 — "반도체장비" 가 "반도체" 보다 먼저 매칭되도록 순서 유지.
 * 매칭 실패 시 null 반환 — 결과 맵에서 제외되어 '미분류'로 낙하.
 */
export function mapNaverIndustryToKorean(rawIndustry: string): string | null {
  const s = rawIndustry.replace(/\s+/g, '');
  if (!s) return null;
  if (s.includes('반도체장비'))                        return '반도체장비';
  if (s.includes('반도체소재'))                        return '반도체소재';
  if (s.includes('반도체'))                            return '반도체';
  if (s.includes('2차전지') || s.includes('이차전지')) return '2차전지';
  if (s.includes('자동차부품'))                        return '자동차부품';
  if (s.includes('자동차'))                            return '자동차';
  if (s.includes('조선기자재'))                        return '조선기자재';
  if (s.includes('조선'))                              return '조선';
  if (s.includes('방위') || s.includes('방산'))        return '방산';
  if (s.includes('원자력'))                            return '원자력';
  if (s.includes('제약'))                              return '제약';
  if (s.includes('생명공학') || s.includes('바이오'))  return '바이오';
  if (s.includes('건강관리') || s.includes('헬스케어'))return '헬스케어';
  if (s.includes('전력기기') || s.includes('전기장비'))return '전력기기';
  if (s.includes('유틸리티') || s.includes('전기가스'))return '유틸리티';
  if (s.includes('신재생') || s.includes('태양광') || s.includes('풍력')) return '신재생에너지';
  if (s.includes('석유') || s.includes('가스') || s.includes('에너지'))   return '에너지';
  if (s.includes('화장품'))                            return '화장품';
  if (s.includes('화학'))                              return '화학';
  if (s.includes('철강'))                              return '철강';
  if (s.includes('비철금속') || s.includes('광업'))    return '금속';
  if (s.includes('건설'))                              return '건설';
  if (s.includes('기계'))                              return '기계';
  if (s.includes('로봇'))                              return '로봇';
  if (s.includes('가전'))                              return '가전';
  if (s.includes('전자부품'))                          return '전자부품';
  if (s.includes('통신장비'))                          return '전자부품';
  if (s.includes('통신'))                              return '통신';
  if (s.includes('소프트웨어') || s.includes('인터넷') || s.includes('IT서비스')) return 'IT서비스';
  if (s.includes('은행') || s.includes('증권') || s.includes('금융')) return '금융';
  if (s.includes('보험'))                              return '보험';
  if (s.includes('식료') || s.includes('음식료') || s.includes('식품')) return '식품';
  if (s.includes('의류') || s.includes('섬유'))        return '의류';
  if (s.includes('생활용품') || s.includes('가정용품'))return '생활용품';
  if (s.includes('백화점') || s.includes('유통') || s.includes('소매')) return '유통';
  if (s.includes('엔터') || s.includes('미디어'))      return '엔터테인먼트';
  if (s.includes('해상운송') || s.includes('해운'))    return '해운';
  if (s.includes('항공'))                              return '항공';
  if (s.includes('운송') || s.includes('물류'))        return '운송';
  if (s.includes('의료미용'))                          return '의료미용';
  if (s.includes('소재'))                              return '소재';
  return null;
}

async function fetchNaverPage(url: string): Promise<string | null> {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), NAVER_SECTOR_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; QuantmasterPro/1.0)' },
      signal:  ctrl.signal,
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    // Naver Finance 는 EUC-KR. Node 의 TextDecoder 는 ICU 로 EUC-KR 을 지원.
    return new TextDecoder('euc-kr').decode(buf);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface NaverIndustryLink {
  no:   string;
  name: string;
}

/** 인덱스 페이지에서 업종별 상세 링크와 한글 업종명을 추출. */
export function parseNaverIndustryIndex(html: string): NaverIndustryLink[] {
  const out: NaverIndustryLink[] = [];
  const seen = new Set<string>();
  // href="/sise/sise_group_detail.naver?type=upjong&amp;no=278" ... >반도체와반도체장비</a>
  const re = /sise_group_detail\.naver\?type=upjong&(?:amp;)?no=(\d+)[^>]*>\s*([^<]+?)\s*</g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const no   = m[1];
    const name = m[2].trim();
    if (!no || !name || seen.has(no)) continue;
    seen.add(no);
    out.push({ no, name });
  }
  return out;
}

/** 업종 상세 페이지에서 6자리 종목코드 집합을 추출. */
export function parseNaverIndustryDetail(html: string): string[] {
  const codes = new Set<string>();
  const re = /\/item\/main\.naver\?code=(\d{6})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) codes.add(m[1]);
  return Array.from(codes);
}

/**
 * Naver Finance 업종별 HTML 을 스크레이프해 6자리 코드 → 표준 섹터맵을 빌드한다.
 * - codes: 관심 유니버스. 스크레이프는 전체 업종을 돌지만 반환 맵은 이 집합 교집합만.
 * - 타임아웃 NAVER_SECTOR_TIMEOUT_MS, 업종 병렬도 NAVER_SECTOR_CONCURRENCY.
 * - 매핑 실패(허용 섹터 테이블에 없음) 종목은 결과에서 제외 → '미분류'로 낙하.
 */
export async function fetchFromNaver(
  codes: string[],
  verbose = false,
): Promise<SectorSourceResult> {
  const diagnostics: string[] = [];
  const wanted = new Set(codes.filter((c) => /^\d{6}$/.test(c)));
  if (wanted.size === 0) {
    return { map: {}, source: 'Naver', diagnostics: ['Naver: 조회 대상 코드 0개 — 스킵'] };
  }

  const indexHtml = await fetchNaverPage(NAVER_SECTOR_INDEX_URL);
  if (!indexHtml) {
    return { map: {}, source: 'Naver', diagnostics: ['Naver: 인덱스 페이지 실패 — 스킵'] };
  }
  const industries = parseNaverIndustryIndex(indexHtml).slice(0, NAVER_MAX_INDUSTRIES);
  if (industries.length === 0) {
    return { map: {}, source: 'Naver', diagnostics: ['Naver: 업종 링크 0개 — 스킵'] };
  }
  if (verbose) console.log(`[SectorSources/Naver] 업종 ${industries.length}개 스크레이프 시작 (concurrency=${NAVER_SECTOR_CONCURRENCY})`);

  const map: Record<string, string> = {};
  let okIndustries = 0, failIndustries = 0, mappedIndustries = 0;

  let idx = 0;
  async function worker(): Promise<void> {
    while (idx < industries.length) {
      const my = idx++;
      const { no, name } = industries[my];
      const sector = mapNaverIndustryToKorean(name);
      if (!sector) {
        // 매핑 불가 업종은 상세 조회 자체를 스킵 — 네트워크 낭비 방지.
        failIndustries++;
        continue;
      }
      const detailHtml = await fetchNaverPage(`${NAVER_SECTOR_DETAIL_URL}?type=upjong&no=${no}`);
      if (!detailHtml) { failIndustries++; continue; }
      const stockCodes = parseNaverIndustryDetail(detailHtml);
      if (stockCodes.length === 0) { failIndustries++; continue; }
      mappedIndustries++;
      okIndustries++;
      for (const code of stockCodes) {
        if (!wanted.has(code)) continue;
        // 먼저 선점된 업종이 우선 — 인덱스가 더 상위(상장시장·대분류)라는 가정.
        if (!map[code]) map[code] = sector;
      }
    }
  }
  await Promise.all(Array.from({ length: NAVER_SECTOR_CONCURRENCY }, () => worker()));

  diagnostics.push(
    `Naver: industries=${industries.length} mapped=${mappedIndustries} ok=${okIndustries} ` +
    `fail=${failIndustries} classified=${Object.keys(map).length}/${wanted.size}`,
  );
  if (verbose) console.log(`[SectorSources/Naver] ${diagnostics[diagnostics.length - 1]}`);
  return { map, source: 'Naver', diagnostics };
}

// ── ③ Yahoo Finance 소스 ────────────────────────────────────────────────────

const YAHOO_TIMEOUT_MS    = 4_000;
const YAHOO_CONCURRENCY   = 6;
const YAHOO_MAX_CODES     = Number(process.env.SECTOR_FALLBACK_YAHOO_MAX ?? '400');

interface YahooAssetProfile {
  sector?:   string;
  industry?: string;
}

async function fetchYahooSector(code: string): Promise<{ sector: string | null; rawSector?: string; rawIndustry?: string }> {
  // KRX 6자리 → Yahoo 심볼. KOSDAQ 는 .KQ, KOSPI 는 .KS — 사전에 시장을 모르는 경우
  // .KS 를 우선 시도하고 404 시 .KQ 로 재시도.
  const suffixes = ['.KS', '.KQ'] as const;
  for (const suf of suffixes) {
    const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${code}${suf}?modules=assetProfile`;
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), YAHOO_TIMEOUT_MS);
    try {
      const res = await guardedFetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; QuantmasterPro/1.0)' },
        signal:  ctrl.signal,
      });
      if (!res.ok) continue;
      const json = await res.json() as {
        quoteSummary?: { result?: Array<{ assetProfile?: YahooAssetProfile }> };
      };
      const profile = json.quoteSummary?.result?.[0]?.assetProfile;
      if (!profile) continue;
      const mapped = mapYahooToKorean(profile.sector, profile.industry);
      return { sector: mapped, rawSector: profile.sector, rawIndustry: profile.industry };
    } catch {
      // 타임아웃·네트워크 오류 — 다음 접미어 시도
    } finally {
      clearTimeout(timer);
    }
  }
  return { sector: null };
}

/**
 * Yahoo Finance 개별 종목 assetProfile 로 섹터를 채운다.
 * - codes: 조회 대상 코드 집합(보통 기존 파일·수동 오버라이드의 union).
 * - 최대 동시성 YAHOO_CONCURRENCY, 개별 요청 타임아웃 YAHOO_TIMEOUT_MS.
 * - Yahoo 영문 섹터 매핑에 실패한 종목은 결과에서 제외 — '미분류' 로 낙하.
 */
export async function fetchFromYahoo(
  codes: string[],
  verbose = false,
): Promise<SectorSourceResult> {
  const diagnostics: string[] = [];
  const uniqCodes = Array.from(new Set(codes.filter((c) => /^\d{6}$/.test(c)))).slice(0, YAHOO_MAX_CODES);
  if (uniqCodes.length === 0) {
    return { map: {}, source: 'Yahoo', diagnostics: ['Yahoo: 조회 대상 코드 0개 — 스킵'] };
  }
  if (verbose) console.log(`[SectorSources/Yahoo] ${uniqCodes.length}개 조회 시작 (concurrency=${YAHOO_CONCURRENCY})`);

  const map: Record<string, string> = {};
  let ok = 0, fail = 0;

  // 간단한 세마포어 — Promise.all 에 한꺼번에 풀지 않고 소폭 병렬화.
  let idx = 0;
  async function worker(): Promise<void> {
    while (idx < uniqCodes.length) {
      const my = idx++;
      const code = uniqCodes[my];
      const { sector } = await fetchYahooSector(code);
      if (sector) { map[code] = sector; ok++; } else { fail++; }
    }
  }
  await Promise.all(Array.from({ length: YAHOO_CONCURRENCY }, () => worker()));

  diagnostics.push(`Yahoo: ok=${ok} fail=${fail} coverage=${uniqCodes.length}`);
  if (verbose) console.log(`[SectorSources/Yahoo] ${diagnostics[diagnostics.length - 1]}`);
  return { map, source: 'Yahoo', diagnostics };
}

// ── ④ Gemini 배치 분류 소스 ─────────────────────────────────────────────────

const GEMINI_BATCH_SIZE    = 50;
const GEMINI_MAX_BATCHES   = Number(process.env.SECTOR_FALLBACK_GEMINI_MAX_BATCHES ?? '4');
// 프로젝트 표준 섹터명 — 프롬프트에서 강제 선택지로 사용.
const ALLOWED_SECTORS = [
  '반도체', '반도체소재', '반도체장비', 'AI반도체',
  '2차전지', '2차전지소재', '바이오', '제약', '헬스케어', '바이오AI',
  '자동차', '자동차부품', '조선', '조선엔진', '조선기자재', '방산', '방산부품',
  '원자력', '원자력부품', '전력기기', '에너지', '신재생에너지', '건설기계',
  'IT서비스', '핀테크', 'AI', '로봇', '가전', '전자부품', '통신',
  '화학', '소재', '철강', '금속', '금융', '보험', '유통', '식품',
  '화장품', '생활용품', '의류', '운송', '해운', '항공', '건설', '기계',
  '유틸리티', '엔터테인먼트', '의료미용',
];

function parseGeminiBatchResponse(text: string): Record<string, string> {
  // 허용 포맷: "005930:반도체" · "005930 반도체" · "005930 - 반도체"
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(\d{5,6})\s*[:\-·\s]\s*([가-힣A-Za-z0-9]+)\s*$/);
    if (!m) continue;
    const code   = m[1].padStart(6, '0');
    const sector = m[2].trim();
    if (!ALLOWED_SECTORS.includes(sector)) continue;
    out[code] = sector;
  }
  return out;
}

/**
 * Gemini 배치 분류 — 코드+이름을 묶어 섹터를 추론한다.
 * - 외부 검색/URL 접근 없음(callGeminiInterpret 의 PREAMBLE 이 이미 차단).
 * - 월 예산 HARD_BLOCK 상태면 즉시 빈 결과 반환.
 */
export async function fetchFromGemini(
  entries: Array<{ code: string; name: string }>,
  verbose = false,
): Promise<SectorSourceResult> {
  const diagnostics: string[] = [];
  if (isBudgetBlocked()) {
    return { map: {}, source: 'Gemini', diagnostics: ['Gemini: 월 예산 HARD_BLOCK — 호출 스킵'] };
  }
  const filtered = entries.filter((e) => /^\d{6}$/.test(e.code) && e.name);
  if (filtered.length === 0) {
    return { map: {}, source: 'Gemini', diagnostics: ['Gemini: 조회 대상 0개 — 스킵'] };
  }

  const batches: Array<typeof filtered> = [];
  for (let i = 0; i < filtered.length && batches.length < GEMINI_MAX_BATCHES; i += GEMINI_BATCH_SIZE) {
    batches.push(filtered.slice(i, i + GEMINI_BATCH_SIZE));
  }

  const map: Record<string, string> = {};
  let batchOk = 0, batchFail = 0;
  const sectorsList = ALLOWED_SECTORS.join(', ');

  for (const batch of batches) {
    const context =
      '다음은 한국 상장 종목의 (종목코드, 한글종목명) 목록이다.\n' +
      batch.map((e) => `${e.code} ${e.name}`).join('\n');
    const instruction =
      `각 종목을 아래 섹터 중 정확히 하나로 분류해라.\n` +
      `섹터 선택지: ${sectorsList}\n` +
      `- 반드시 "<6자리코드>:<섹터>" 형식으로 줄바꿈하여 응답하라.\n` +
      `- 확신이 없는 종목은 응답에서 제외한다 (추측 금지).\n` +
      `- 추가 설명·서론·맺음말 없이 코드:섹터 라인만 출력한다.`;

    const txt = await callGeminiInterpret(context, instruction, 'sector-fallback');
    if (!txt) { batchFail++; continue; }
    const parsed = parseGeminiBatchResponse(txt);
    const added = Object.keys(parsed).length;
    if (added === 0) { batchFail++; continue; }
    Object.assign(map, parsed);
    batchOk++;
  }

  diagnostics.push(
    `Gemini: batches=${batches.length} ok=${batchOk} fail=${batchFail} ` +
    `classified=${Object.keys(map).length}/${filtered.length}`,
  );
  if (verbose) console.log(`[SectorSources/Gemini] ${diagnostics[diagnostics.length - 1]}`);
  return { map, source: 'Gemini', diagnostics };
}

// ── 오케스트레이터 ───────────────────────────────────────────────────────────

export interface FallbackBuildResult {
  map:         Record<string, string>;
  source:      'KRX' | 'Naver' | 'Yahoo' | 'Gemini' | 'carry-over';
  /** KRX+Naver+Yahoo+Gemini 등 조합형 라벨 — 메타데이터 기록용 */
  sourceLabel: string;
  diagnostics: string[];
}

/**
 * KRX → Naver → Yahoo → Gemini 순으로 폴백을 시도해 최대 커버리지 맵을 산출한다.
 *
 * @param krxAttempt   KRX 벌크 스냅샷을 시도하는 콜백. 성공 시 {map, diagnostics} 반환.
 *                     실패 시 throw 또는 null. sectorMapUpdater.ts 의 KRX 빌더를 주입.
 * @param existingMap  현재 디스크의 krx-sector-map.json 내용 (신규 설치 시 {}).
 * @param targetCodes  Naver/Yahoo/Gemini 후보 유니버스 — 보통 existingMap 키 + MANUAL_OVERRIDES 키의 합집합.
 * @param targetNamesByCode  Gemini 프롬프트에 전달할 종목명 — 없으면 Gemini 스킵.
 * @param minTotalRows 벌크 성공 기준치 (KRX는 1500+, 폴백 합산은 느슨하게).
 * @param verbose      디버그 로그.
 */
export async function buildSectorMapWithFallback(opts: {
  krxAttempt:         () => Promise<{ map: Record<string, string>; diagnostic: string } | null>;
  existingMap:        Record<string, string>;
  targetCodes:        string[];
  targetNamesByCode?: Record<string, string>;
  minTotalRows:       number;
  verbose?:           boolean;
}): Promise<FallbackBuildResult> {
  const { krxAttempt, existingMap, targetCodes, targetNamesByCode = {}, minTotalRows, verbose = false } = opts;
  const diagnostics: string[] = [];

  // ── ① KRX 벌크 ────────────────────────────────────────────────────────────
  try {
    const krx = await krxAttempt();
    if (krx) {
      diagnostics.push(krx.diagnostic);
      if (Object.keys(krx.map).length >= minTotalRows) {
        return {
          map:         krx.map,
          source:      'KRX',
          sourceLabel: 'KRX',
          diagnostics,
        };
      }
      diagnostics.push(`KRX: 응답 ${Object.keys(krx.map).length}행 < 임계치 ${minTotalRows} — 폴백 단계로 전환`);
    } else {
      diagnostics.push('KRX: null 반환 — 폴백 단계로 전환');
    }
  } catch (e) {
    /* SDS-ignore: 진단 누적 패턴 — diagnostics.push 가 호출자에게 반환되어 폴백 단계 진행 */
    diagnostics.push(`KRX: 실패 — ${e instanceof Error ? e.message : String(e)} → 폴백 단계로 전환`);
  }

  // ── 공통: 기존 파일 + 수동 오버라이드를 기반선(baseline) 으로 채택 ───────
  // 폴백 단계는 "신선도 회복"이 아니라 "무너지지 않도록 보존"이 목표.
  // 기존 파일에서 커버되는 종목은 그대로 유지하고, 부족분만 Naver/Yahoo/Gemini 로 보충.
  const merged: Record<string, string> = { ...existingMap };
  // 수동 오버라이드는 sectorMap.ts 조회 우선순위에서 최상위라 디스크엔 기록할 필요 없지만,
  // 최종 맵의 커버리지 판단을 위해 합산한다.
  for (const [c, s] of Object.entries(MANUAL_OVERRIDES)) merged[c] = s;

  // Naver/Yahoo/Gemini 에서 보충할 "미커버" 코드 — 기존 맵에 없는 targetCodes 만.
  const missing = targetCodes.filter((c) => !merged[c]);
  diagnostics.push(`baseline: existing=${Object.keys(existingMap).length} manual=${Object.keys(MANUAL_OVERRIDES).length} missing=${missing.length}`);

  // ── ② Naver ──────────────────────────────────────────────────────────────
  // 인증 불필요·벌크 스크레이프라 KRX 장애 시 첫 번째로 시도. 업종별 한글 원문을
  // 프로젝트 표준 섹터로 매핑해 반환하며, 매핑 실패 종목은 다음 단계로 낙하.
  let usedNaver = false;
  if (missing.length > 0) {
    const nr = await fetchFromNaver(missing, verbose).catch((e) => ({
      map: {}, source: 'Naver' as const, diagnostics: [`Naver: catch ${e instanceof Error ? e.message : String(e)}`],
    }));
    diagnostics.push(...nr.diagnostics);
    Object.assign(merged, nr.map);
    usedNaver = Object.keys(nr.map).length > 0;
  }

  // ── ③ Yahoo ──────────────────────────────────────────────────────────────
  let usedYahoo = false;
  const afterNaverMissing = targetCodes.filter((c) => !merged[c]);
  if (afterNaverMissing.length > 0) {
    const yr = await fetchFromYahoo(afterNaverMissing, verbose).catch((e) => ({
      map: {}, source: 'Yahoo' as const, diagnostics: [`Yahoo: catch ${e instanceof Error ? e.message : String(e)}`],
    }));
    diagnostics.push(...yr.diagnostics);
    Object.assign(merged, yr.map);
    usedYahoo = Object.keys(yr.map).length > 0;
  }

  // ── ④ Gemini ─────────────────────────────────────────────────────────────
  let usedGemini = false;
  const stillMissing = targetCodes.filter((c) => !merged[c]);
  if (stillMissing.length > 0 && Object.keys(targetNamesByCode).length > 0) {
    const entries = stillMissing
      .map((c) => ({ code: c, name: targetNamesByCode[c] ?? '' }))
      .filter((e) => !!e.name);
    const gr = await fetchFromGemini(entries, verbose).catch((e) => ({
      map: {}, source: 'Gemini' as const, diagnostics: [`Gemini: catch ${e instanceof Error ? e.message : String(e)}`],
    }));
    diagnostics.push(...gr.diagnostics);
    Object.assign(merged, gr.map);
    usedGemini = Object.keys(gr.map).length > 0;
  }

  // ── 최종 커버리지 판정 ────────────────────────────────────────────────────
  // carry-over 는 "KRX·Naver·Yahoo·Gemini 모두 실패 + merged 가 기존 파일과 동일"인 경우.
  const finalCount      = Object.keys(merged).length;
  const existingCount   = Object.keys(existingMap).length;
  const addedByFallback = finalCount - existingCount - Object.keys(MANUAL_OVERRIDES).filter((c) => !existingMap[c]).length;

  const label = [
    usedNaver  ? 'Naver'  : null,
    usedYahoo  ? 'Yahoo'  : null,
    usedGemini ? 'Gemini' : null,
  ].filter(Boolean).join('+') || 'carry-over';

  // 우선순위 — 실제로 첫 커버리지를 기여한 소스를 대표 source 필드로.
  const primary: FallbackBuildResult['source'] =
    label === 'carry-over' ? 'carry-over' :
    usedNaver              ? 'Naver'      :
    usedYahoo              ? 'Yahoo'      :
                             'Gemini';

  return {
    map:         merged,
    source:      primary,
    sourceLabel: label === 'carry-over' ? 'carry-over' : `KRX-fail→${label} (added=${addedByFallback})`,
    diagnostics,
  };
}

// ── 기존 파일 로딩 유틸 (sectorMapUpdater 가 사용) ───────────────────────────

/**
 * 기존 krx-sector-map.json 을 읽어 반환. 파일 없음/파싱 실패는 {} 로 낙하.
 * sectorMap.ts 의 getSectorByCode 는 캐시 경로를 쓰지만 여기서는 디스크 원본이 필요.
 */
export function loadExistingSectorMap(filePath: string): Record<string, string> {
  try {
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, string>;
  } catch {
    return {};
  }
}

