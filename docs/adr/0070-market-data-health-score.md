# ADR-0070: MarketDataHealthScore SSOT — 시장 데이터 통합 품질 점수

**상태**: Accepted
**날짜**: 2026-04-27
**관련**: ADR-0064 (prefill overlay), ADR-0065 (disk snapshot), ADR-0066 (SWR), ADR-0067 (boundary 가드), ADR-0068 (macroState staleness), ADR-0069 (X-Field-Stale UI 배지)

---

## 1. 배경

ADR-0064~0069 의 6 PR 시리즈가 시장 데이터 안정성·품질·격리 6 layer 를 구축했다.
운영자는 각 layer 의 상태를 *개별* 메시지로 확인할 수 있지만, *통합 품질 점수* 가
부재해 "지금 시장 데이터를 얼마나 신뢰할 수 있는가" 단일 답을 받기 어렵다.

본 ADR 은 5 axis (macroState staleness + indicators staleFields + Yahoo + KIS + KRX)
를 가중평균한 0-100 통합 점수 + tier (HEALTHY/DEGRADED/CRITICAL) 를 제공한다.

---

## 2. 결정

### 2.1 신규 SSOT — `server/health/marketDataHealth.ts`

`computeMarketDataHealthScore(snapshot, staleFields, now?)` 순수 함수.
외부 호출 0 — `loadMacroState()` 만 read.

### 2.2 점수 정책 SSOT (변경 시 본 §2.2 표 갱신 + 회귀 테스트 동시 수정)

시작 100점 → 차감 합산 → floor 0:

| Axis | 조건 | 차감 |
|------|------|------|
| macroState | `STALE_BLOCK` (24h+) / `NO_DATA` | -40 |
| macroState | `STALE_WARN` (8~24h) | -15 |
| indicators | staleFields 1~2개 | -10 |
| indicators | staleFields 3~4개 | -25 |
| indicators | staleFields 5+개 | -40 |
| Yahoo | `DOWN` | -25 |
| Yahoo | `DEGRADED` | -10 |
| Yahoo | `UNKNOWN` | -5 |
| KIS | `KIS_APP_KEY` 미설정 | -5 |
| KRX | 토큰 미설정 | -5 |
| KRX | 토큰 invalid | -15 |
| KRX | 회로 OPEN | -20 |
| KRX | 연속 실패 ≥3 | -10 |

### 2.3 Tier 임계값 SSOT — `MARKET_DATA_HEALTH_THRESHOLDS`

```ts
HEALTHY_MIN: 85   // score ≥ 85 → HEALTHY
DEGRADED_MIN: 60  // 60 ≤ score < 85 → DEGRADED
                  // score < 60 → CRITICAL
```

`classifyMarketDataHealthTier(score)` 단일 SSOT 함수. NaN/음수 → CRITICAL 안전 fallback,
>100 → HEALTHY (clamp).

### 2.4 결과 인터페이스

```ts
interface MarketDataHealthScore {
  score: number;                        // 0-100
  tier: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
  deductions: Array<{ axis, reason, deduction }>;  // 차감 이유 별도 노출
  details: {
    macroStaleness: MacroStalenessResult;
    staleFieldCount: number;
    staleFields: string[];
    yahooStatus: string;
    kisCircuitOk: boolean;
    krxOk: boolean;
  };
}
```

### 2.5 /health 통합

`formatHealthMessage` 에 라인 추가 — "매크로 신선도" 다음:

```
시장 데이터 품질: ✅ 100/100 (정상)
시장 데이터 품질: 🟡 70/100 (저하) — 주요: krx 회로 OPEN -20
시장 데이터 품질: ❌ 30/100 (위험) — 주요: macroState STALE 차단 -40
```

`formatMarketDataHealthLine(score)` 헬퍼 — tier 이모지 + 점수 + 한국어 라벨 + 최상위
차감 표기.

### 2.6 staleFields 서버측 한계 (후속 PR 보완)

서버 `health.cmd.ts` 는 `/api/market-indicators` 응답 헤더 cache 를 미보유 — 본 PR 은
`staleFields=[]` 로 호출. macroState/Yahoo/KIS/KRX 4축만 활용.

후속 PR 후보:
- `marketIndicatorsSnapshotRepo` 에 `lastStaleFields` 영속 추가
- `collectHealthSnapshot()` 에서 read 후 `health.cmd` 가 staleFields 전달

UI 측은 ADR-0069 의 store 가 이미 staleFields 보유 — 클라이언트 위젯에서는 통합 점수
계산이 정확. 본 PR scope 는 서버측 4축 점수 + UI 위젯은 후속 PR.

---

## 3. 회귀 위험

- 점수 정책 변경 시 운영자 알림 임계가 변할 수 있으므로 ADR §2.2 표 갱신 + 회귀
  테스트 동시 수정 의무
- floor 0 / clamp 100 으로 점수 폭주 방지
- NaN/음수 fallback 으로 안전성 확보 (CRITICAL 분류)
- `loadMacroState()` 호출이 본 함수 내부 — 호출자(health.cmd) 가 별도로 macroState
  read 해도 동일 인스턴스 영속 디스크라 정합 보장

---

## 4. 검증

회귀 테스트 32 케이스 — `server/health/marketDataHealth.test.ts`:
- `classifyMarketDataHealthTier` 9: 100/85/84/60/59/0/NaN/음수/>100
- `computeMarketDataHealthScore` baseline 1: 100점 정상
- macroState staleness 3: STALE_WARN/STALE_BLOCK/NO_DATA
- staleFields 4: 1/2/3/5
- Yahoo 3: DOWN/DEGRADED/UNKNOWN
- KIS/KRX 5: KIS 미설정/KRX 미설정/invalid/OPEN/연속실패
- 점수 누적 + floor 0 / boundary 정확성 2
- deductions 배열 정합 1
- formatMarketDataHealthLine 3: HEALTHY/DEGRADED/CRITICAL
- SSOT 임계값 검증 1

전체 lint + validate:all 9종 + precommit 통과.

---

## 5. 후속 ADR

- **ADR-0071** (예정): `marketIndicatorsSnapshotRepo.lastStaleFields` 영속 → /health
  서버측에서 staleFields 정확 반영
- UI 위젯 — `MarketDataHealthGauge` 컴포넌트 (계좌 생존 게이지 ADR-0050 패턴 차용)
