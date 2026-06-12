# ADR-0607: LIVE 모드 SHADOW 메시지 CH4(JOURNAL) 격리 (ENV 게이트, default OFF byte-equivalent)

@responsibility policy — LIVE 모드일 때 SHADOW 신호/메시지를 CH4(SYSTEM/JOURNAL)로 격리해 CH1(EXECUTION)/CH2(SIGNAL)을 LIVE 체결·신호 전용으로 비우는 채널 라우팅 게이트 (default OFF byte-equivalent)

## Status

Accepted

> LIVE 전환 사전작업 A1. engine-dev 단독 — Telegram 단일 도메인.
> ENV `LIVE_SHADOW_QUIET_ENABLED` default OFF → 현재 SHADOW(OFF/PAPER) 운영 영향 0.

## Context

### 사용자 결정 (확정 — 변경 금지)

1. **LIVE 모드(`getExecutionMode()==='LIVE'`)일 때 SHADOW 신호/메시지를 CH4(JOURNAL/SYSTEM)로 격리**.
   CH1(EXECUTION)/CH2(SIGNAL)은 LIVE 체결·신호 전용으로 비운다.
2. **현재 SHADOW(OFF/PAPER) 운영 중에는 기존 CH2 라우팅 그대로** (영향 0).
3. **최소 골격** — 과도한 신규 인프라 금지.

### 문제 — LIVE 전환 시 CH1/CH2 가 SHADOW 노이즈와 섞인다

ADR-0393 모델에서 SHADOW(학습 layer)는 모든 ExecutionMode(OFF/PAPER/LIVE)에서 always-on 이다.
LIVE 전환 후에도 SHADOW 매수 신호가 CH2(SIGNAL)로, SHADOW 청산이 CH1(EXECUTION)로 계속 흘러가면,
운영자가 *실제 LIVE 체결·신호* 와 *가상 SHADOW 학습 신호* 를 한 채널에서 구분해야 한다 — LIVE 매매
관제의 신호 대 잡음비가 떨어진다. CH1/CH2 를 LIVE 전용으로 비우고 SHADOW 는 CH4(메타 학습 저널)로
모으는 것이 사용자 의도.

### 채널 의미 결정 SSOT 와 SHADOW 발송 경로 (탐색 확정)

- **채널 의미(route) SSOT:** `server/alerts/telegramEventRouter.ts` `routeTelegramEvent(type)`
  → EXECUTION/SIGNAL/REGIME/JOURNAL/PRIVATE. `SHADOW_SIGNAL_EVENTS`(`SHADOW_BUY_SIGNAL`/
  `SHADOW_SELL_SIGNAL`)는 `SIGNAL_EVENTS` 에 포함 → CH2.
- **실제 SHADOW 매수 신호 CH2 발송:** `server/alerts/channelPipeline.ts` `channelBuySignalEmitted`
  — `p.mode`('SHADOW'|'LIVE') 를 받는 mode-aware chokepoint(`approvalQueue.ts:130` 가 주입).
  `dispatchAlert(ChannelSemantic.SIGNAL, message)`.
- **`dispatchAlert(category,...)`:** `server/alerts/alertRouter.ts` — category(채널)만 받음
  (SHADOW 여부 모름). 따라서 SHADOW 격리는 *dispatchAlert 호출 전* 에 route 를 결정해야 한다.
- **`getExecutionMode`:** `server/state.ts` (ADR-0393/0395 SSOT). `alerts/` → `state.ts` → `persistence/*`
  체인은 `alerts/` 로 되돌아오지 않음 (순환 의존 없음 — 아래 §순환 의존 처리).

### 범위 확정 — `channelSellSignal` 은 본 ADR scope 제외 (follow-up)

탐색 결과 `channelSellSignal`(channelPipeline.ts)은:
1. **`mode` 파라미터가 없다** — `ChannelSellSignalParams` 에 mode/isShadow 필드 부재.
2. **CH1(EXECUTION)으로 발송한다** (CH2 SIGNAL 아님).
3. **호출자 ~9개가 `server/trading/exitEngine/rules/*`** 이며 mode-agnostic `shadow` ledger 위에서
   동작한다 (LIVE/SHADOW 분기는 하류 `placeReservedSellOrder`/`reserveSell` 가 결정).

여기에 격리를 적용하려면 exit-engine 도메인 9개 파일에 mode 를 배선해야 한다 — **Telegram 단일
도메인** 과 **최소 골격** 제약 위반. 또한 `emitTelegramEvent({type:'SHADOW_SELL_SIGNAL'})` 의
프로덕션 호출자는 0건(taxonomy 정의만 존재, `shadowPositionLifecycle.emitShadowSellSignal` 은
ledger 영속 전용으로 Telegram 미발송)임을 확인했다. 따라서 SHADOW 청산 CH1 격리는 **후속 Phase**
로 분리하고, 본 ADR 은 CH2(SIGNAL) SHADOW 신호 격리에 집중한다 (사용자 "최소 골격" 정합).

개인 DM(`sendPrivateAlert` SHADOW 경로)도 본 scope 제외 — 채널 라우팅만 (개인 회선은 별개).

## Decision

### ① 신규 순수 SSOT — `server/alerts/shadowQuietRouting.ts`

provider/store/now 호출 0 의 순수 헬퍼 2종:

- **`isLiveShadowQuietEnabled(): boolean`** = `process.env.LIVE_SHADOW_QUIET_ENABLED === 'true'`
  (정확 비교 — '1'/'TRUE' 등은 OFF). default 미설정 = OFF.
- **`resolveShadowChannelRoute(intendedRoute, isShadow): TelegramEventRoute`** — 격리 3중 AND:
  `isShadow && isLiveShadowQuietEnabled() && getExecutionMode() === 'LIVE'` → `ChannelSemantic.JOURNAL`(CH4).
  그 외 전부 `intendedRoute` 그대로 반환 (byte-equivalent). 단락 평가로 OFF 시 `getExecutionMode`
  미호출.

격리는 "채널 *의미*(route)" 만 바꾼다 — channel ID(`TELEGRAM_*_CHANNEL_ID`)는 만지지 않으며
severity/dedup/HTML 정제(06-telegram-policy)는 호출측에서 그대로 보존된다.

### ② 적용 지점 (2곳)

1. **`routeTelegramEvent` (taxonomy SSOT):** SIGNAL 반환 분기를
   `return resolveShadowChannelRoute(ChannelSemantic.SIGNAL, SHADOW_SIGNAL_EVENTS.has(type))` 로 교체.
   비-SHADOW SIGNAL 이벤트(BUY_SIGNAL 등)는 `isShadow=false` 라 항상 SIGNAL 유지. EXECUTION/REGIME/
   JOURNAL/PRIVATE 분기 무변경. (현재 `emitTelegramEvent({type:'SHADOW_*_SIGNAL'})` 프로덕션 호출자
   0건 — 방어적 게이트 + 미래 호출자 자동 격리.)
2. **`channelBuySignalEmitted` (실제 CH2 발송):** `dispatchAlert(ChannelSemantic.SIGNAL, message)` 를
   `const buySignalRoute = resolveShadowChannelRoute(ChannelSemantic.SIGNAL, p.mode === 'SHADOW');
   dispatchAlert(buySignalRoute, message)` 로 교체. LIVE 신호(`p.mode==='LIVE'`)는 `isShadow=false` 라
   항상 CH2. 이것이 현재 SHADOW 운영의 *실효* 격리 지점.

### ③ ENV 게이트 — `LIVE_SHADOW_QUIET_ENABLED` (default OFF)

`.env.example` 채널 rollout 스위치 블록 직후 등재. OFF(미설정/그 외) = 두 적용 지점 모두
byte-equivalent(SHADOW→CH2 유지). ON + LIVE 일 때만 SHADOW→CH4. 1줄 롤백.

### 순환 의존 처리

`alerts/shadowQuietRouting.ts` → `state.js` (`getExecutionMode`) **정적 import**. 검증:
- `state.ts` 는 `persistence/executionModeOverrideRepo.ts` + `persistence/macroEntryOverrideRepo.ts`
  만 import — 둘 다 `alerts/` 미import.
- `telegramEventRouter.ts` 가 끌어오는 `channelStatsRepo.ts` 는 `alertCategories.ts`(leaf enum)만
  import — `state.ts` 로 되돌아오지 않음.

→ `alerts → state → persistence` 단방향, 사이클 없음. **lazy import 불필요**, 정적 import 채택.

## Consequences

- **executionImpact:** OFF(default) = NONE (byte-equivalent). ON + LIVE = SHADOW 신호 채널 의미만
  CH2→CH4 (실주문/SourceSnapshot/Gate/사이징/Shadow 학습 로직 무접촉). **LIVE 매매 본체 0줄, KIS 호출 0.**
- **9대 불변식:** #6 정합 — SHADOW→CH4 는 *정책 상태*(학습 layer 격리)이지 *장애* 가 아니다
  (providerIssue ≠ marketSignal). 격리 경로에 "장애" 표현 0. #8 정합 — Shadow 판단/학습은 무영향,
  발송 채널 의미만 조정.
- **채널 경계(ADR-0032 §3):** 본 변경은 route(채널 의미)만 바꾸고 channel ID(`TELEGRAM_*_CHANNEL_ID`)는
  접근하지 않음 → `validate:channelBoundary` 통과 (신규 직접 접근 0).
- **scope 제외 (follow-up):** SHADOW 청산 CH1 격리(`channelSellSignal` mode 배선 + exit-engine 도메인) ·
  개인 DM SHADOW 격리는 후속 Phase. 본 ADR 은 CH2(SIGNAL) SHADOW 신호 격리 한정.
- **롤백:** `LIVE_SHADOW_QUIET_ENABLED` 제거/false = byte-equivalent 즉시 복원.

## Tests

`server/alerts/shadowQuietRouting.test.ts` (순수 헬퍼 진리표 + routeTelegramEvent 통합) ·
`server/alerts/channelPipelineShadowQuietAdr0607.test.ts` (channelBuySignalEmitted dispatch route):

1. OFF byte-equivalent — SHADOW 신호 CH2 유지 (LIVE 모드여도).
2. ON + LIVE + SHADOW → CH4(JOURNAL).
3. ON + 비LIVE(OFF/PAPER) + SHADOW → CH2 유지.
4. LIVE 체결(EXECUTION_EVENTS) → CH1 유지 (SHADOW 아님, 격리 영향 0) + LIVE 신호 CH2 유지.
5. 순수 헬퍼 진리표 (ENV/모드/isShadow 조합 + 정확 비교 '1'→OFF + OFF 시 getExecutionMode 단락).

## Lineage

ADR-0393(ExecutionMode 3-state + SHADOW always-on) · ADR-0395(getExecutionMode 우선순위 체인) ·
ADR-0032(채널 시멘틱 SSOT + channel ID boundary) · ADR-0466(telegram event taxonomy) ·
ADR-0146(byte-equivalent + ENV 1줄 롤백). INDEX 0607→0608 갱신.
