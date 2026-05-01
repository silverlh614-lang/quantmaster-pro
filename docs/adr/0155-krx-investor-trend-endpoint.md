# ADR-0155: KRX 기관 5영업일 누적 순매수 endpoint 신설 + #12 institutionalBuying 격상

**날짜**: 2026-05-01
**상태**: 채택
**관련 PR**: PR-Phase5 (ADR-0154 §2 옵션 C 진입)
**관련 ADR**:
- ADR-0011 (PR-25-A/B/C, AI 추천 KIS/KRX 분리) — 본 PR 정합 (KRX 공개 endpoint 사용, KIS 무관)
- ADR-0152 (Naver 외인 추세 endpoint) — 동일 패턴 차용
- ADR-0154 §2 (옵션 C 권장) — 본 PR 진입 결정

## 문제

ADR-0154 §2 가 #12 institutionalBuying 격상 잔여 옵션 3 중 *옵션 C 권장* (KRX OpenAPI 기관 순매수 — ADR-0011 정책 무영향 + 공개 데이터 + 무료). 본 PR 이 옵션 C 채택.

audit findings.md §E 가 #12 를 *KIS 외인/기관 호출 의존* 으로 가정했지만 ADR-0011 PR-25-C 가 KIS 호출 제거 후 stock.checklist?.institutionalBuying 보존 (silent degradation 차단, ADR-0151).

진정한 격상 = *KRX OpenAPI 공개 통계 활용 + 5영업일 누적 흐름 신호*.

## 결정

### 1. `GET /api/krx-investor/trend?code=...&days=5` HTTP endpoint

`server/routes/krxInvestorRouter.ts` 신규. 기존 `fetchInvestorTrading(date)` (KRX BLD MDCSTAT02203) 를 N영업일 호출 + 종목 코드 필터 + 합산.

**호출 비용**: KRX 1 요청 = 모든 종목 1 응답 (5분 cache). 동일 일자 N 종목 호출 시 cache hit. 매수 시점 enrichment N 종목 = 5 호출 (5 영업일).

응답 schema:
```json
{
  "code": "005930",
  "foreignNet5d": 1234567,
  "institutionNet5d": 234567,
  "individualNet5d": -567890,
  "sampleSize": 5,
  "latestDate": "2026-04-30"
}
```

### 2. `previousBusinessDay` 헬퍼 — 토/일 자동 회피

```typescript
function previousBusinessDay(now: Date, offsetDays: number): string {
  // 직전 영업일 (월~금) 계산. 한국 공휴일 미반영 (KRX 응답 부재 시 sampleSize 감소).
}
```

### 3. enrichment.ts main path #12 institutionalBuying 격상

**임계** (audit findings §A 권장 + foreignerRatioRepo 패턴 차용):
```typescript
institutionalBuying:
  krxInvestorTrend != null &&
  krxInvestorTrend.institutionNet5d > 0 &&
  krxInvestorTrend.sampleSize >= 3
    ? 1
    : (stock.checklist?.institutionalBuying ?? 0)
```

- `institutionNet5d > 0` — 5영업일 누적 *기관 순매수* (양수)
- `sampleSize >= 3` — 최소 3 영업일 데이터 충분
- 부재/미달 → AI 추정 fallback (silent degradation 차단 — ADR-0151 정합)

### 4. main path 만 적용 (aiFallback 제외)

ADR-0152 패턴 정합 — Yahoo OHLCV 부재 시 회로 부담 격리. aiFallback 경로는 stock.checklist 보존만, KRX 추가 호출 안 함.

### 5. `buildConditionSourceTiers` 'API' 분류 추가

```typescript
if (ctx.hasKrxInvestor) {
  meta.institutionalBuying = 'API';
}
```

신규 ctx 필드 `hasKrxInvestor?: boolean`. main path 에서 `krxInvestorTrend?.sampleSize >= 3` 시 true. UI DataQualityBadge 가 #12 를 'API' tier 표시.

## 영향

### 27 조건 격상 진행도

| Phase | 누적 격상 % | 격상 항목 |
|---|---|---|
| Phase 4 직전 (PR-Phase4-Closeout 시점) | 67% (18개) | REAL_DATA 9 + DART 5 + Naver 추세 1 + globalIntel 3 |
| **본 PR (ADR-0155)** | **70% (19개)** | **+ #12 institutionalBuying (KRX 5영업일 기관)** |
| Phase 4 (옵션 A — Yahoo 컨센서스) | 78% (21개) | + #14 earningsSurprise + #13 consensusTarget (ADR-0156) |
| 정성 (DECIDED_NOT_WIRING) | 100% | 22% (5개) — #9/#13/#17/#20/#26 (ADR-0154 영구) |

### LIVE 매매 영향

- ADR-0011 정책 그대로 유지 — KIS supply 호출 0건 (KRX 공개 endpoint 사용)
- 신규 매수 시점부터 #12 institutionalBuying 가 *KRX 5영업일 누적 기관 순매수* 영속
- 3 영업일 누적 후 자연 활성화 (sampleSize ≥ 3 임계)
- 임계 미달 / 표본 부족 → AI 추정 stock.checklist 보존

### KIS/KRX 자동매매 quota 영향

- KIS: 0 (ADR-0011 정책 그대로)
- KRX: enrichment 매수 시점 N 종목 × 5 영업일 = 최대 5 호출 (5분 cache 효과로 동일 일자 cache hit, 사실상 1~5 호출)
- Naver / Yahoo: 0

## 회귀 테스트

`server/routes/krxInvestorRouter.test.ts` 신규 — fetchInvestorTrading mock + endpoint schema 검증 (정상 응답 / sampleSize=0 / 잘못된 code / throw 500).

## ENV 우회

본 PR 미도입. 임계 (3 표본 / institutionNet5d > 0) 정책 SSOT.

## 잔여

- **#12 임계값 데이터 검증** — 1~2주 운영 데이터 누적 후 임계 정합성 평가
- **KRX BLD ID 검증** — `MDCSTAT02203` 정합성 확인 (이미 운영 중)
