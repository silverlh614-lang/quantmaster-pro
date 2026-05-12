// @responsibility krxClient CSV 파싱 SSOT — KRX OTP-CSV 다운로드 응답 변환
/**
 * krxClient/csv.ts — ADR-0502c (krxClient 분해) Phase 2 — CSV 파서 SSOT.
 *
 * 외부 의존성 0 (logger·http·cooldown 도 import 안 함). 다른 krxClient 하위 모듈이
 * import 가능. 순수 문자열·바이트 → 객체 변환 layer.
 *
 * 외부 노출 (barrel 경유):
 *   - decodeKrxCsv         — ArrayBuffer → string (UTF-8/EUC-KR 자동 감지)
 *   - parseKrxCsv          — string → ParsedKrxCsv (헤더 별칭 정규화)
 *
 * 내부 (parseKrxCsv 호출):
 *   - parseCsvLine         — RFC 4180 호환 따옴표 처리
 *
 * KRX 보고서 CSV 한글 헤더는 가변 — 별칭 매핑 SSOT 로 안정화:
 *   "단축코드"/"종목코드"             → ISU_SRT_CD
 *   "종목명"/"종목약명"               → ISU_ABBRV
 *   "일자"/"기준일"                   → TRD_DD
 *   "투자자구분"/"투자자"             → INVST_TP_NM
 *   "외국인" 패턴                     → FORN_INVSTR_NETBY_QTY
 *   "기관"/"기관합계" 패턴            → ORGN_INVSTR_NETBY_QTY
 *   "개인" 패턴                       → INDIV_INVSTR_NETBY_QTY
 *   "순매수거래대금" 패턴             → NETBY_TRDVAL
 *   "순매수거래량" 패턴               → NETBY_QTY
 */

import type { ParsedKrxCsv } from './types.js';

/**
 * KRX CSV 응답은 Content-Type 헤더로 인코딩을 알 수 없는 경우가 흔하다.
 * UTF-8 명시 시 UTF-8, 그 외엔 EUC-KR 우선 디코드 후 실패 시 UTF-8 fallback.
 */
export function decodeKrxCsv(buffer: ArrayBuffer, contentType: string | null): string {
  const lower = (contentType ?? '').toLowerCase();
  if (lower.includes('utf-8')) return new TextDecoder('utf-8').decode(buffer);
  try {
    return new TextDecoder('euc-kr').decode(buffer);
  } catch {
    return new TextDecoder('utf-8').decode(buffer);
  }
}

/**
 * RFC 4180 호환 한 줄 파서 — `""` escaped 따옴표 처리 + 인용 내부 콤마 보존.
 * 외부 export 미노출 — parseKrxCsv 내부에서만 사용.
 */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && quoted && line[i + 1] === '"') {
      current += '"';
      i += 1;
      continue;
    }
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (ch === ',' && !quoted) {
      out.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current.trim());
  return out;
}

/**
 * KRX CSV 텍스트 → ParsedKrxCsv (raw rows + 한글 별칭 정규화).
 * 빈 응답·헤더-only·BOM 모두 noDataReason 으로 분류.
 */
export function parseKrxCsv(text: string): ParsedKrxCsv {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return { rows: [], headers: [], headerDetected: false, noDataReason: 'EMPTY_CSV' };
  const headers = parseCsvLine(lines[0]).map((header) => header.trim());
  const headerDetected = headers.length > 0 && headers.some((header) => header.length > 0);
  if (lines.length < 2) {
    return {
      rows: [],
      headers,
      headerDetected,
      noDataReason: headerDetected ? 'HEADER_ONLY' : 'NO_CSV_HEADER',
    };
  }
  const aliasKey = (header: string): string | null => {
    const compact = header.replace(/\s+/g, '');
    if (/종목코드|단축코드/i.test(compact)) return 'ISU_SRT_CD';
    if (/종목명|종목약명/i.test(compact)) return 'ISU_ABBRV';
    if (/일자|기준일/i.test(compact)) return 'TRD_DD';
    if (/투자자구분|투자자/i.test(compact)) return 'INVST_TP_NM';
    if (/외국인/i.test(compact)) return 'FORN_INVSTR_NETBY_QTY';
    if (/기관합계|기관/i.test(compact)) return 'ORGN_INVSTR_NETBY_QTY';
    if (/개인/i.test(compact)) return 'INDIV_INVSTR_NETBY_QTY';
    if (/순매수.*대금|순매수거래대금/i.test(compact)) return 'NETBY_TRDVAL';
    if (/순매수.*수량|순매수.*거래량/i.test(compact)) return 'NETBY_QTY';
    return null;
  };
  const rows = lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row: Record<string, unknown> = {};
    headers.forEach((header, index) => {
      const value = values[index] ?? '';
      row[header] = value;
      const alias = aliasKey(header);
      if (alias && row[alias] == null) row[alias] = value;
    });
    return row;
  });
  return {
    rows,
    headers,
    headerDetected,
    noDataReason: rows.length > 0 ? null : 'CSV_EMPTY_ROWS',
  };
}
