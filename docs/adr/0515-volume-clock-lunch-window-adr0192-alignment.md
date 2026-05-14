# ADR-0515 — Volume Clock 점심 차단 ADR-0192 정합 (11:31~12:59 → 12:00~12:59)

@responsibility volumeClock 점심 차단 SSOT 를 ADR-0192 매매 시간 정책에 정합 — 운영 환경 11:30~12:59 sell-only 결함 차단.

## 컨텍스트

사용자 5/14 보고 — sell-only 시간대가 의도(점심 12:00~12:59)와 다르게 **실제 운영에서 11:30~12:59** 로 관측됨.

점검 결과 매매 시간대 SSOT 가 2개로 갈라져 있고, ADR-0192(2026-05-06) 가 한쪽만 갱신했다.

| | 점심 차단 | 갱신 여부 |
|---|---|---|
| `adaptiveScanScheduler.decideScan` | **12:00~13:00** | ADR-0192 적용됨 |
| `volumeClock.ts` (`checkVolumeClockWindow`) | **11:31~12:59** | ADR-0237 그대로, 미갱신 |

**실제 매수 차단을 결정하는 것은 `volumeClock.ts`** 이다. `signalScanner/preflight.ts:459` 가
`sellOnlyMode: optSellOnly === true || !volumeClock.allowEntry` 로 매수 차단을 건다. `decideScan` 의
`priority` 는 스캔 빈도/모드 표시이고, 실제 진입 차단은 volumeClock 이 수행한다.

→ 사용자가 본 **11:30~12:59 sell-only** 는 `volumeClock.ts:30` 의 `11:31~12:59` 차단창과 정확히 일치한다.
ADR-0192 변경 이력은 `adaptiveScanScheduler.ts` 만 수정했다고 명시 — `volumeClock.ts` wiring 누락.

## 결정

### 결정 1 — `volumeClock.ts` 점심 차단 12:00~12:59 정합

`BLOCKED_WINDOWS` 점심 구간 `11:31~12:59` → `12:00~12:59` (ADR-0192 `decideScan` 정합).

`TIME_ZONES` 의 `11:00~11:30 (-1점)` 구간을 `11:00~11:59 (-1점)` 로 확장 — 점심 차단이 12:00 으로
후퇴하면서 생긴 `11:31~11:59` 빈틈을 흡수. 빈틈을 방치하면 `checkVolumeClockWindow` 의 fallback
("어느 구간에도 해당하지 않음 → `allowEntry: false`") 로 여전히 차단되기 때문.

매수 허용 구간: `09:30~11:30 + 13:00~15:20` → **`09:30~11:59 + 13:00~15:20`**.

### 결정 2 — `TRADE_WINDOW_LEGACY_HOURS` ENV 단일 통로

`adaptiveScanScheduler` / `isBuyableKstWindow` 가 이미 사용하는 ENV `TRADE_WINDOW_LEGACY_HOURS=true`
를 `volumeClock.ts` 도 honor — `BLOCKED_WINDOWS_LEGACY` (점심 11:31~12:59) + `TIME_ZONES_LEGACY`
(11:00~11:30) 로 ADR-0237 동작 100% 복원. ENV 1개로 모든 매매 시간대 SSOT 가 일관되게 롤백.

`isVolumeClockLegacyHours()` SSOT 헬퍼 — 호출자 측 inline ENV 검사 0건.

### 결정 3 — 마감 차단(15:21~15:30)은 본 PR scope 외

사용자 인지(15:20~15:30)와 현재 `volumeClock`(15:21~15:30)이 일치하므로 변경하지 않음.
`decideScan`(15:00~15:30, ADR-0122) 과의 오후 마감 불일치는 *별도* 결함 — 30분 추가 매수 차단이라
LIVE 영향이 크고 본 보고와 무관. 잔여 후속 PR.

## 불변식

- LIVE 매매 본체 0줄 변경 (`signalScanner.ts` / `signalScanner/**` / `entryEngine.ts` / `exitEngine/**` /
  `kisClient/**` / `orchestrator/**` / `autoTradeEngine*` / `trancheExecutor.ts` / `buyPipeline.ts` — preflight.ts 는 로그 문자열 1줄만)
- KIS/KRX/Yahoo/Naver outbound 0 (순수 시간 계산 함수)
- Gate threshold + condition weight + STRONG_BUY 조건 변경 0
- `checkVolumeClockWindow` 시그니처 무변경 (`now?: Date` → `VolumeClockResult`) — 21 외부 importer 무수정
- ENV `TRADE_WINDOW_LEGACY_HOURS=true` 정확 비교 (ADR-0157) 1줄 즉시 ADR-0237 동작 100% 복원
- 호출자 측 inline ENV 검사 0건 (`isVolumeClockLegacyHours()` SSOT 위임)

## 잘못된 해결 방법 영구 차단

- `decideScan` 의 점심창을 11:31 로 되돌려 맞춤 — ADR-0192 정책 역행
- `volumeClock` 점심창만 12:00 로 옮기고 `11:31~11:59` 빈틈 방치 — fallback 으로 여전히 차단
- 호출자 측 inline `process.env.TRADE_WINDOW_LEGACY_HOURS` 검사 — drift 위험
- 마감 차단(15:21)을 본 PR 에서 15:00 으로 변경 — 사용자 보고 무관 + LIVE 영향 큼 (별도 PR)

## 회귀 테스트

`server/trading/volumeClock.test.ts` — 점심 차단 12:00~12:59 정합 + 11:00~11:59 -1점 확장 +
11:59→12:00 경계 전환 + legacy 모드 (TRADE_WINDOW_LEGACY_HOURS=true) 7 케이스 (11:31 차단 보존 등).
