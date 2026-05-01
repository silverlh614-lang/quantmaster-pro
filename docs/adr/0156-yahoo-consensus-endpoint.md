# ADR-0156: Yahoo 컨센서스 endpoint 신설 + Phase 4 #13/#14 격상 (옵션 A 변형)

**날짜**: 2026-05-01
**상태**: 채택
**관련 PR**: PR-Phase5 (ADR-0154 §1 옵션 A 변형 진입)
**관련 ADR**:
- ADR-0011 (AI 추천 KIS/KRX 분리) — 본 PR 정합
- ADR-0028 / ADR-0058 (EgressGuard) — Yahoo 호출 정책 정합
- ADR-0154 §1 (Phase 4 BLOCKED 옵션 A) — 본 PR 진입 결정

## 문제

ADR-0154 §1 가 Phase 4 외부 컨센서스 #14 / #13 잔여 옵션 3 중:
- **옵션 A**: FnGuide / WiseFn 등 *공식 외부 컨센서스 API* — 인증 키 + 비용 정책 부재
- **옵션 B**: 사용자 *수동 입력 schema* — 인프라 부담
- **옵션 C**: Naver Finance scraping — robots.txt + HTML 안정성 위험

본 PR 이 **옵션 A 변형** 채택 — Yahoo Finance 무료 `quoteSummary` endpoint (인증 키 무관). Yahoo 의 `recommendationTrend` (#13) + `earningsHistory` (#14) modules 가 *공식 컨센서스 데이터 무료 노출*.

**한국 종목 가용성**: Yahoo .KS / .KQ 종목 중 일부 컨센서스 데이터 보유 (해외 분석가 커버). 가용률 30~50% 추정 — 부재 시 source='unavailable' fallback.

## 결정

### 1. `server/clients/yahooConsensusClient.ts` 신규

`fetchYahooConsensus(code)` — Yahoo `quoteSummary` 의 `recommendationTrend` + `earningsHistory` 두 modules 합성:

```typescript
GET https://query1.finance.yahoo.com/v10/finance/quoteSummary/005930.KS?modules=recommendationTrend,earningsHistory
```

**합성 로직**:
- `recommendationStrength` ← `(strongBuy + buy) / total` of period='0m' (또는 첫 row)
- `earningsSurpriseAvg` ← 최근 N 분기 `surprisePercent.raw` 평균

**EgressGuard wiring**: `intent='HISTORICAL'` (시간대 무관 누적 컨센서스 데이터). `.KS` 우선 + `.KQ` fallback (sectorSources.ts 패턴 정합).

### 2. `GET /api/yahoo-consensus/snapshot?code=...` HTTP endpoint

`server/routes/yahooConsensusRouter.ts` 신규. 응답 schema:
```json
{
  "recommendationStrength": 0.62,
  "earningsSurpriseAvg": 5.4,
  "sampleSize": 21,
  "source": "yahoo"
}
```

`source='unavailable'` 시 모든 필드 null + sampleSize=0 — 호출자 fallback.

### 3. enrichment.ts main path #13/#14 격상

**임계**:
```typescript
consensusTarget:
  yahooConsensus?.source === 'yahoo' &&
  yahooConsensus.recommendationStrength != null &&
  yahooConsensus.recommendationStrength >= 0.5
    ? 1
    : (stock.checklist?.consensusTarget ?? 0),
earningsSurprise:
  yahooConsensus?.source === 'yahoo' &&
  yahooConsensus.earningsSurpriseAvg != null &&
  yahooConsensus.earningsSurpriseAvg > 0
    ? 1
    : (stock.checklist?.earningsSurprise ?? 0)
```

- **#13 consensusTarget**: `recommendationStrength ≥ 0.5` (StrongBuy + Buy 비율 ≥ 50%) — 분석가 다수 매수 의견
- **#14 earningsSurprise**: `earningsSurpriseAvg > 0` (최근 분기 평균 *Beat*)
- 부재 / source='unavailable' → AI 추정 fallback (silent degradation 차단)

### 4. `buildConditionSourceTiers` 'API' 격상

```typescript
if (ctx.hasYahooConsensus) {
  meta.consensusTarget = 'API';
  meta.earningsSurprise = 'API';
}
```

신규 ctx 필드 `hasYahooConsensus?: boolean`. main path 에서 `yahooConsensus?.source === 'yahoo'` 시 true.

### 5. main path 만 적용 (aiFallback 제외)

ADR-0152 / ADR-0155 패턴 정합 — Yahoo OHLCV 부재 시 회로 부담 격리.

## 영향

### 27 조건 격상 진행도

| Phase | 누적 격상 % | 격상 항목 |
|---|---|---|
| ADR-0155 적용 후 | 70% (19개) | + #12 institutionalBuying |
| **본 PR (ADR-0156)** | **78% (21개)** | **+ #13 consensusTarget + #14 earningsSurprise** |
| 정성 5 영구 (DECIDED_NOT_WIRING) | 100% | 22% (5개) — #9/#17/#20/#26 + #13 (정성 1순위 fallback) |

→ **27 조건 격상 진행도 한계 도달 — 78% (21 / 27)**. 잔여 22% (5 키) 는 정성 영구 (ADR-0154).

**한국 종목 가용률 한계**: Yahoo 가 한국 종목 컨센서스 30~50% 만 보유. 격상률 = 한국 종목별 데이터 가용 여부에 의존. 부재 시 #13/#14 = AI 추정 fallback (영구 22% AI 의 일부).

### LIVE 매매 영향

- ADR-0028 / ADR-0058 EgressGuard 정합 — Yahoo 호출 시간대 게이트 우회 (HISTORICAL intent)
- 신규 매수 시점부터 가용 종목 한정 #13/#14 정량 영속

### KIS/KRX 자동매매 quota 영향

- KIS / KRX: 0
- Yahoo: enrichment 매수 시점 종목당 1 호출 (최대 .KS + .KQ 2 시도)
- ADR-0028 EgressGuard 정합 (rate limit 자동 처리)

## 회귀 테스트

본 PR scope 외 (LIVE Yahoo API 의존). vi.mock 기반 단위 테스트는 후속 PR.

## ENV 우회

본 PR 미도입. 임계 (0.5 strength / >0 surprise) 정책 SSOT.

## 잔여

- **임계 데이터 검증** — 1~2주 운영 데이터 누적 후 0.5 / >0 임계 정합성 평가
- **한국 종목 가용률 측정** — Yahoo 컨센서스 부재 종목 비율 audit 후 옵션 B/C 추가 도입 검토
- **earnings 4분기 윈도우** — 현재 history 전체 평균. 최근 4 분기로 제한 검토 가능

## 27 조건 격상 시리즈 — 최종 마무리

본 PR 으로 27 조건 격상 시리즈 *데이터 가용 한계* 도달:
- ADR-0149 (매핑 정정) → ADR-0150 (Phase 1 DART) → ADR-0151 (Phase 2 audit)
- → ADR-0152 (Naver 외인 추세) → ADR-0153 (Phase 3 globalIntel) → ADR-0154 (잔여 정책)
- → **ADR-0155 (#12 KRX 기관) → ADR-0156 (Phase 4 Yahoo 컨센서스)** — Phase 5 마무리

**최종 진행도: 78% (21/27)**. 영구 22% AI 추정 잔존 (정성 5 키 — ADR-0154 §3).
