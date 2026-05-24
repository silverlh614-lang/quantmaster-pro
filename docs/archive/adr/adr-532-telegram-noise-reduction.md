# ADR-532 — Telegram Noise Reduction & Channel Severity Filter

**Read this file only when working on:**
- Telegram 채널별 severity 필터 · 사용자-facing 노출 정책
- executionImpact=NONE diagnostic/provider 이벤트의 채널 라우팅
- 정책 상태(SELL_ONLY/R6) 가 장애처럼 표시되는지 점검
- dedup/cooldown 키 정책 · 중복 알림 차단

**Do not read this file for:**
- 일반 코딩 (telegram/severity 도메인 전용 reference) → 평소 로드 금지
- Telegram 채널 기본 정책·명령 레지스트리 → `docs/ai/06-telegram-policy.md`
- severity taxonomy 정의 → `docs/archive/adr/adr-531-warning-error-taxonomy.md`

> **Status:** ADR-532 1차 증분 = **문서 SSOT 전용** (코드 0줄, runtime byte-equivalent).
> ADR-531 taxonomy 를 Telegram 출력 라우팅에 적용하는 규칙을 성문화한다.
> **핵심 발견: 목표의 상당수가 이미 코드에 구현돼 있다.** 본 문서는 기존 동작을 SSOT 로
> 검증·고정하고, 남은 gap 을 후속 ADR 로 분리한다 (ADR-530 Patch Scope Guard).

---

## 1. 실제 채널 모델 (grounded — 추측 아님)

ADR-532 프롬프트의 `BOT/SIGNAL/ADMIN/DEBUG` 개념 모델 ≠ 실제 구현. 실제는:

| 실제 채널 | semantic | 용도 | SSOT |
|-----------|----------|------|------|
| **CH1 EXECUTION** | TRADE | 체결/주문/킬스위치/SELL_ONLY 진입 | `alertRouter.ts` |
| **CH2 SIGNAL** | ANALYSIS | BUY/SELL/Shadow 신호 (사용자-facing) | `telegramEventRouter.ts` |
| **CH3 REGIME** | INFO | 매크로·**PROVIDER_HEALTH**·정기 다이제스트 | `telegramEventRouter.ts` |
| **CH4 JOURNAL** | SYSTEM | Shadow summary·회고·메타 학습 | `telegramEventRouter.ts` |
| **private DM** | — | 잔고/손절 카운트다운·HTML fallback | `telegramClient.ts` |
| **Railway log only** | — | `[INVARIANT]`/`[DEBUG]`/`[TRACE]` | `classifyTelegramRouting` |

사용자 개념 매핑: `ADMIN/DEBUG` ≈ **CH3/CH4 또는 Railway-log-only**. 별도 ADMIN 텔레그램 채널은
현재 없으며, 신설은 HIGH 위험(신규 env 와이어링) → 후속 ADR 분리.

---

## 2. 이미 충족된 목표 (검증 — 코드 변경 불필요)

| 목표 | 현재 구현 |
|------|-----------|
| Provider/diagnostic 이 SIGNAL(CH2) 노출 안 됨 | `PROVIDER_HEALTH` → CH3 REGIME/INFO 라우팅 (`telegramEventRouter.ts`) |
| `/pos`·`/pnl` shadow-first (live 전용 표시 금지) | `[PORTFOLIO_QUERY_SHADOW_FIRST]` — Registry>Ledger>TradeRepo>VirtualAccount>PaperLedger>KISLive (`shadowPositionSources.ts`). liveCount=0 정상 |
| `[DEBUG]`/`[INVARIANT]`/`[TRACE]` 사용자 채널 금지 | Railway-log-only (`classifyTelegramRouting`, `TELEGRAM_INVARIANT_ROUTING_DISABLED`) |
| dedup/cooldown | `dedupeKey` + `cooldownMs` + category×priority 매트릭스 (`alertRouter.ts`) |
| HTML fallback / 중복 압축 | plain-text 재시도 + digest 압축 (`telegramClient.ts`) |
| 채널 경계 강제 | `validate:channelBoundary` (alertRouter SSOT 화이트리스트) |
| 잔고/자산 키워드 채널 누출 차단 | `validate:sensitiveAlerts` (ADR-0038, 개인 회선 분리) |

---

## 3. 채널별 허용 이벤트 (normative — 기존 라우팅 성문화)

```
CH2 SIGNAL (사용자-facing 매매):
  BUY/SELL signal · Shadow BUY/SELL signal · actual/virtual fill ·
  position opened/closed · stop-loss/take-profit/forced liquidation ·
  executionImpact != NONE 인 중요 이벤트.

CH1 EXECUTION:
  체결/주문/킬스위치/HARD_BLOCK/SELL_ONLY 진입 (정책 상태로 표시, 장애 아님).

CH3 REGIME (INFO):
  매크로·providerIssue 격리·정기 다이제스트. executionImpact=NONE provider 는 여기.

CH4 JOURNAL (SYSTEM):
  Shadow summary·counterfactual·회고·suppressed 요약.

private DM: 잔고/자산/손절 카운트다운.
Railway log only: [DEBUG]/[INVARIANT]/[TRACE] · raw payload · correlationId trace.
```

---

## 4. severity → 채널 필터 (ADR-531 taxonomy 적용)

```
ERROR      → CH1/CH2 (사용자 조치·매매 영향 시) + 항상 로그
WARN       → CH2 (executionImpact != NONE 일 때만) / 아니면 CH3·로그
INFO       → CH2 (매매/포지션/정책 전환 시만) · 반복은 다이제스트 병합
DIAGNOSTIC → CH2 금지. 사용자 요청 명령(/scan_blockers 등) 응답만 / CH3·CH4
DEBUG      → CH2 금지 · Railway log only
SUPPRESSED → CH2 금지 · CH4/Admin 요약만
```

**핵심 규칙:** `providerIssue=true && executionImpact=NONE` → CH2(SIGNAL) 발송 금지
(이미 PROVIDER_HEALTH→CH3 로 충족). 정책 상태(SELL_ONLY/R6/HOLIDAY)는 장애 아님 →
`docs/archive/adr/adr-531-warning-error-taxonomy.md` §5 표시 규칙 준수.

---

## 5. dedup 키 정책 (normative — 기존 `dedupeKey`/`cooldownMs` 활용)

```
Trading Signal:  tradeDate + symbol + side + strategy + sourceSnapshotId
Position Event:  positionId + symbol + eventType + stage + tradeDate
Liquidation:     positionId + exitReason + exitStage + tradeDate
Policy State:    policyState + engineMode + effectiveRegime + tradingDate (전환 시만 발송)
Provider Diag:   provider + issueType + trId + priority + tradeDate (CH2 금지, CH3/Admin TTL 요약)
Formatter Fallback: channel + templateName + errorType (Admin/Debug/로그만)
```
반복: 첫 발생만 허용 채널 발송 → 반복은 CH2 차단 + suppressed 요약 + Railway SUPPRESSED.

---

## 6. 남은 gap → 후속 ADR (코드 증분, 본 ADR 범위 외)

| gap | 위험 | 후속 |
|-----|------|------|
| P3/P4 provider(executionImpact=NONE) severity 승격 차단 가드 | LOW (additive) | ADR-532-B 후보 |
| `TelegramEvent.userFacing` 옵션 플래그 | LOW | ADR-532-B 후보 |
| event→channel severity 매칭 검증기 (`validate:sensitiveAlerts` 와 별개) | MEDIUM | 별도 ADR |
| 전용 ADMIN/DEBUG 텔레그램 채널 (`TELEGRAM_ADMIN_CHANNEL_ID`) | HIGH (신규 env) | 별도 ADR |
| formatter fallback 오류의 CH3/Admin 보고 | MEDIUM | 별도 ADR |

각 후속 ADR 은 `docs/ai/templates/patch-plan-template.md` 형식 Patch Plan 선행 (ADR-530).

---

## 7. 검증 케이스 (코드 증분 적용 시)

1. providerIssue=true · marketSignal=false · executionImpact=NONE → CH2(SIGNAL) 미발송.
2. P3/P4 budget exceeded → CH3/CH4/Railway only (CH2 금지).
3. SELL_ONLY 전환 → 정책 상태 1회 표시 (오류 표현 금지).
4. R6_DEFENSE → "Live Buy Blocked + Shadow ON" 표시.
5. Shadow duplicate suppressed → CH2 재발송 금지, 요약만.
6. Shadow liquidation EXECUTED → CH2 1회만 (dedupKey).
7. HTML formatter fallback → CH2 반복 금지, 로그/Admin 만.
8. `/pos`·`/pnl` 응답이 severity 필터로 차단되지 않음 (shadow-first 유지).
9. 사용자 요청 `/scan_blockers` diagnostic → 명령 응답 허용.
10. DEBUG/SUPPRESSED → 사용자-facing CH2 직접 노출 안 됨.

검증 기준 → `docs/ai/08-testing-checklist.md` · taxonomy → `adr-531-warning-error-taxonomy.md`.
