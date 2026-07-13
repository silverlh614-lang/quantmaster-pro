// @responsibility krxCsvProbe.cmd 텔레그램 모듈
// @responsibility: /krx_csv_probe (alias /kcp) — KRX CSV API raw 응답 직접 검사 진단 (EMPTY_PARSE 원인 5분기 분류, read-only).
//
// 9일+ 진단 여정 단일 진원지 — krxStockMasterRepo.ts:310-316 의 fetchKrxMasterEntries 가
// HTML_DETECTED 통과 후 parseKrxMasterCsv 0건 EMPTY_PARSE 반환. 본 명령은 같은 OTP+CSV
// 호출을 우회 없이 raw 검사해 (1) 빈응답 (2) HTML (3) 헤더만 (4) 컬럼 부족 (5) 인코딩 결함
// 중 어느 시나리오인지 자동 분류한다. parseKrxMasterCsv 본체는 변경하지 않는다.
//
// SAFETY:
// - read-only — master/캐시/parseKrxMasterCsv 수정 0건
// - 60s rate-limit (KRX 외부 호출 폭주 차단, 회로/블랙리스트 부담 회피)
// - master 갱신 미호출 (운영자가 결과 보고 /kmr 별도 트리거)
// - AUTO_TRADE_ENABLED / emergencyStop 가드 불필요 (진단 read-only)

import { commandRegistry } from '../../commandRegistry.js';
import type { TelegramCommand } from '../_types.js';

const PROBE_RATE_LIMIT_MS = 60_000;
let _lastProbeAt = 0;

interface KrxCsvProbeMetrics {
  otpLen: number;
  csvBytes: number;
  lineCount: number;
  headerColumns: number;
  looksHtml: boolean;
  hasBOM: boolean;
  isEucKrMojibake: boolean;
}

/**
 * 진단 결과 라벨 SSOT — 5분기 + OTP 실패 + 정상 fallback.
 * 우선순위: OTP 빈응답 > CSV 빈응답 > HTML > 헤더만 > partial > 컬럼부족 > 인코딩 > 정상.
 */
function diagnoseKrxCsvProbe(metrics: KrxCsvProbeMetrics): string {
  if (metrics.otpLen === 0) return '❌ OTP 빈 응답 — 헤더/세션/IP 차단 의심 (KRX 측 정책 변경 가능)';
  if (metrics.csvBytes === 0) return '❌ CSV 빈 응답 — KRX API 결함 또는 OTP 거부';
  if (metrics.looksHtml) return '❌ HTML 응답 (rate-limit, IP 차단, 점검 페이지) — Railway IP 점검';
  if (metrics.lineCount === 1) return '⚠️ 헤더만 있고 데이터 0건 — 권한 또는 시점 문제';
  if (metrics.lineCount < 100) return '⚠️ 부분 응답 — partial fetch 또는 truncation 의심';
  if (metrics.headerColumns < 5) return '⚠️ CSV 컬럼 부족 — 형식 변경 의심 (parseKrxMasterCsv 업데이트 필요)';
  if (metrics.isEucKrMojibake) return '⚠️ 인코딩 결함 — EUC-KR 디코딩 누락 (\\uFFFD mojibake 감지)';
  return '✅ 응답 자체는 정상 — parseKrxMasterCsv 컬럼 인덱스/조건 결함 의심';
}

const krxCsvProbe: TelegramCommand = {
  name: '/krx_csv_probe',
  aliases: ['/kcp'],
  category: 'SYS',
  visibility: 'ADMIN',
  riskLevel: 0,
  description: 'KRX CSV API raw 응답 직접 검사 — EMPTY_PARSE 원인 자동 분류 (read-only)',
  usage: '/krx_csv_probe',
  async execute({ reply }) {
    const now = Date.now();
    if (now - _lastProbeAt < PROBE_RATE_LIMIT_MS) {
      const wait = Math.ceil((PROBE_RATE_LIMIT_MS - (now - _lastProbeAt)) / 1000);
      await reply(`⏱️ 60초 이내 재호출 차단 — ${wait}초 후 다시 시도`);
      return;
    }
    _lastProbeAt = now;

    await reply('🔍 KRX CSV Probe — 직접 응답 검사 중...');

    // krxStockMasterRepo.fetchKrxMasterEntries 와 동일한 endpoint/헤더 사용 (드리프트 차단).
    const KRX_BASE = (process.env.KRX_PUBLIC_API_BASE ?? 'http://data.krx.co.kr').replace(/\/$/, '');
    const KRX_HEADERS = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/octet-stream, text/csv, */*',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': `${KRX_BASE}/contents/MDC/STAT/standard/MDCSTAT01901.cmd`,
      'Origin': KRX_BASE,
    };

    try {
      // 1. OTP 단계
      const otpT0 = Date.now();
      const otpRes = await fetch(`${KRX_BASE}/comm/fileDn/GenerateOTP/generate.cmd`, {
        method: 'POST',
        headers: KRX_HEADERS,
        body: new URLSearchParams({
          mktId: 'ALL',
          share: '1',
          csvxls_isNo: 'false',
          name: 'fileDown',
          url: 'dbms/MDC/STAT/standard/MDCSTAT01901',
        }).toString(),
        signal: AbortSignal.timeout(10000),
      });
      const otpStatus = otpRes.status;
      const otp = await otpRes.text();
      const otpLen = otp.length;
      const otpTrimLen = otp.trim().length;
      const otpFirst80 = otp.slice(0, 80).replace(/[\r\n]/g, '↵');
      const otpElapsed = Date.now() - otpT0;

      if (!otpRes.ok || otpTrimLen === 0) {
        const verdict = diagnoseKrxCsvProbe({
          otpLen: otpTrimLen, csvBytes: 0, lineCount: 0,
          headerColumns: 0, looksHtml: false, hasBOM: false, isEucKrMojibake: false,
        });
        await reply(
          `🔍 KRX CSV Probe — OTP 단계 실패\n\n` +
          `📡 OTP:\n` +
          `  status: ${otpStatus} (${otpElapsed}ms)\n` +
          `  bytes: ${otpLen}\n` +
          `  preview: "${otpFirst80}"\n\n` +
          `🎯 진단:\n${verdict}`,
        );
        return;
      }

      // 2. CSV 다운로드 단계
      const csvT0 = Date.now();
      const dataRes = await fetch(`${KRX_BASE}/comm/fileDn/download_csv/download.cmd`, {
        method: 'POST',
        headers: KRX_HEADERS,
        body: new URLSearchParams({ code: otp.trim() }).toString(),
        signal: AbortSignal.timeout(15000),
      });
      const dataStatus = dataRes.status;
      const csv = await dataRes.text();
      const csvBytes = csv.length;
      const csvElapsed = Date.now() - csvT0;

      // 3. 응답 분석 (인코딩/형식/HTML 감지)
      const headLower = csv.slice(0, 200).trimStart().toLowerCase();
      const looksHtml =
        headLower.startsWith('<!doctype') ||
        headLower.startsWith('<html') ||
        headLower.startsWith('<head') ||
        headLower.startsWith('<?xml');
      const hasBOM = csv.charCodeAt(0) === 0xFEFF;
      const isEucKrMojibake = csv.includes('�');
      const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
      const lineCount = lines.length;
      const firstLine = (lines[0] ?? '').slice(0, 200);
      const lastLine = (lines[lines.length - 1] ?? '(empty)').slice(0, 100);
      const headerColumns = firstLine.length > 0 ? firstLine.split(',').length : 0;
      const csvFirst300 = csv.slice(0, 300).replace(/\r?\n/g, '↵');

      const verdict = diagnoseKrxCsvProbe({
        otpLen: otpTrimLen, csvBytes, lineCount, headerColumns,
        looksHtml, hasBOM, isEucKrMojibake,
      });

      await reply(
        `🔍 KRX CSV Probe Result\n\n` +
        `📡 OTP:\n` +
        `  status: ${otpStatus} (${otpElapsed}ms)\n` +
        `  bytes: ${otpLen}\n` +
        `  preview: "${otpFirst80}"\n\n` +
        `📦 CSV:\n` +
        `  status: ${dataStatus} (${csvElapsed}ms)\n` +
        `  bytes: ${csvBytes}\n` +
        `  lineCount: ${lineCount}\n` +
        `  hasBOM: ${hasBOM}\n` +
        `  isEucKrMojibake: ${isEucKrMojibake}\n` +
        `  looksHtml: ${looksHtml}\n\n` +
        `📋 헤더 (첫 줄):\n` +
        `  columns: ${headerColumns}\n` +
        `  preview: "${firstLine}"\n\n` +
        `📋 마지막 줄:\n` +
        `  preview: "${lastLine}"\n\n` +
        `📋 CSV preview (300자):\n` +
        `  ${csvFirst300}\n\n` +
        `🎯 진단:\n${verdict}`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await reply(`❌ KRX CSV Probe 실패: ${msg}`);
    }
  },
};

commandRegistry.register(krxCsvProbe);
