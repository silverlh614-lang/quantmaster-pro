/**
 * sectorSources.ts — KRX 섹터맵 갱신용 대체 데이터 소스 체인
 *
 * @responsibility KRX 정보데이터시스템이 장애(HTTP 400/500·타임아웃)일 때
 * 섹터 분류를 보전하기 위한 3단계 폴백 체인을 제공한다. 원본(KRX)·보조(Yahoo)·
 * 최후의 수단(Gemini) 3소스 각각의 수집 + 빌더와, 이를 순서대로 시도해
 * 최대 커버리지를 확보하는 오케스트레이터(buildSectorMapWithFallback)를 노출한다.
 *
 * 설계 원칙:
 *   1. "원자적 쓰기"와 "기존 파일 보존"은 상위(sectorMapUpdater)가 담당한다.
 *      이 모듈은 "가능한 최대 커버리지의 맵을 반환"한 가지 책임만.
 *   2. 실패 격리 — 각 소스는 throw 해도 오케스트레이터가 다음 소스로 넘어간다.
 *   3. 비용 관리 — Yahoo는 동시성/타임아웃 제한, Gemini는 월 예산 회로차단기 준수.
 *   4. 영업일 역산 — KRX가 "오늘 trdDd"로 400을 반환하면 최근 영업일 최대 5일까지 역추적.
 *
 * 폴백 우선순위:
 *   ① KRX 벌크 스냅샷 (MDCSTAT03901) — 전종목 한 번에 수집
 *   ② Yahoo Finance 개별 종목 assetProfile (영문 섹터 → 한글 매핑)
 *   ③ Gemini 배치 분류 (prefetchedContext 전달, 검색 금지) — 최후
 */

import fs from 'fs';
import { SECTOR_MAP as MANUAL_OVERRIDES } from './pipelineHelpers.js';
import { callGeminiInterpret, isBudgetBlocked } from '../clients/geminiClient.js';

// ── 공통 타입 ────────────────────────────────────────────────────────────────

export interface SectorSourceResult {
  /** 6자리 코드 → 한글 섹터명 맵 */
  map: Record<string, string>;
  /** 소스 라벨 (통합 meta 기록용) */
  source: 'KRX' | 'Yahoo' | 'Gemini' | 'none';
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

// ── ② Yahoo Finance 소스 ────────────────────────────────────────────────────

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
      const res = await fetch(url, {
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

// ── ③ Gemini 배치 분류 소스 ─────────────────────────────────────────────────

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
  source:      'KRX' | 'Yahoo' | 'Gemini' | 'carry-over';
  /** KRX+Yahoo+Gemini 등 조합형 라벨 — 메타데이터 기록용 */
  sourceLabel: string;
  diagnostics: string[];
}

/**
 * KRX → Yahoo → Gemini 순으로 폴백을 시도해 최대 커버리지 맵을 산출한다.
 *
 * @param krxAttempt   KRX 벌크 스냅샷을 시도하는 콜백. 성공 시 {map, diagnostics} 반환.
 *                     실패 시 throw 또는 null. sectorMapUpdater.ts 의 KRX 빌더를 주입.
 * @param existingMap  현재 디스크의 krx-sector-map.json 내용 (신규 설치 시 {}).
 * @param targetCodes  Yahoo/Gemini 후보 유니버스 — 보통 existingMap 키 + MANUAL_OVERRIDES 키의 합집합.
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
    diagnostics.push(`KRX: 실패 — ${e instanceof Error ? e.message : String(e)} → 폴백 단계로 전환`);
  }

  // ── 공통: 기존 파일 + 수동 오버라이드를 기반선(baseline) 으로 채택 ───────
  // 폴백 단계는 "신선도 회복"이 아니라 "무너지지 않도록 보존"이 목표.
  // 기존 파일에서 커버되는 종목은 그대로 유지하고, 부족분만 Yahoo/Gemini 로 보충.
  const merged: Record<string, string> = { ...existingMap };
  // 수동 오버라이드는 sectorMap.ts 조회 우선순위에서 최상위라 디스크엔 기록할 필요 없지만,
  // 최종 맵의 커버리지 판단을 위해 합산한다.
  for (const [c, s] of Object.entries(MANUAL_OVERRIDES)) merged[c] = s;

  // Yahoo/Gemini 에서 보충할 "미커버" 코드 — 기존 맵에 없는 targetCodes 만.
  const missing = targetCodes.filter((c) => !merged[c]);
  diagnostics.push(`baseline: existing=${Object.keys(existingMap).length} manual=${Object.keys(MANUAL_OVERRIDES).length} missing=${missing.length}`);

  // ── ② Yahoo ──────────────────────────────────────────────────────────────
  let usedYahoo = false;
  if (missing.length > 0) {
    const yr = await fetchFromYahoo(missing, verbose).catch((e) => ({
      map: {}, source: 'Yahoo' as const, diagnostics: [`Yahoo: catch ${e instanceof Error ? e.message : String(e)}`],
    }));
    diagnostics.push(...yr.diagnostics);
    Object.assign(merged, yr.map);
    usedYahoo = Object.keys(yr.map).length > 0;
  }

  // ── ③ Gemini ─────────────────────────────────────────────────────────────
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
  // carry-over 는 "KRX·Yahoo·Gemini 모두 실패 + merged 가 기존 파일과 동일"인 경우.
  const finalCount      = Object.keys(merged).length;
  const existingCount   = Object.keys(existingMap).length;
  const addedByFallback = finalCount - existingCount - Object.keys(MANUAL_OVERRIDES).filter((c) => !existingMap[c]).length;

  const label = [
    usedYahoo  ? 'Yahoo'  : null,
    usedGemini ? 'Gemini' : null,
  ].filter(Boolean).join('+') || 'carry-over';

  return {
    map:         merged,
    source:      label === 'carry-over' ? 'carry-over' : (usedYahoo ? 'Yahoo' : 'Gemini'),
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

