# ADR-0092 — 매매 채널 청산 알림 누적 잔량 정합 (사용자 보고 SK이노베이션)

**상태**: Accepted (PR-Z5)
**작성일**: 2026-04-29
**관련**: ADR-0006 (Attribution composite key), ADR-0028 (exitEngine 분해)

## 배경

사용자 보고 (4/29 텔레그램 매매 채널 SK이노베이션 096770):

| 시각 | 청산 규칙 | 청산 수량 | **채널 알림** | **정확한 잔여** |
|------|-----------|-----------|---------------|----------------|
| 08:05 | 분할 익절 50% | 2주/원래 4주 | 잔여 2주 ✅ | 2주 |
| 08:35 | RRR 붕괴 25% | 1주/원래 4주 | 잔여 **3주 ❌** | 1주 |
| 08:40 | 분할 익절 25% | 1주/원래 4주 | 잔여 **3주 ❌** | 0주 |

봇 채널의 SHADOW 가상 체결 알림은 **잔여: 0주** 정확히 표기 (08:40), `/reconcile` 도
변경 사항 0건 — **서버 fills SSOT (`getRemainingQty`) 는 정상**, **매매 채널 메시지
빌더만 잘못 계산**.

## 근본 원인

`server/alerts/channelPipeline.ts:135` (변경 전):

```ts
const remaining = isPartial ? p.originalQty! - p.soldQty! : 0;
```

호출자가 전달:
- `originalQty: shadow.originalQuantity` (최초 매수 수량 = 4주)
- `soldQty: sellQty` (이번 회차 청산 수량 = 1주)

→ `remaining = 4 - 1 = 3주` (잘못, 누적 매도 fill 미반영).

반면 `reserveSell()` 가 `appendFill('SELL') + getRemainingQty(shadow)` 로 정확한
누적 잔량을 반환하지만 (예: 4주 → 50% 청산 후 2주 → RRR 25% 청산 후 1주),
9 호출자(rrrCollapseExit / cascadeFinal / trancheTakeProfitLimit / trailingStop /
ma60DeathForceExit / euphoriaPartialExit / legacyTakeProfit / hardStopLoss /
bearishDivergenceExit) 모두 그 결과를 *텔레그램 알림에는 사용*하면서도
**매매 채널 알림에는 전달하지 않음** — 정보 단절.

## 결정

`ChannelSellSignalParams` 에 옵셔널 `remainingQtyAfter` 필드 추가.

### 1. `channelPipeline.ts` 빌더 우선순위 SSOT

```ts
const hasAccurateRemaining = typeof p.remainingQtyAfter === 'number'
  && Number.isFinite(p.remainingQtyAfter)
  && p.remainingQtyAfter >= 0;
const isPartial = hasAccurateRemaining
  ? p.remainingQtyAfter > 0
  : (p.soldQty !== undefined && p.originalQty !== undefined && p.soldQty < p.originalQty);
const remaining = hasAccurateRemaining
  ? p.remainingQtyAfter
  : (isPartial ? p.originalQty - p.soldQty : 0);
```

- **명시 시**: fills SSOT 누적 반영된 정확한 잔량 사용 — 사용자 보고 시나리오 해소.
- **미명시 시**: 기존 `originalQty - soldQty` 폴백 — 후방호환 보장.
- **NaN/음수 입력**: 안전 폴백 자동 작동.
- **remainingQtyAfter=0 + 부분청산 의도**: isPartial=false 자동 격상 → "전량청산"
  라벨로 자연 전환 (마지막 회차 = 전량청산 사실 반영).

### 2. 9 호출자 wiring

각 청산 규칙에서 `reserveSell()` 결과 변수의 `.remainingQty` 를 채널 알림에 전달:

```ts
await channelSellSignal({
  ...
  soldQty:     sellQty,
  originalQty: shadow.originalQuantity,
  remainingQtyAfter: rrrReserve.remainingQty, // ADR-0092 신규
}).catch(console.error);
```

### 3. 5 전량청산 호출자 부수 효과

`cascadeFinal` / `trailingStop` / `ma60DeathForceExit` / `legacyTakeProfit` /
`hardStopLoss` 5 규칙은 `originalQty` 미명시 → 항상 *전량청산* 라벨이었음. 본 PR
에서 `remainingQtyAfter` 추가로 LIVE 부분 체결 시나리오 (KIS 가 일부만 응답) 도
자동 부분청산 라벨 격상 가능 — **운영 정확성 추가 격상**.

## 회귀 테스트

`channelPipelineRemainingQty.test.ts` 10 케이스:
- 사용자 보고 시나리오 3 (50% / 25% / 25% 누적)
- 후방호환 2 (remainingQtyAfter 미전달)
- 안전 가드 3 (NaN / 음수 / 0+부분청산 의도)
- 5 전량청산 호출자 패턴 2 (LIVE 부분 체결 자동 격상)

## 비결과 (out-of-scope)

- **fills SSOT 자체 변경**: `getRemainingQty(shadow)` / `appendFill` 정상 동작
  확인됨 — 변경 없음.
- **봇 채널 (SHADOW 가상 체결) 알림**: 본 PR 영향 없음 — `reserveSell` 결과를
  이미 정확히 사용 (이미지 6 의 "잔여: 0주" 정상 표기).
- **`/pos` `/pnl` 명령**: fills SSOT 직접 사용 — 본 PR 영향 없음.
- **추가 채널 알림 정보 (예: 누적 실현손익)**: 후속 PR.

## 운영 효과

배포 후 사용자 보고 시나리오 (4주 누적 부분청산):

**기존 동작**:
1. 50% 청산 → 잔여 2주 ✅ (첫 회차라 우연히 정확)
2. 25% RRR 청산 → 잔여 3주 ❌ (누적 미반영)
3. 25% 분할 익절 → 잔여 3주 ❌ (또 누적 미반영)

**본 PR 후**:
1. 50% 청산 → 잔여 2주 ✅
2. 25% RRR 청산 → 잔여 1주 ✅ (fills SSOT 누적 반영)
3. 25% 분할 익절 → 잔여 0주 → "전량청산" 라벨 자동 격상 ✅

## 회귀 위험 평가

- **LIVE 매매 본체 0줄 변경** — 청산 결정 로직, KIS 호출, fills SSOT 모두 무수정.
- **메시지 빌더만 변경** — `isPartial` 분기 + `remaining` 계산이 호환 모드 (구
  호출자 폴백 + 신규 호출자 정확) 양쪽 모두 동작.
- **회귀 테스트 36 files 352/352 pass** (server/alerts + server/trading/exitEngine
  전체).
- **9 호출자 일관 wiring** — drift 위험 차단.

## 후속 PR 후보

- **봇 채널 `[SHADOW] 익절` 알림**: 사용자 이미지 8:40 의 봇 채널 알림 (수량: 1주)
  도 동일 정확성 확보 가능 — 본 PR 의 `remainingQtyAfter` 패턴 확장.
- **누적 실현손익 라인**: "잔여 보유: 1주 | 누적 실현: +5.2%" 형식.
- **부분청산 진행률 시각화**: "이번 회차 25% × 3차 (총 75%)" 형식.
