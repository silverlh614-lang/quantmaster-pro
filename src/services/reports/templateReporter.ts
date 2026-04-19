/**
 * templateReporter.ts — 결정적 리포트 생성기 (Idea 6)
 *
 * generateReportSummary()가 600~800자 본문 전체를 Gemini에 위임하던 구조를
 * 100% 결정적 템플릿으로 전환. AI는 마지막 톤업 단계(aiToneUp)에만 사용.
 *
 * 효과:
 *   - 호출당 maxOutputTokens 2048 → 자연어 톤업 한정 시 1024 이하
 *   - 본문 통계/수치는 템플릿이 직접 생성 → 수치 환각 0
 *   - Gemini 미설정/예산 차단 시에도 본문은 정상 생성 (graceful degradation)
 */

import type { StockRecommendation, MarketContext } from '../stock/types';

interface ReportSection {
  title: string;
  body: string;
}

function fmtPct(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return 'N/A';
  return `${value >= 0 ? '+' : ''}${value.toFixed(decimals)}%`;
}

function fmtNum(value: number | null | undefined, locale = true): string {
  if (value === null || value === undefined || Number.isNaN(value)) return 'N/A';
  return locale ? value.toLocaleString() : String(value);
}

function buildMarketSection(ctx: MarketContext | null): ReportSection {
  if (!ctx) {
    return { title: '시장 상황', body: '- 시장 데이터 수집 실패. 거시지표 미제공 상태입니다.' };
  }
  const lines: string[] = [];
  if (ctx.kospi) {
    lines.push(`- KOSPI ${fmtNum(ctx.kospi.index)} (${fmtPct(ctx.kospi.changePercent)}) — ${ctx.kospi.status ?? 'N/A'}`);
  }
  if (ctx.kosdaq) {
    lines.push(`- KOSDAQ ${fmtNum(ctx.kosdaq.index)} (${fmtPct(ctx.kosdaq.changePercent)}) — ${ctx.kosdaq.status ?? 'N/A'}`);
  }
  if (ctx.iri !== undefined || ctx.vkospi !== undefined) {
    lines.push(`- 삼성 IRI ${fmtNum(ctx.iri)}pt | VKOSPI ${fmtPct(ctx.vkospi, 1)}`);
  }
  if (ctx.overallSentiment) {
    lines.push(`- 종합 의견: ${ctx.overallSentiment}`);
  }
  return { title: '시장 상황', body: lines.length > 0 ? lines.join('\n') : '- (시장 지표 비어있음)' };
}

function buildStocksSection(stocks: StockRecommendation[]): ReportSection {
  if (stocks.length === 0) {
    return { title: '추천 종목', body: '- 추천 종목 없음 (현금 비중 확대 권장)' };
  }
  const lines = stocks.slice(0, 10).map((s) => {
    const passedCount = Object.values(s.checklist || {}).filter(Boolean).length;
    const passedKeys = Object.entries(s.checklist || {})
      .filter(([, v]) => v)
      .map(([k]) => k)
      .slice(0, 3)
      .join(', ');
    const type = (s.type ?? '').replace('_', ' ');
    const target = fmtNum(s.targetPrice);
    return `- **${s.name}** (${s.code}) — ${type} | 목표가 ${target}원 | 체크리스트 ${passedCount}/27 통과 (주요: ${passedKeys || 'N/A'})`;
  });
  return { title: '추천 종목 분석', body: lines.join('\n') };
}

function buildRiskSection(stocks: StockRecommendation[]): ReportSection {
  if (stocks.length === 0) return { title: '리스크 요약', body: '- 추천 종목이 없어 리스크 요약 생략.' };
  const allRisks = new Set<string>();
  for (const s of stocks) {
    for (const r of s.riskFactors ?? []) {
      if (r && r.length > 0) allRisks.add(r);
    }
  }
  const top = Array.from(allRisks).slice(0, 5);
  return {
    title: '주요 리스크 요인',
    body: top.length > 0
      ? top.map((r) => `- ${r}`).join('\n')
      : '- 명시된 리스크 요인 없음. 기본 손절선/포지션 한도 준수 권장.',
  };
}

function buildHeader(stocks: StockRecommendation[], ctx: MarketContext | null): string {
  const buyCount   = stocks.filter((s) => s.type === 'BUY' || s.type === 'STRONG_BUY').length;
  const sellCount  = stocks.filter((s) => s.type === 'SELL' || s.type === 'STRONG_SELL').length;
  const date = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
  const sentiment = ctx?.overallSentiment ?? '중립';
  return `## QuantMaster Pro 핵심 요약 — ${date}\n\n` +
         `**전체 신호: BUY ${buyCount}건 / SELL ${sellCount}건** | 시장 진단: ${sentiment}\n`;
}

/**
 * 결정적 리포트 본문 생성 — Gemini 호출 없음.
 * 추천 종목·체크리스트·시장 지표를 마크다운 섹션으로 조립.
 */
export function buildReportBody(
  recommendations: StockRecommendation[],
  marketContext: MarketContext | null,
): string {
  const sections: ReportSection[] = [
    buildMarketSection(marketContext),
    buildStocksSection(recommendations),
    buildRiskSection(recommendations),
  ];
  return [
    buildHeader(recommendations, marketContext),
    ...sections.map((s) => `### ${s.title}\n${s.body}`),
  ].join('\n\n');
}

/**
 * 본문을 압축한 요약 — aiToneUp의 입력으로 사용.
 * 최대 char 길이는 콜러가 결정 (기본 500).
 */
export function compressBodyForToneUp(body: string, maxChars = 500): string {
  // 마크다운 노이즈 제거 후 평문화
  const flat = body
    .replace(/^#+\s+/gm, '')
    .replace(/\*\*/g, '')
    .replace(/^\s*-\s+/gm, '· ')
    .replace(/\n{2,}/g, '\n')
    .trim();
  if (flat.length <= maxChars) return flat;
  return flat.slice(0, maxChars - 1) + '…';
}
