# ADR-0104 — 게이팅 알림 시간 윈도우 + FOMC DAY 청산 라벨 분리

> **번호 재할당 노트** (2026-04-29): main #428 (ConfluenceMeter wiring) 이 ADR-0102
> + main #429 (Ribbon/IDontKnow wiring) 가 ADR-0103 을 먼저 사용 → 본 ADR
> 0102 → 0103 → **0104** 로 재할당. 코드 주석·테스트 어구도 모두 0104 로 갱신.
>
> **Track 3 hotfix 추가 (2026-04-29 운영 보고)**: 사용자 14:30 KST FOMC DAY
> 청산 알림 5건 발송됐으나 /pos /pnl 결과 잔고 *원본 수량 그대로*. 원인:
> `liquidateAllForFomc` 가 `reserveSell` 호출로 in-memory `trade.fills` /
> `trade.quantity` 변경했지만 **`saveShadowTrades(trades)` 호출 부재**로
> 디스크 영속화 누락. 다음 cron `loadShadowTrades()` 가 원본 수량 재로드 →
> 청산이 *한 번도* 작동 안 함. 본 PR 에서 hotfix 통합 — 영속 호출 추가 +
> 회귀 테스트 5 케이스 (SHADOW/LIVE/dryRun/active=0/throw graceful).

## Status
Accepted (2026-04-29)

## Context

사용자 4/29 FOMC DAY 운영 보고 2건:

1. **FOMC 게이팅 알림 도배** — `📅 [FOMC 게이팅] 신규 진입 차단` 메시지가 14:30
   KST (사용자 베이징 시간 13:30) 같은 부적절한 시간대에도 발송. ADR-0093 (PR-Z6)
   가 dedupeKey + 12h cooldown 으로 매분 도배는 차단했지만 *발송 시각 자체* 는
   제어 안 됨. 사용자 명시 의도: "장시작 + 장마감 2회만".

2. **FOMC DAY 14:30 일괄 정리 메시지가 손절로 표현** — ADR-0061 (FOMC DAY
   Liquidation) 의 `liquidateAllForFomc()` 가 `placeKisSellOrder(..., 'STOP_LOSS')`
   호출. 결과 텔레그램 메시지가 `🔴 [SHADOW 손절] 코스맥스 (192820)` 형식으로
   손절 emoji + label 사용. 사용자 보고: *"수익인 종목도 손실 표현됨 — 오해 소지"*.

두 이슈 모두 매매 본체 결정 로직과 무관한 *알림 라벨링* 결함. 단일 PR 통합 처리.

## Decision

### Track 1 — 게이팅 알림 시간 윈도우 SSOT (`server/utils/gatingAlertWindow.ts`)

KST 시각 기준 두 윈도우 안에서만 게이팅 차단 알림 발송:

| Session | KST 윈도우 | 의도 |
|---------|-----------|------|
| OPEN  | 09:00 ≤ t < 10:00 | 장시작 직후 — 09:00 cron 1회 발송 |
| CLOSE | 15:00 ≤ t < 16:00 | 장마감 ~ KIS 종가 직후 — 15:30 근처 |
| 그 외 | 발송 안 함 | 14:30 FOMC DAY 청산 같은 시간 자동 차단 |

**dedupeKey 합성**: `${prefix}:${date}:${session}` 형식 — open/close 별 분리
dedupeKey 로 1일 2회 발송 *최대* 보장 (12h cooldown 그대로 유지 — 한 윈도우 안
첫 호출만 발송).

**ENV 우회**: `GATING_ALERT_WINDOW_DISABLED=true` 시 모든 시간대 발송 허용
(운영 비상 / 후속 PR 진단용).

**적용 대상 4 site**:
- `signalScanner.ts` VIX 게이팅 차단 알림
- `signalScanner.ts` FOMC 게이팅 차단 알림
- `signalScanner/preflight.ts` VIX 게이팅 차단 알림
- `signalScanner/preflight.ts` FOMC 게이팅 차단 알림

**비적용 (보존)**:
- 운영자 비상 알림 (R6_DEFENSE / 비상정지 / Kill Switch / 손절 도달 등) — 시간
  무관 발송 유지 (진짜 위험 신호는 제때 인지 필수).
- FOMC DAY 사전 경보 (`runFomcDayMorningAlert` 09:00 / `runFomcDayPreLiquidationAlert`
  14:00) — 이미 cron 시각 자체가 OPEN 윈도우 또는 그 외 명시적 타이밍.

### Track 2 — FOMC DAY 청산 라벨 분리

`placeKisSellOrder` reason union 확장:

```ts
reason: 'STOP_LOSS' | 'TAKE_PROFIT' | 'EUPHORIA' | 'FOMC_DAY_LIQUIDATION'
```

| reason | emoji | 한국어 라벨 |
|--------|-------|------------|
| STOP_LOSS | 🔴 | 손절 |
| TAKE_PROFIT | 🟢 | 익절 |
| EUPHORIA | 🌡️ | 과열부분매도 |
| **FOMC_DAY_LIQUIDATION** | **📅** | **FOMC 자동청산** |

**호출자 wiring**:
- `fomcDayLiquidation.liquidateAllForFomc` 의 `placeKisSellOrder(..., 'STOP_LOSS')`
  → `placeKisSellOrder(..., 'FOMC_DAY_LIQUIDATION')`
- `addSellOrder({ originalReason: 'STOP_LOSS' })` → `'FOMC_DAY_LIQUIDATION'`

**fillMonitor 정합**: `PendingSellOrder.originalReason` union 동기화 +
`originalReasonLabel(reason)` 헬퍼로 LIVE 체결 확인 메시지가 `FOMC_DAY_LIQUIDATION`
같은 raw enum 노출 안 하도록 한국어 라벨 사용.

**SHADOW 모드 효과** (사용자 보고 시나리오 직접 해소):

```
이전: 🔴 [SHADOW 손절] 코스맥스 (192820)         ← 수익 종목도 손실 표현
이후: 📅 [SHADOW FOMC 자동청산] 코스맥스 (192820) ← 손익 중립 라벨
```

**LIVE 모드 효과**:
- placeKisSellOrder LIVE 분기: `📅 [FOMC 자동청산] 코스맥스 (192820)` 발송 +
  체결 후 fillMonitor 가 `사유: FOMC 자동청산` 한국어 라벨로 표시.

## Consequences

### 즉시 효과 (배포 후)

1. **게이팅 알림 빈도**: 14:30 KST 같은 부적절 시각 발송 영구 차단. 1일 최대
   2회 (09:00 OPEN + 15:30 CLOSE) 발송. 사용자 인지 부담 ↓.
2. **FOMC DAY 청산 메시지 정확성**: 수익/손실 무관한 자동 정책 청산이 `📅 FOMC
   자동청산` 으로 표기 → 사용자가 "수익인데 왜 손실?" 같은 오해 차단.

### 회귀 위험 격리

- 두 변경 모두 *알림 라벨링* 만 — 매매 본체 결정 로직 (Gate / Kelly / 청산 트리거)
  무수정.
- ENV 롤백 (`GATING_ALERT_WINDOW_DISABLED=true`) 1줄로 즉시 PR-Z6 동작 복원.
- ADR-0093 dedupeKey + 12h cooldown 안전망 그대로 유지 (윈도우 안에서도 첫 호출
  1회 보장).

### 후속 PR (scope 외)

- 게이팅 알림 *해제* 알림 (VIX/FOMC 정상 회복 시점) — 운영자 인지 정책 확장.
- 데이터 빈곤 게이트 (`R6_DEFENSE` / `data_starvation`) cooldown 정책 통일.
- 일반화: 다른 정기 발송 메시지 (`channelMarketBriefing` 등) 도 윈도우 정책 적용
  검토.

## References

- ADR-0061 — FOMC DAY 자동 청산 정책 (정책 본체)
- ADR-0093 — FOMC/VIX 게이팅 알림 dedupeKey + 12h cooldown (선행 작업)
- ADR-0017 — Telegram Stage 1 메뉴 압축 (사용자 인지 부담 SSOT 패턴)
- 사용자 보고 (2026-04-29 FOMC DAY) — 베이징 13:30 = KST 14:30 도배 + SHADOW
  손절 5건 동시 발송 이미지 (191300 / 161890 / 383310 / 047050 / 238490)
