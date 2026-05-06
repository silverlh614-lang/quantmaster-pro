# ADR-0415 — SectorEnergy STALE + PARTIAL_VOLUME STRONG_BUY 차단 격상

**상태**: Accepted
**머지 일자**: 2026-05-06
**관련**: ADR-0396 (SectorEnergyDataQuality 5단계 + 4-axis SSOT), ADR-0397 (Yahoo ETF L4 fallback), ADR-0398 (STRONG_BUY 4 조건 OR confidence gate), ADR-0400 (Wire SectorEnergyStrongBuyGate)

## 배경

사용자 5/6 운영 진단 — Defensive Cascade Failure 입력 layer 차단 정책. ADR-0398 `evaluateSectorEnergyStrongBuyGate` 의 4 조건 OR (`confidence<0.6` / `DEGRADED` / `FAILED` / `YAHOO_ETF`) 에서 두 결함 식별:

### 결함 1 — STALE 누락 (audit 발견)

ADR-0398 *원래 가정*: *"STALE (6-8 섹터 정상) 은 fallback 충분이라 STRONG_BUY 통과"*. 그러나 실제 운영에서 STALE 상태는 *6-8 섹터 정상* 자체가 데이터 신뢰도 부족 신호. 사용자 자본 보호 관점에서 STRONG_BUY 승격 부적합.

### 결함 2 — PARTIAL_VOLUME 분류 부재

사용자 명시 *"가격은 정상이나 거래량/일부 섹터 누락"* 시나리오를 표현할 dataQuality value 부재. 기존 `'PARTIAL'` 은 *9-11 섹터 정상* (validSectorCount 기반), `'PARTIAL_VOLUME'` 은 *거래량 결손* (가격 정상 + 거래량 누락) 별도 의미.

## 결정

### 결정 1 — `SectorEnergyDataQuality5` union 5단계 → 6단계 격상

```typescript
export type SectorEnergyDataQuality5 =
  | 'OK'
  | 'PARTIAL'
  | 'PARTIAL_VOLUME'   // ← ADR-0415 신규
  | 'STALE'
  | 'DEGRADED'
  | 'FAILED';
```

타입 이름 (`SectorEnergyDataQuality5`) 보존 — 호출자 정합 보존, value 만 6단계 격상. 사용자 4/30 정책 *"강제 마이그레이션 금지"* 정합 — 기존 영속 데이터 (`'OK'/'PARTIAL'/'STALE'/'DEGRADED'/'FAILED'`) 그대로 보존.

`isSectorEnergyDataQuality5` type guard 6단계 정합 격상.

### 결정 2 — `evaluateSectorEnergyStrongBuyGate` 4 조건 → 6 조건 OR 격상

```typescript
// 조건 1 (ADR-0398): confidence < 0.6 (저신뢰)
// 조건 2 (ADR-0398): dataQuality === 'DEGRADED' (심각한 부족)
// 조건 3 (ADR-0398): dataQuality === 'FAILED' (산출 불가)
// 조건 4 (ADR-0398): sourceTier === 'YAHOO_ETF' (해외 ETF 프록시 보조 신호)
// 조건 5 (ADR-0415 신규): dataQuality === 'STALE' (6-8 섹터, 신뢰도 부족)
// 조건 6 (ADR-0415 신규): dataQuality === 'PARTIAL_VOLUME' (거래량/일부 섹터 누락)
```

### 사용자 명시 정책 SSOT (절대 변경 금지)

| dataQuality | STRONG_BUY | BUY | 출처 |
|-------------|-----------|-----|------|
| OK | ✅ 허용 | ✅ 허용 | ADR-0396 |
| PARTIAL (9-11 섹터) | ✅ 허용 | ✅ 허용 | ADR-0396 |
| **PARTIAL_VOLUME** (거래량 누락) | ❌ 차단 | ✅ 허용 | **ADR-0415 신규** |
| **STALE** (6-8 섹터) | ❌ 차단 | ✅ 허용 | **ADR-0415 격상** |
| DEGRADED (3-5 섹터) | ❌ 차단 | ✅ 허용 | ADR-0398 |
| FAILED (0-2 섹터) | ❌ 차단 | ✅ 허용 | ADR-0398 |
| sourceTier=YAHOO_ETF | ❌ 차단 | ✅ 허용 | ADR-0397 |

**핵심 원칙 (절대 원칙 #1)**: 일반 BUY 진입은 영향 0. 본 게이트는 *STRONG_BUY 등급 승격* 만 결정.

## 절대 원칙

1. **일반 BUY 차단 금지** (절대 원칙 #1) — `evaluator` 시그니처에 `forbidBuy` / `blocked` 필드 부재. STRONG_BUY → BUY 강등만 허용.
2. **타입 이름 보존** (`SectorEnergyDataQuality5` 그대로) — 호출자 정합 보존, value 만 6단계 격상.
3. **영속 데이터 무수정** — 기존 `'OK'/'PARTIAL'/'STALE'/'DEGRADED'/'FAILED'` 그대로 보존. 사용자 4/30 정책 정합.
4. **PARTIAL_VOLUME 자동 분류 wiring 본 PR 미포함** — 거래량 결손 신호 wiring 후속 PR. 본 PR 은 *union value 추가* 와 *evaluator 6 조건 격상* 만.
5. **ADR-0398 SSOT 본체 확장만** — 결정 트리에 2 조건 추가, 시그니처 / NaN fallback / ENV gate 변경 0.
6. **호출자 (buyListLoop ADR-0400 wiring) 자동 흡수** — `evaluateSectorEnergyStrongBuyGate` input 변경 0, 호출자 본체 무수정.
7. **LIVE 주문 함수 / order executor / autoTradeEngine 본체 무수정** (절대 규칙 #2/#3/#4).

## 잘못된 해결 방법 영구 차단

1. **타입 이름 격상** (`SectorEnergyDataQuality5` → `SectorEnergyDataQuality6`) — 50+ 호출자 정합 깨짐, drift 위험. value 확장만.
2. **PARTIAL_VOLUME 자동 분류 본 PR 통합** — 거래량 결손 신호 wiring 은 별도 PR (운영 데이터 누적 후).
3. **`evaluator` 시그니처에 `forbidBuy` 필드 추가** — STRONG_BUY 차단 정책이 일반 BUY 차단으로 잘못 격상될 위험.
4. **ADR-0398 `confidence` 임계값 변경** (0.6 → 다른 값) — 정책 SSOT 영구 보존.
5. **STALE 임계 분기 (validSectorCount 6-8) 변경** — ADR-0396 `SECTOR_QUALITY_THRESHOLDS` SSOT 절대 변경 금지.
6. **영속 마이그레이션 강제** — 기존 영속 데이터 (`'PARTIAL_VOLUME'` 부재) 그대로 보존. 사용자 4/30 정책 정합.

## 회귀 테스트

신규 20 케이스 (`sectorEnergyStrongBuyGateAdr0415.test.ts`):
- SectorEnergyDataQuality5 union 6단계 격상 (PARTIAL_VOLUME type guard 통과 + 기존 5단계 보존 + 알 수 없는 값 차단) — 3 케이스
- STALE STRONG_BUY 차단 (forbidStrongBuy=true + reasons 명시 + 단독 차단) — 2 케이스
- PARTIAL_VOLUME STRONG_BUY 차단 (forbidStrongBuy=true + reasons 명시 + "BUY 까지만" 안내) — 3 케이스
- OK / PARTIAL → STRONG_BUY 허용 (회귀 차단) — 2 케이스
- 기존 ADR-0398 4 조건 회귀 보존 (DEGRADED / FAILED / YAHOO_ETF / 저신뢰) — 4 케이스
- 다중 조건 충돌 (STALE + YAHOO_ETF + 저신뢰 → 3 사유 모두) — 2 케이스
- ENV 우회 (SECTOR_ENERGY_STRONG_BUY_GATE_DISABLED=true → STALE/PARTIAL_VOLUME 도 통과) — 2 케이스
- 절대 원칙 — 일반 BUY 차단 금지 (시그니처에 forbidBuy 필드 부재 + 4 분기 모두 BUY 영향 0) — 2 케이스

기존 정합 정정 1 케이스 — `STALE 단독 → 통과` → `STALE 단독 → 차단` (사용자 명시 ADR-0415 정책 정합).

## ENV 우회

`SECTOR_ENERGY_STRONG_BUY_GATE_DISABLED=true` (기존, ADR-0398) — 본 PR 의 6 조건 모두 동일하게 적용. 활성화 시 STRONG_BUY 게이트 비활성 → ADR-0397 동작 100% 복원 (회귀 1줄 즉시 롤백).

## 운영 효과 (배포 직후)

1. **STALE 누락 결함 차단** — 6-8 섹터 정상 상태에서 STRONG_BUY 자동 강등 → 사용자 자본 보호 격상.
2. **PARTIAL_VOLUME 분류 인프라** — 거래량/일부 섹터 누락 시나리오 표현 가능 (자동 분류 wiring 후속 PR).
3. **일반 BUY 영향 0** — 절대 원칙 #1 정합. 섹터에너지 신뢰도 부족 시에도 개별 종목 수급/기술/펀더멘털 우선 정책 보존.
4. **호출자 (ADR-0400 buyListLoop wiring) 자동 흡수** — input 변경 0, 호출자 본체 무수정.
5. **회귀 1줄 즉시 롤백 가능** — `SECTOR_ENERGY_STRONG_BUY_GATE_DISABLED=true` ENV 1줄.

## 잔여 후속 PR (scope 외)

1. **PARTIAL_VOLUME 자동 분류 wiring** — `buildSectorEnergyQualityComposite` 또는 별도 헬퍼에서 *거래량 결손 신호* (sectorEnergyProvider 의 volume 데이터 검증) 검출 후 `'PARTIAL_VOLUME'` 자동 분류. 운영 데이터 1주 누적 후 임계 결정.
2. **`/sector_energy_diag` 명령 격상** — PARTIAL_VOLUME / STALE 상태 운영자 노출 (현재 5단계 union 표시 → 6단계 격상).
3. **PENDING_WIRING 등재** — Stage 2 wiring 잔여 항목 별도 PR.

## 거버넌스 정합

- ADR-0146 PR 자가 review 5 카테고리 모두 PASS.
- ADR-0148 4 정적 검증 baseline 무회귀.
- ADR-0157 ENV 정확 비교 의무 무관 (본 PR ENV 신규 도입 0건).
- ADR-0159 별칭 정책 정합 (충돌 부재 — 별칭 부여 0).
