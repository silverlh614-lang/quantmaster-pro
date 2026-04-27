# ADR-0071: 다중 소스 교차 검증 — USD/KRW Yahoo + ECOS dual-source

**상태**: Accepted
**날짜**: 2026-04-27
**관련**: ADR-0064~0066 (PR-α/γ/β 데이터 수집 안정성), ADR-0067 (boundary 가드), ADR-0068 (macroState staleness), ADR-0069 (X-Field-Stale UI 배지), ADR-0070 (MarketDataHealthScore)

---

## 1. 배경

### 1.1 사용자 보고 (2026-04-27)

> /regime 메시지에 USD/KRW: 1,380 표시되지만 실제 시장 1,474. 신선도 라인은 ✅ 0.4h 인데 환율이 일치하지 않음. 연쇄적으로 다른 지표들 신뢰문제도 생김.

ADR-0064~0070 의 7-layer 데이터 안정성/품질 인프라가 모두 통과했음에도 *값이 잘못됨*.

### 1.2 근본 원인

`server/trading/marketDataRefresh.ts:425` 가 USD/KRW 를 **Yahoo `KRW=X` 단일 소스**로만
fetch:

```ts
const usdkrw = await fetchCloses('KRW=X', '25d');
if (usdkrw && usdkrw.length >= 3) {
  const last = usdkrw[usdkrw.length - 1];
  computed.usdKrw = last;  // ← 교차 검증 없음
}
```

`server/clients/ecosClient.ts:342` 의 `fetchLatestUsdKrw()` (한국은행 ECOS 공식 환율) 가
이미 존재하지만 **호출자 0건** — 서버 코드가 한국은행 공식 환율을 한 번도 사용 안 함.

### 1.3 신선도 ≠ 정확성

PR-2 (ADR-0058 후속) 의 "매크로 신선도" 라인은 `macroState.updatedAt` 만 보고 ✅/⚠️/❌
판정. cron 이 정상 실행되어 *틀린 값이라도 매 분 덮어쓰면* updatedAt 은 항상 신선. 사용자
신뢰 회복 안 됨.

본 ADR 은 *수치 정확성* 을 두 독립 소스 비교로 검증한다.

---

## 2. 결정

### 2.1 신규 SSOT — `server/trading/crossSourceValidator.ts`

`evaluateCrossSource(primary, secondary, label, thresholds?)` 순수 함수. 6 tier 분류:

| Tier | 조건 | 선택 | 알림 |
|------|------|------|------|
| `AGREED` | 격차 < warnPct (3%) | primary | 없음 |
| `WARN` | warnPct ≤ 격차 < criticalPct (3~5%) | secondary | console.warn |
| `CRITICAL` | 격차 ≥ criticalPct (5%) | secondary | 🛑 텔레그램 + diverged=true |
| `PRIMARY_ONLY` | secondary=null | primary | 없음 |
| `SECONDARY_ONLY` | primary=null | secondary | 없음 |
| `NO_DATA` | 둘 다 null 또는 분모=0 | null | 없음 |

`computeDivergencePct(p, s)` 헬퍼 — secondary 분모 + NaN/Infinity/0 안전 fallback.

### 2.2 정책 결정

| 시나리오 | 정책 | 근거 |
|----------|------|------|
| AGREED | primary 우선 | Yahoo intraday 신선도 우수 |
| WARN/CRITICAL | secondary 우선 | ECOS 한국은행 공식이 권위 있음 (보수적) |
| PRIMARY_ONLY | primary 사용 | ECOS_API_KEY 미설정 등 graceful |
| SECONDARY_ONLY | secondary 사용 | Yahoo fail 시 ECOS 가 살아있으면 좋음 |

CRITICAL 시 secondary 우선은 *자동매매 안전성* 때문 — 6.4% 격차로 잘못된 환율로 LIVE
주문 발주 위험 차단.

### 2.3 marketDataRefresh.ts wiring

```ts
const [usdkrw, ecosUsdKrw] = await Promise.all([
  fetchCloses('KRW=X', '25d'),
  fetchLatestUsdKrw().catch(() => null),  // graceful
]);
const yahooLast = usdkrw && usdkrw.length >= 3 ? usdkrw[usdkrw.length - 1] : null;
const xs = evaluateCrossSource(yahooLast, ecosUsdKrw, 'USD/KRW');
if (xs.selected !== null) {
  computed.usdKrw               = xs.selected;
  computed.usdKrwSource         = xs.selectedSource;     // 'PRIMARY' | 'SECONDARY'
  computed.usdKrwDivergencePct  = xs.divergencePct;
  computed.usdKrwDivergenceTier = xs.tier;
  if (xs.diverged) {
    await sendTelegramAlert('🛑 [USD/KRW 격차 임계 초과] ...');
  }
}
```

### 2.4 macroState 신규 옵셔널 필드 3종

```ts
usdKrwSource?: 'PRIMARY' | 'SECONDARY' | null;
usdKrwDivergencePct?: number | null;
usdKrwDivergenceTier?: string;  // AGREED/WARN/CRITICAL/...
```

기존 호출자 무영향 — 옵셔널 추가만.

### 2.5 /regime 메시지 출처 + 격차 노출

`formatUsdKrwLine(macro)` SSOT (regime.cmd.ts) — 8 분기:
- AGREED + Yahoo: `"1,380 (Yahoo)"`
- AGREED + ECOS: `"1,474 (ECOS)"`
- CRITICAL: `"1,474 (ECOS) ❌ 격차 6.38%"`
- WARN: `"1,450 (ECOS) ⚠️ 격차 3.50%"`
- PRIMARY_ONLY: `"1,380 (Yahoo·ECOS 미수집)"`
- SECONDARY_ONLY: `"1,474 (ECOS·Yahoo 미수집)"`
- NO_DATA tier: `"1,380 (Yahoo·격차 계산 불가)"`
- 데이터 부재: `"N/A"`
- 레거시 macroState (tier 필드 부재): `"1,380 (Yahoo)"` 안전 fallback

운영자가 *값* + *출처* + *격차* 를 1줄로 동시 인지.

### 2.6 ADR-0070 MarketDataHealthScore 6번째 axis 추가

```ts
DIVERGENCE_DEDUCTION = {
  CRITICAL: 25,         // 격차 ≥5% — 통합 점수 -25
  WARN: 10,             // 격차 ≥3% — 통합 점수 -10
  PRIMARY_ONLY: 5,      // 한쪽 단독
  SECONDARY_ONLY: 5,
};
```

`AGREED` / `NO_DATA` / 미수집 → 차감 없음. 다른 axis (macroState staleness 등) 와 누적.

---

## 3. 회귀 위험

### 3.1 ECOS_API_KEY 미설정 환경

`fetchLatestUsdKrw()` 가 null 반환 → `evaluateCrossSource(yahoo, null, ...)` →
`PRIMARY_ONLY` tier → primary 사용. 회귀 0.

### 3.2 Yahoo `KRW=X` 정상 + ECOS 정상 + AGREED

`AGREED` 분기에서 primary (Yahoo) 사용 → 기존 동작 100% 보존. 회귀 0.

### 3.3 텔레그램 알림 폭주 방어

CRITICAL 격차는 정상 운영에서 거의 발생 안 함 (시장 환율과 한국은행 환율은 2% 이내).
발생 시 *진짜 데이터 신뢰 문제* 라 알림 가치 높음 — 기본 dedupeKey 미설정 (일반 설정 사용).
운영 데이터 누적 후 dedupeKey 추가 검토.

### 3.4 ECOS 통계 갱신 주기

ECOS 가 한국은행 *고시환율* 이라 매분 갱신 안 됨 (영업일 기준). Yahoo 가 더 신선.
정상 운영 시 격차 < 1% 예상.

---

## 4. 검증

회귀 테스트 78 케이스 신규:

- `crossSourceValidator.test.ts` 29:
  - `computeDivergencePct` 9: 정상/null/0 분모/NaN/Infinity/소수점/사용자 시나리오
  - `evaluateCrossSource` 11: 6 tier + boundary + 사용자 보고 시나리오 + 분모 0 fallback
  - 임계값 override 3
  - `formatDivergenceTier` 6 라벨

- `regime.cmd.test.ts` 10: `formatUsdKrwLine` 8 분기 + 데이터 부재 + 레거시 fallback

- `marketDataHealth.test.ts +7` (divergence axis):
  - CRITICAL/WARN/PRIMARY_ONLY 차감 검증
  - AGREED/NO_DATA 차감 없음
  - 옵셔널 필드 부재 회귀 안전
  - 누적 차감 (CRITICAL + macro WARN = -40)

전체 lint + validate:all 9종 + precommit 통과.

---

## 5. 후속 ADR

- **VKOSPI / VIX / US10Y 다중 소스**: VKOSPI 는 KRX 자체 발표 + Yahoo `^VKOSPI`,
  US10Y 는 FRED `DGS10` + Yahoo `^TNX` 가능. 본 ADR 의 evaluator 재사용.
- **vixDivergence / vkospiDivergence axis**: ADR-0070 점수에 추가.
- **자동매매 진입 차단 정책**: `usdKrwDivergenceTier === 'CRITICAL'` 시 preflight
  staleness gate 와 유사하게 `MACRO_STATE_DIVERGED` 차단? 안전성 ↑ vs 운영 부담 ↑
  trade-off 검토 필요.
