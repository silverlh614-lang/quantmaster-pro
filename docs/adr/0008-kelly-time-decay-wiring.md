# ADR-0008: kellyHalfLife 실 사이징 연결 + effectiveKelly 이름 충돌 해소

- 상태: 채택
- 날짜: 2026-04-24
- 작성: QuantMaster Harness (architect)
- 선행: ADR-0006, PR-11 (entryKellySnapshot)
- 관련 PR: PR-22

## 배경

`kellyHalfLife.ts` 헤더는 설계 의도를 명시한다:

> effectiveKelly(t) = entryKelly × exp(-λt) — 시간 자체가 음의 weight 를 만든다.
> 후회 회피 편향(loss aversion, disposition effect) 에 대한 구조적 방벽.

그러나 현재 실 포지션 사이징 경로는 이 시간감쇠를 전혀 쓰지 않는다:

- `sizingTier.ts:153` — `const effectiveKelly = Math.min(safeRaw, gradeCap)`
  (tier × gradeCap 정적 계산, 시간감쇠 없음)
- `accountRiskBudget.ts:269` — `effectiveKelly: kelly.capped` (Fractional Kelly
  캡 후, 시간감쇠 없음)

두 모듈이 모두 `effectiveKelly` 라는 **동명 필드**를 쓰지만 의미가 다르다. 사용자
지적:

> 변수명 충돌로 겉보기엔 연결된 것처럼 보이니 더 위험.

`kellyHalfLife` 는 실제로 `kellyHealthCard.ts:30,184` (/kelly 헬스 카드) 와
`kellyDriftFailurePromotion.ts:31,64,66` (승급 키) 에서만 소비되고, 사이징 경로
와 무관하다.

## 결정

### 1. 이름 분리 — effectiveKelly → staticKelly / decayedKelly

`sizingTier.SizingResult` 와 `accountRiskBudget.SizePositionOutput` 의
`effectiveKelly` 필드를 의미별로 분리:

- `staticKelly: number` — 시간감쇠 전의 capped Kelly (기존 `effectiveKelly`).
- `decayedKelly: number` — 시간감쇠를 적용한 최종 Kelly. 진입 시점에는
  `decayedKelly === staticKelly`.

`kellyHalfLife.HalfLifeSnapshot.effectiveKelly` 는 `decayedKelly` 로 rename
하여 동명이인 해소. snapshot 내부 의미는 변하지 않음.

### 2. sizePosition 에 timeDecayInput 옵션 추가

```ts
export function sizePosition(input: {
  // ...기존 필드
  timeDecayInput?: { daysHeld: number; halfLifeDays: number };
}): SizePositionOutput
```

- `timeDecayInput` 미제공: `decayedKelly = staticKelly` (신규 진입 기본).
- 제공: `decayedKelly = staticKelly × computePositionRiskWeight(daysHeld, halfLifeDays)`.
- KellyCoverageRatio·원화 배분·최종 수량 계산은 **decayedKelly 기준**.

진입 시점 (daysHeld = 0) 에는 weight = 1 이므로 **기존 신규 진입 사이징과 수학적
완전 동치**. 회귀 위험 없음.

### 3. 트림 경로는 기존 유지

`kellyHealthCard.recommendations` 의 `TRIM_CANDIDATE` 판정은 기존대로
`halfLifeSnapshot.timeDecayWeight < 0.5` 를 사용. 본 ADR 은 "사이징 레벨" 연결만
추가, 트림 정책 변경 없음.

### 4. Feature Flag

```
KELLY_TIME_DECAY_ENABLED  (default: true)
```

`false` 로 두면 `sizePosition` 이 `timeDecayInput` 을 받아도 `decayedKelly = staticKelly`
로 단락. 긴급 롤백용. 배포 직후 48h 는 true 로 돌리고 거래 기록 확인.

### 5. 호출 지점 wiring

현재 신규 진입 경로:
- `signalScanner.ts:1403` — `sized.effectiveKelly` 저장.
  → `sized.staticKelly` 로 필드명 업데이트. `decayedKelly` 도 함께 저장.

현재 트레일링 경로 (기존 포지션):
- `exitEngine` / `kellyHealthCard` 의 "current Kelly" 계산 시점.
  → `halfLifeSnapshot` 을 이미 호출하므로, 그 결과의 `daysHeld/halfLifeDays` 를
    `sizePosition({ timeDecayInput })` 로 전달.
  → 본 ADR 은 wiring 설계만 확정. 실제 코드 경로 재계산은 engine-dev 가 판단.
    (kellyHealthCard 가 이미 `currentLiveKelly = snap.effectiveKelly × (currentIps/entryIps)`
    식으로 해오던 계산을 `sizePosition` 기반으로 대체할지는 최소 침습 원칙에 따라
    결정 — 이번 PR 에서는 **새 진입 경로만 wiring**, 트레일링은 후속 PR.)

## 이번 PR 의 실제 코드 변경 최소 집합

**서버 타입 & 사이징 계산:**
1. `sizingTier.ts`: `SizingResult.effectiveKelly` → `SizingResult.staticKelly` rename.
2. `accountRiskBudget.ts`: `SizePositionOutput` 에 `staticKelly`, `decayedKelly`
   병기. `computeKellyCoverageRatio` 는 decayedKelly 기반. `sizePosition` 시그니처
   에 `timeDecayInput?` 추가. `KELLY_TIME_DECAY_ENABLED` 체크.
3. `kellyHalfLife.ts`: `HalfLifeSnapshot.effectiveKelly` → `decayedKelly` rename.
4. 호출부 (signalScanner / entryEngine / kellyHealthCard) 필드명 업데이트.

**테스트:**
5. `sizingTierCompose.test.ts` 의 `effectiveKelly` → `staticKelly` 업데이트.
6. `kellyCoverage.test.ts` 의 동등 업데이트 — coverage 계산 기준은 `decayedKelly`.
7. 신규 `accountRiskBudgetTimeDecay.test.ts`:
   - daysHeld=0 이면 `decayedKelly === staticKelly` (진입 등가성)
   - daysHeld=halfLife 면 decayedKelly ≈ staticKelly × 0.5
   - `KELLY_TIME_DECAY_ENABLED=false` 시 단락
   - halfLifeDays ≤ 0 은 no-op

**그 외는 전부 scope 밖** — signalScanner 의 `effectiveKelly` 저장 필드도 같은
이름을 유지할 필요 없음. shadowTrade schema 에 이미 `entryKellySnapshot` 이
있으므로 진입 시점 static 값이 그대로 남는다. 시간감쇠는 런타임 계산.

## 의미 체계 정리 (혼동 방지 표)

| 기호 | 의미 | 어디서 계산 |
|------|------|-------------|
| `entryKelly` | 진입 시점의 snapshot 값 (`entryKellySnapshot.kelly`) | `exitEngine` 이 진입 시점 기록 |
| `rawKelly` | tier × gradeCap 전의 원시 Kelly | `sizingTier` |
| `staticKelly` | tier × cap 후, 시간감쇠 **전** | `sizingTier` / `accountRiskBudget` |
| `decayedKelly` | staticKelly × exp(-λ · daysHeld) | `accountRiskBudget` (timeDecayInput 이 있을 때) |
| `currentLiveKelly` | IPS/ATR 등 런타임 요소까지 적용한 현행 Kelly | `kellyHealthCard` |

## 검증

- 기존 `sizingTierCompose.test.ts`, `kellyCoverage.test.ts` 필드 rename 후 pass.
- 신규 `accountRiskBudgetTimeDecay.test.ts` (위 4 케이스).
- `npm run validate:all`, `npm run precommit` 통과.
- 진입 등가성 수동 검증: 동일 종목 진입 시 PR-21 대비 수량 변화 없어야 함
  (daysHeld=0 이므로 weight=1).

## 롤백

- `KELLY_TIME_DECAY_ENABLED=false` 배포 → 기존과 동일 동작.
- 필드명 rename 은 호출부 일괄 업데이트라 소스 레벨 rollback 은 commit revert.
