# Plan — Shadow Always-On by Default (운영자 결정점 제거 · 플래그 축소)

> 동반 ADR: **ADR-0624**. 설계 전용 · 소스 코드 0줄. 9대 불변식 VERBATIM(0줄 변경).
> 운영자 지침(2026-06-18) 반영본. 이전 "활성화 캠페인" plan 을 대체.

---

## 0. 한 줄 요약

시스템이 멍청한 건 로직이 없어서가 아니라 **LIVE 에 안전한 기능까지 `default OFF` 로 잠가 운영자 flag flip 을 기다리기 때문**이다. 처방 = **LIVE-safe shadow 를 default ON(always-on 복원)** + **운영자 결정점을 SHADOW→LIVE 단 한 곳으로 축소** + **flag 표면 축소**. 새 기능·캠페인 추가 0.

> 코드 이력 증거: 오늘(2026-06-18) regime 인식 패치 노트가 직접 명시 — *"실제 shadow 진입 개방은 ADR-0608/0619 flag ON 별도 필요."* 운영자가 regime 패치를 반복하는 동안 정작 매수를 여는 flag 는 계속 OFF였다.

---

## 1. 운영자 지침 → 설계 매핑

| 운영자 지침 (2026-06-18) | 설계 반영 |
|---|---|
| ① 운영자 결정에 의존하지 말 것 | LIVE-safe shadow = **default ON**(운영자 flip 불필요). 학습 = shadow 자동 적용. |
| ② always-on trading 최우선 | shadow 진입·학습 **상시 가동**(불변식 #1·#2 실질 보장). |
| ③ 기능 과잉 = 혼란 | 캠페인·단계 게이트 **추가 안 함**. flag 표면 축소(opt-in 2개 → 비상 kill 1개). 운영자 결정점 N개 → 1개. |

---

## 2. Before → After (default 극성 반전이 핵심)

| 레버 | 자산 (ADR) | 현재 | After |
|---|---|---|---|
| **A. shadow 진입** | ADR-0619 D2 / ADR-0608 | `default OFF` — 운영자 flip 대기(영구 미활성) | **`default ON`** + 비상 kill `SHADOW_LIBERALIZATION_KILL` 1개 |
| **C. 학습** | ADR-0581 | shadow 학습 write-only · LIVE 승인 `PENDING_REVIEW` 영구 정체 | **shadow 자동 적용** / 승인은 SHADOW→LIVE 만 |
| **B. live Gate1 임계** | ADR-0546 / C19 | `default OFF` · BLOCKED | **그대로 `default OFF`** — 단, *유일한* 운영자 결정점(데이터 충족 시 1회 확인) |

> ①②③ 어느 것도 **불변식 변경을 요구하지 않는다.** 전부 default 극성 반전 + 게이트 위치 이동이다.

---

## 3. 유일한 운영자 결정 = SHADOW→LIVE

돈이 걸린 경계(LIVE 실주문 영향)만 인간 확인을 둔다. 나머지(shadow)는 전부 자동.

- shadow 진입·shadow 학습 → 자동(운영자 0).
- LIVE 가중치 승격 / LIVE Gate1 임계 완화 → 시스템이 **"증거 충족 — LIVE 승격 확인?" 1회 제시**, 운영자는 Y/N 한 번. 상시 flag 관리 제거.
- `NON_LIVE_SOURCE` guardrail · clamp · canary 보존(불변식 #7 — paper→live 자동 차단).

---

## 4. 안전 (always-on 을 *지키면서* 연다)

- **LIVE 본문 byte-identical** — 모든 shadow 변경은 `isShadow` 게이트 뒤. live 경로 0 변경.
- **비상 kill-switch 1개**(`SHADOW_LIBERALIZATION_KILL=true`) — shadow 확대 즉시 정지(엔지니어링 안전망).
- **불변식 0줄 변경** — #8 복원, #2 강화, #1 always-on 강화.
- 슬롯/저장 증가 = FIFO·슬롯 캡(ADR-0437/0449)으로 흡수 — 안전 문제 아님(엔지니어링).

---

## 5. 구현 범위 (승인 후 · engine-dev/quality-guard)

| # | 작업 | 파일/자산 | 비고 |
|---|---|---|---|
| **D1** | ADR-0619 D2 구현(`entryEngine.ts:370` 재구조화 + skipCause enum `quantFilter.ts`) + 0608/0619 ENV **기본값 ON 반전** + kill-switch 1개 | ADR-0619 설계 그대로, default 만 반전 | live byte-identical 회귀 필수 |
| **D2** | ADR-0581 shadow provider **자동 등록**(shadow lane 한정) + `dynamicWeightFeedback` → shadow 반영. PENDING_REVIEW(shadow) 제거 | ADR-0581 Phase 3 의 shadow 부분 | LIVE 승격은 D4 게이트 유지 |
| **D4** | SHADOW→LIVE **단일 확인 게이트**(ADR-0546 flip + ADR-0581 Phase 4 canary), data-triggered 1회 제시 | ADR-0546/0581 | LIVE 측 default OFF 유지 |
| 검증 | `npm run lint` → `validate:all` → 회귀(LIVE byte-identical · kill-switch · `NON_LIVE_SOURCE`) → `precommit` | quality-guard | 훅 우회 금지 |

> 순-신규 설계 ≈ 0 — 전부 기존 ADR 의 활성화 + default 극성 반전. genuinely NEW = 이 정책(ADR-0624) 1건.

---

## 6. 폐기된 방향 (왜 캠페인이 아닌가)

이전 ADR-0624 초안(`intelligence-activation-campaign`)은 단계별 *사전확약 게이트* 로 운영자 결정을 **체계화** 하려 했다. 그러나 운영자 지침 ①③(결정 의존 *제거* · 기능 과잉 금지)과 정면 충돌한다. 운영자 결정을 더 잘 *관리* 하는 게 아니라 **안전한 곳에선 아예 *제거*** 하는 것이 옳다. → 캠페인 폐기, 본 plan 으로 대체.

---

## 7. 병행 (선택) — Universe Discovery

게이트를 열어도 유니버스에 주도주가 없으면 좋은 종목이 안 채워진다. ADR-0617/0618(leader 주입·일일 갱신)은 shadow-safe 라 **병행 권장**(역시 default ON 후보). 단 핵심 경로는 D1/D2/D4 에 고정 — 발굴 축은 별도.

---

## 8. 후속 확인 필요 (구현 인계 전)

- ADR-0581 Phase 3 의 shadow-자동 부분과 LIVE-게이트 부분의 **코드 분리점** 확인(현재 `weightPromotionFlag` 단일 flag → shadow/LIVE 2분할 필요 여부).
- ADR-0619 D2 의 ENV 기본값 위치(resolver) — 반전 지점 1곳인지 확인.
- shadow 대량 fill 시 KIS-WS 슬롯/`shadow-trades.json` 용량 실측 → FIFO 캡 파라미터 조정.
