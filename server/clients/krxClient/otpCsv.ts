// @responsibility krxClient OTP-CSV 다운로드 SSOT — KRX fileDn/OTP+download 2단계
/**
 * krxClient/otpCsv.ts — ADR-0502c (krxClient 분해) Phase 2 — OTP-CSV flow SSOT.
 *
 * 외부 노출 (barrel 경유):
 *   - krxInvestorOtpCsv  — OTP 발급 → CSV 다운로드 → ParsedKrxCsv 변환
 *
 * 2단계 flow:
 *   1) POST {KRX_OTP_PATH}  body: form-urlencoded(buildKrxOtpPayload)
 *      → OTP 토큰 (text/plain) — HTML 응답 시 세션 필요/거부 분기
 *   2) POST {KRX_DOWNLOAD_CSV_PATH}  body: code=<otp>
 *      → CSV (UTF-8/EUC-KR) → parseKrxCsv → KrxRawResponse({csv: rows})
 *
 * 호출자 (queries-*): fetchInvestorTrading 등 변형 endpoint
 * 진단 meta 는 http.setKrxPostMeta 위임 (cooldown/diagnosticOnly 분기 공통).
 *
 * 의존성:
 *   - types.ts (KrxRawResponse, KrxInvestorEndpointVariant)
 *   - constants.ts (KRX_BASE, KRX_OTP_PATH, KRX_DOWNLOAD_CSV_PATH, KRX_USER_AGENT,
 *     KRX_DISABLED, isKrxAutoFetchDisabled, krxAutoFetchDisabledReason,
 *     krxDisabledReasonMessage)
 *   - http.ts (setKrxPostMeta, buildKrxOtpPayload, classifyContentType,
 *     makeKrxResponseKind)
 *   - csv.ts (decodeKrxCsv, parseKrxCsv)
 *   - cooldown.ts (recordBldSuccess)
 */

import type { KrxRawResponse, KrxInvestorEndpointVariant } from './types.js';
import {
  KRX_BASE,
  KRX_OTP_PATH,
  KRX_DOWNLOAD_CSV_PATH,
  KRX_USER_AGENT,
  KRX_DISABLED,
  isKrxAutoFetchDisabled,
  krxAutoFetchDisabledReason,
  krxDisabledReasonMessage,
} from './constants.js';
import {
  setKrxPostMeta,
  buildKrxOtpPayload,
  classifyContentType,
  makeKrxResponseKind,
} from './http.js';
import { decodeKrxCsv, parseKrxCsv } from './csv.js';
import { recordBldSuccess } from './cooldown.js';

export async function krxInvestorOtpCsv(
  variant: KrxInvestorEndpointVariant,
  options: { allowDisabledAutoFetch?: boolean } = {},
): Promise<KrxRawResponse | null> {
  const { body: otpBody, meta: payloadMeta } = buildKrxOtpPayload(variant);
  if (!options.allowDisabledAutoFetch && isKrxAutoFetchDisabled()) {
    const endpoint = variant.endpoint;
    console.info(`[KRX] skipped: ${krxAutoFetchDisabledReason()} auto fetch disabled endpoint=${endpoint}`);
    setKrxPostMeta(variant.bld, {
      ...payloadMeta,
      contentType: 'empty',
      httpStatus: null,
      responseKind: 'DISABLED',
      selectedKrxFlowMode: 'OTP_CSV',
      otpGenerated: false,
      otpLength: 0,
      csvDownloaded: false,
      csvRowCount: 0,
      csvColumnKeys: [],
      csvFailureReason: krxDisabledReasonMessage(),
      csvHeaderDetected: false,
      csvNoDataReason: krxDisabledReasonMessage(),
      diagnosticOnly: true,
      useForRouter: false,
      useForGate: false,
      useForLive: false,
      useForShadow: false,
    });
    return null;
  }

  if (KRX_DISABLED) {
    setKrxPostMeta(variant.bld, {
      ...payloadMeta,
      contentType: 'empty',
      httpStatus: null,
      responseKind: 'DISABLED',
      selectedKrxFlowMode: 'OTP_CSV',
      otpGenerated: false,
      otpLength: 0,
      csvDownloaded: false,
      csvRowCount: 0,
      csvColumnKeys: [],
      csvFailureReason: 'KRX_API_DISABLED',
      csvHeaderDetected: false,
      csvNoDataReason: 'KRX_API_DISABLED',
    });
    return null;
  }

  try {
    const otpRes = await fetch(`${KRX_BASE}${KRX_OTP_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'text/plain, */*',
        'User-Agent': KRX_USER_AGENT,
        'Referer': `${KRX_BASE}/contents/MDC/MDI/mdiLoader`,
        'Origin': KRX_BASE,
      },
      body: otpBody,
    });
    if (!otpRes.ok) {
      setKrxPostMeta(variant.bld, {
        ...payloadMeta,
        contentType: 'text',
        httpStatus: otpRes.status,
        responseKind: 'HTTP_ERROR',
        selectedKrxFlowMode: 'OTP_CSV',
        otpGenerated: false,
        otpLength: 0,
        csvDownloaded: false,
        csvRowCount: 0,
        csvColumnKeys: [],
        csvFailureReason: `OTP_HTTP_${otpRes.status}`,
        csvHeaderDetected: false,
        csvNoDataReason: `OTP_HTTP_${otpRes.status}`,
      });
      return null;
    }
    const otp = (await otpRes.text()).trim();
    const otpGenerated = otp.length > 0 && !/^<!doctype html|<html[\s>]/i.test(otp);
    if (!otpGenerated) {
      setKrxPostMeta(variant.bld, {
        ...payloadMeta,
        contentType: otp.length > 0 ? 'html' : 'empty',
        httpStatus: otpRes.status,
        responseKind: otp.length > 0 ? 'HTML' : 'EMPTY',
        selectedKrxFlowMode: 'OTP_CSV',
        otpGenerated: false,
        otpLength: otp.length,
        csvDownloaded: false,
        csvRowCount: 0,
        csvColumnKeys: [],
        csvFailureReason: otp.length > 0 ? 'OTP_HTML_OR_SESSION_REQUIRED' : 'OTP_EMPTY',
        csvHeaderDetected: false,
        csvNoDataReason: otp.length > 0 ? 'OTP_HTML_OR_SESSION_REQUIRED' : 'OTP_EMPTY',
      });
      return null;
    }

    const csvRes = await fetch(`${KRX_BASE}${KRX_DOWNLOAD_CSV_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'text/csv, application/octet-stream, text/plain, */*',
        'User-Agent': KRX_USER_AGENT,
        'Referer': `${KRX_BASE}/contents/MDC/MDI/mdiLoader`,
        'Origin': KRX_BASE,
      },
      body: new URLSearchParams({ code: otp }).toString(),
    });
    if (!csvRes.ok) {
      setKrxPostMeta(variant.bld, {
        ...payloadMeta,
        contentType: 'text',
        httpStatus: csvRes.status,
        responseKind: 'HTTP_ERROR',
        selectedKrxFlowMode: 'OTP_CSV',
        otpGenerated: true,
        otpLength: otp.length,
        csvDownloaded: false,
        csvRowCount: 0,
        csvColumnKeys: [],
        csvFailureReason: `CSV_HTTP_${csvRes.status}`,
        csvHeaderDetected: false,
        csvNoDataReason: `CSV_HTTP_${csvRes.status}`,
      });
      return null;
    }
    const arrayBuffer = await csvRes.arrayBuffer();
    const contentType = csvRes.headers?.get?.('content-type') ?? null;
    const text = decodeKrxCsv(arrayBuffer, contentType);
    const parsed = parseKrxCsv(text);
    const rows = parsed.rows.map((row) => {
      if (variant.routePurpose !== 'SYMBOL_LEVEL' || !variant.symbolCode) return row;
      return {
        ...row,
        ISU_SRT_CD: row.ISU_SRT_CD ?? variant.symbolCode,
        ISU_CD: row.ISU_CD ?? variant.isuCd ?? undefined,
      };
    });
    const columnKeys = rows[0] ? Object.keys(rows[0]).slice(0, 40) : parsed.headers.slice(0, 40);
    const responseKind = makeKrxResponseKind(classifyContentType(contentType, text));
    const csvNoDataReason = rows.length > 0
      ? null
      : parsed.headerDetected ? 'CSV_NO_DATA_FOR_DATE' : 'PARAMETER_MISMATCH';
    setKrxPostMeta(variant.bld, {
      ...payloadMeta,
      contentType: classifyContentType(contentType, text),
      httpStatus: csvRes.status,
      responseKind,
      selectedKrxFlowMode: 'OTP_CSV',
      otpGenerated: true,
      otpLength: otp.length,
      csvDownloaded: true,
      csvRowCount: rows.length,
      csvColumnKeys: columnKeys,
      csvFailureReason: csvNoDataReason,
      csvHeaderDetected: parsed.headerDetected,
      csvNoDataReason,
    });
    if (rows.length > 0) recordBldSuccess(variant.bld);
    return { csv: rows };
  } catch (error) {
    setKrxPostMeta(variant.bld, {
      ...payloadMeta,
      contentType: 'unknown',
      httpStatus: null,
      responseKind: 'NETWORK_ERROR',
      selectedKrxFlowMode: 'OTP_CSV',
      otpGenerated: false,
      otpLength: 0,
      csvDownloaded: false,
      csvRowCount: 0,
      csvColumnKeys: [],
      csvFailureReason: error instanceof Error ? error.message.slice(0, 80) : String(error).slice(0, 80),
      csvHeaderDetected: false,
      csvNoDataReason: 'NETWORK_ERROR',
    });
    return null;
  }
}
