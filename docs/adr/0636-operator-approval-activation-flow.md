# ADR-0636 — 운영자 승인 활성화 절차 (LIVE_ADJACENT_REVIEW 전용)

@responsibility ADR-0635 가 등재한 LIVE_ADJACENT_REVIEW(T2) lever 4종을 운영자 1-클릭 승인으로 활성/철회하는 경계·타입·영속·부팅 재적용·telegram 계약 pin. LIVE_ADJACENT_REVIEW 전용·T3/EXCLUDED/LIVE master 승인 절대 불가. 승인 0건(기본)=byte-identical. 신규 ENV 0.

- **Status:** Proposed (Phase 0 — architect: 영속 ledger 타입(`autoActivationApproval.ts`)·repo 스켈레톤·엔진 `OperatorApprovalResult`+3함수 시그니처·paths 상수·ADR·INDEX. repo 본문·엔진 본문·telegram cmd 3종·부팅 wiring 은 engine-dev 인계.)
- **Date:** 2026-06-18
- **Type:** ADR (신규 영속 ledger + 엔진 승인 함수 3종 + telegram cmd 3종 + 부팅 재적용 wiring)
- **Extends:** ADR-0633(자가 활성 엔진 — evaluator·LEVER_REGISTRY·master flag)·ADR-0634(런타임 cron wiring + 영속 streak repo 동형 패턴)·ADR-0635(registry 확장 + `LIVE_ADJACENT_REVIEW` eligibility 도입). 본 ADR 은 ADR-0635 가 "인지하되 자동 활성 금지"로 등재한 T2 lever 의 **운영자 1-체크포인트(1-클릭 승인 절차)** 를 구현한다. ADR-0526(strategy apply_live operator 게이팅)·ADR-0157(`=== 'true'`)·ADR-0530(Patch Scope Guard)·ADR-0607(CH4 라우팅) 준수.
- **executionImpact:** 승인 0건(기본)=NONE(byte-identical — 부팅 재적용 no-op·process.env 무접촉) / 승인 시=해당 T2 lever 의 LIVE 동작 변경이며 **운영자 명시 승인분에 한함**. autoTradeEngine/kisClient/order 본체 0줄·requiredScore=70 무변경·SourceSnapshot 생성기 무변경.

---

## 1. Context

ADR-0633(엔진)·ADR-0634(cron wiring)·ADR-0635(registry 확장)가 머지돼 "Shadow 검증 충족 시 LIVE_SAFE lever 를 엔진이 스스로 ON" 하는 자가 활성 루프가 살아 있다.

ADR-0635 는 그 registry 에 신규 eligibility `LIVE_ADJACENT_REVIEW`(T2)를 도입하고 4종을 등재했다:

| leverId | envName | 근거 |
|---------|---------|------|
| `R6_TRIGGER_TRADEDATE_FRESHNESS_ADR0592` | `R6_TRIGGER_TRADEDATE_FRESHNESS_ENABLED` | R6 트리거 tradeDate 신선도 게이트 (ADR-0592) |
| `R6_RECOVERY_STUCK_EXIT_ADR0630` | `R6_RECOVERY_STUCK_EXIT_ENABLED` | R6 복구 stuck-exit Kelly/display 정상화 (ADR-0630 D2) |
| `GATE1_RS_PERCENTILE_CONTINUOUS_ADR0627` | `GATE1_RS_PERCENTILE_CONTINUOUS_ENABLED` | Gate1 RS 백분위 연속 채점식 (ADR-0627) |
| `INTRADAY_SCREENER_REFRESH_ADR0628` | `INTRADAY_SCREENER_REFRESH_ENABLED` | 장중 리더 universe 신선화 (ADR-0628) |

이들은 **LIVE-인접 동작을 바꾼다**(regime/R6 상태·Kelly/display·Gate1 채점·universe 구성). 그래서 ADR-0635 는 자가 활성(evaluator)을 금지하고 EXCLUDED 와 같이 항상 `EXCLUDED` verdict·process.env 무접촉으로 두되, EXCLUDED 와 의미를 분리했다 — "절대 금지"가 아니라 **운영자 1-체크포인트 검토 후 수동 활성** 대상으로 인지·등재했다.

운영자 지시(2026-06-18): **그 1-체크포인트(운영자 1-클릭 승인 절차)를 구현하라.** 본 ADR 이 그 절차다.

### 1.1 자가 활성과의 분리 — 왜 별도 경로인가

자가 활성(ADR-0633 evaluator)은 `process.env[envName]='true'` 를 *엔진이 자동으로* set 한다. T2 lever 는 그 자동 경로에서 영구 제외다(eligibility 분기). 운영자 승인은 그 자동 경로를 우회하는 **명시적·감사 가능한 수동 행위**다 — 운영자가 evidence 를 보고, 영향을 인지하고, 1-클릭 confirm 으로 ENV 를 켠다. 이것이 자가 활성과 별도의 승인 ledger·별도 엔진 함수·별도 telegram cmd 를 두는 이유다.

### 1.2 본 ADR 이 새로 만드는 것 / 만들지 않는 것

- **만든다:** (a) 영속 승인 ledger(`autoActivationApprovalRepo.ts` + 타입 `autoActivationApproval.ts`). (b) 엔진 승인 함수 3종(`applyOperatorApproval`·`revokeOperatorApproval`·`reapplyOperatorApprovals`) + `OperatorApprovalResult` 타입. (c) telegram cmd 3종(`/review_activations`·`/approve_activation`·`/revoke_activation`). (d) 부팅 재적용 wiring 1회 호출.
- **만들지 않는다:** 신규 ENV(승인은 영속 ledger 로, master flag 무관). LIVE_SAFE/EXCLUDED lever 의 승인 경로(T2 전용). LIVE 실주문 경로 변경. Gate 채점 변경. requiredScore=70 변경. T2 lever 본체(ADR-0592/0630/0627/0628)의 1줄 변경(승인은 그 lever 의 기존 ENV flag 를 켤 뿐).

---

## 2. Decision

### 2.1 영속 승인 ledger (§1 — engine-dev 본문)

신규 `server/persistence/autoActivationApprovalRepo.ts` + 공유타입 `src/types/autoActivationApproval.ts`. ADR-0634 `autoActivationStreakRepo.ts` 와 **동형 패턴**:

- 저장형 `Record<leverId, { approvedAt: string; approvedBy: string }>`, `data/auto-activation-approval-adr0636.json` (paths.ts `AUTO_ACTIVATION_APPROVAL_FILE` — 다른 ledger 와 물리 분리).
- atomic write (tmp → rename) · self-heal(부재/손상 → 빈 `{}`).
- 함수: `loadApprovals()` · `recordApproval(leverId, approvedBy)` · `revokeApproval(leverId)`(반환 boolean removed) · `isApproved(leverId)` · `listApprovedLeverIds()`.
- **빈 상태(승인 0건)가 기본** — 휘발 시 빈 상태 self-heal = 부팅 재적용 no-op = byte-identical.

repo 는 영속만 담당한다. eligibility 검증·process.env 조작은 엔진 책임이다(§2.2). cmd 는 엔진 검증(verdict APPROVED) 통과 후에만 repo 를 호출한다(검증 실패 시 영속 무접촉).

### 2.2 엔진 승인 함수 (`selfValidationAutoActivationAdr0633.ts` 에 추가 — engine-dev 본문)

```ts
export interface OperatorApprovalResult {
  leverId: string;
  verdict: 'APPROVED' | 'REVOKED' | 'REJECTED_NOT_REVIEWABLE' | 'NOT_FOUND';
  envName?: string;
  reason: string;
}
export function applyOperatorApproval(leverId: string, approvedBy: string): OperatorApprovalResult;
export function revokeOperatorApproval(leverId: string): OperatorApprovalResult;
export function reapplyOperatorApprovals(approvedLeverIds: string[]): string[];
```

- **`applyOperatorApproval(leverId, approvedBy)`** — 검증: leverId 가 `LEVER_REGISTRY` 에 있고 **`eligibility === 'LIVE_ADJACENT_REVIEW'`** 일 때만 허용. 아니면 거부:
  - 미등재 → `NOT_FOUND`(process.env 무접촉).
  - 등재됐으나 LIVE_ADJACENT_REVIEW 아님(LIVE_SAFE/LIVE_MONEY_EXCLUDED/ABSOLUTE_PRESERVATION_EXCLUDED) → `REJECTED_NOT_REVIEWABLE`(process.env 무접촉).
  - 허용 → `process.env[envName]='true'` set + in-memory audit append(source='OPERATOR_APPROVAL'·approvedBy). 실제 영속 write 는 호출자(cmd)가 `recordApproval` 로 수행한다(엔진 순수성 — repo I/O 분리).
- **`revokeOperatorApproval(leverId)`** — 동형 검증. 허용 시 `process.env[envName]` **delete**(`'false'` set 아님 — 미설정 default 상태로 복귀) + audit. 영속 삭제는 cmd 가 `revokeApproval` 로.
- **`reapplyOperatorApprovals(approvedLeverIds)`** — 부팅 시 영속 승인분을 process.env 에 재적용(`LIVE_ADJACENT_REVIEW` 만·registry 교차검증으로 legacy/오염 leverId 무시). 적용된 leverId 반환. **승인 ledger 빈 상태(기본)면 입력 빈 배열 → no-op = byte-identical.**

**절대 가드(핵심):** `LIVE_MONEY_EXCLUDED`·`ABSOLUTE_PRESERVATION_EXCLUDED`(T3) 와 LIVE master flag(`AUTO_TRADE_ENABLED`·`KIS_IS_REAL`·`VTS_PAPER` — registry 비등재라 자동 `NOT_FOUND`)는 본 함수로 **절대 승인 불가**다. eligibility 분기가 1차 가드, registry 비등재가 2차 가드다.

### 2.3 Telegram 명령 (§3 — engine-dev 본문, architect 계약)

`strategy.cmd.ts`(operator/admin userId 게이팅)·`learningWeightsReset.cmd.ts`(confirm 토큰 패턴)을 모델로 3종. 상세 계약·운영자 게이팅 메커니즘·부팅 wiring 위치는 `_workspace/2026-06-18_intelligence-activation/architect-approval-contract.md`.

- **`/review_activations`** (read-only, riskLevel 0): LIVE_ADJACENT_REVIEW 4종 + 현재 process.env 활성여부 + 승인상태(approvedBy/At) + evidence 요약(가능 시 promotionReadiness 재사용) + "승인법: `/approve_activation <leverId> confirm`" 안내. always-render skeleton.
- **`/approve_activation <leverId> confirm`** (riskLevel 2, 운영자 전용): confirm 토큰 없으면 evidence + 영향 경고 + 확인요청만(mutate 0). confirm 있으면 `applyOperatorApproval` + (verdict APPROVED 시) `recordApproval` + CH4(JOURNAL) 통지. leverId 가 LIVE_ADJACENT_REVIEW 아니면(REJECTED_NOT_REVIEWABLE/NOT_FOUND) 거부 메시지·영속 무접촉.
- **`/revoke_activation <leverId> confirm`** (riskLevel 2, 운영자 전용): `revokeOperatorApproval` + `revokeApproval` + CH4 통지.

운영자 식별은 기존 고위험 명령(strategy apply_live)의 게이팅 메커니즘 재사용 — `TELEGRAM_OPERATOR_USER_IDS`/`TELEGRAM_ADMIN_USER_IDS` allowlist(둘 다 미설정 시 `operator`/`admin`/`system` userId 폴백). 신규 운영자 ENV 발급 0.

### 2.4 부팅 재적용 wiring (§4 — engine-dev 본문)

서버 부팅부(`server/index.ts` startScheduler 인접)에서 `reapplyOperatorApprovals(listApprovedLeverIds())` 1회 호출 + 로그. 승인분 없으면 입력 빈 배열 → no-op. **이것이 default 상태 byte-identical 보장의 핵심**(승인 0건 = 부팅 시 process.env 무접촉).

---

## 3. 불변식 정합 (9대 불변식)

- **#1(Trading Engine 항상 살아있음):** repo self-heal·부팅 재적용 throw 0(빈 배열 no-op). 승인 ledger 휘발이 엔진 가동을 막지 않는다.
- **#7(AI_ESTIMATED L4 → LIVE 금지):** T3 LIVE_MONEY_EXCLUDED(learning→LIVE 가중치)는 승인 불가(eligibility 가드). 본 절차는 L4 데이터를 LIVE 결정에 쓰지 않는다.
- **#8(실거래 차단과 Shadow 차단 분리):** 승인은 master flag(AUTO_TRADE_ENABLED·KIS_IS_REAL)와 **독립한 운영자 명시 행위**다. 승인이 LIVE master 를 켜지 않고, master 가 승인을 대체하지 않는다. T2 lever 활성은 그 lever 의 기존 ENV flag 1개만 켤 뿐 autoTradeEngine/kisClient/order 본체 0줄.
- **나머지(#2/#3/#4/#5/#6/#9):** SourceSnapshot 생성기·provider 직접 조회·Gate 내부 provider 우회 0(승인은 메타 ENV 조작만). 승인 0건 기본 = byte-identical.

---

## 4. Rollback

- **즉시 철회:** `/revoke_activation <leverId> confirm` → `process.env[envName]` delete + 영속 `revokeApproval` 삭제. 다음 부팅 재적용에서도 미적용(영속 삭제됨).
- **ENV 레벨:** 운영자가 직접 `<envName>=false`(또는 unset) 로 롤백 가능 — 해당 T2 lever 의 ADR(0592/0630/0627/0628) 가 정의한 default OFF 동작으로 즉시 복귀.
- **영속 삭제:** `data/auto-activation-approval-adr0636.json` 삭제 → self-heal 빈 상태 → 부팅 재적용 no-op = byte-identical.

---

## 5. Patch Scope Guard (ADR-530)

- **targetDomain:** self-activation-approval(1) + engine-type + telegram-cmd(승인 경로 단일 도메인).
- **allowedFiles:** `src/types/autoActivationApproval.ts`(신규)·`server/persistence/autoActivationApprovalRepo.ts`(신규)·`server/persistence/paths.ts`(상수 1줄)·`server/trading/selfValidationAutoActivationAdr0633.ts`(OperatorApprovalResult+3함수)·telegram cmd 3종 신규·`server/index.ts`(부팅 재적용 1호출)·본 ADR·INDEX 0636→0637·10-patch-history 1줄·ARCHITECTURE 모듈 1줄·architect-approval-contract.md·`*.test.ts`.
- **forbiddenFiles:** autoTradeEngine·buyPipeline·kisClient·SourceSnapshot 생성기·gateConfig·requiredScore=70 SSOT·T2 lever 본체(ADR-0592/0630/0627/0628 reader 본문)·evaluateAutoActivation 자동 활성 분기 본체·LEVER_REGISTRY 데이터(승인은 등재 lever 를 읽기만)·.env.example(신규 ENV 0).
- **rollback:** `/revoke_activation` + 영속 삭제 + ENV `<envName>=false` (각 독립).
- **engine-dev 인계:** repo 5함수 본문(streakRepo 동형)·엔진 3함수 본문·cmd 3종·부팅 wiring. 회귀: (a)승인 0건 부팅 재적용 no-op byte-identical (b)LIVE_ADJACENT_REVIEW approve→envName=true+영속 record (c)revoke→envName delete+영속 삭제 (d)LIVE_SAFE/EXCLUDED approve→REJECTED_NOT_REVIEWABLE·process.env 무접촉 (e)미등재 leverId→NOT_FOUND (f)confirm 토큰 없는 approve→mutate 0 evidence only (g)operator 게이팅 미인가 userId→UNAUTHORIZED (h)repo self-heal 손상 JSON→{} (i)부팅 재적용 legacy/오염 leverId registry 교차검증 무시.

---

## 6. Alternatives Considered

- **신규 ENV 로 승인 표현(예 `OPERATOR_APPROVED_LEVERS=...`) — 기각.** 운영자 지시 "승인은 영속 ledger 로, master flag 무관". ENV 발급 0 원칙·영속 ledger 가 approvedAt/By 감사 가능.
- **자가 활성 evaluator 에 LIVE_ADJACENT_REVIEW 자동 ACTIVATE 분기 추가 — 기각.** ADR-0635 #8 위반(LIVE-인접 자동 활성 금지). 운영자 1-체크포인트가 정도.
- **엔진이 직접 영속 write — 기각.** 엔진 순수성(now·입력만·repo I/O 분리). cmd 가 recordApproval 로 영속·엔진은 process.env+in-memory audit 만.
- **revoke 시 `envName='false'` set — 기각.** delete(미설정 default 복귀)가 정도 — `=== 'true'` reader 가 default OFF 로 자연 복귀, ENV 잔존 0.
- **신규 운영자 게이팅 메커니즘 — 기각.** strategy apply_live 의 `TELEGRAM_OPERATOR_USER_IDS`/`TELEGRAM_ADMIN_USER_IDS` 재사용(단일 통로·신규 ENV 0).
- **CH2 통지 — 기각(ADR-0607).** 승인/철회는 executionImpact 운영 저널 — CH4(JOURNAL) 라우팅.

---

## 7. References

- ADR-0633 — Shadow 자가 검증 후 LIVE-safe ENV 게이트 자동 활성화 엔진 (evaluator·LEVER_REGISTRY·master flag).
- ADR-0634 — 자가 활성 런타임 cron wiring + 영속 streak repo (autoActivationStreakRepo 동형 패턴).
- ADR-0635 — registry 확장(T1 측정/관측) + `LIVE_ADJACENT_REVIEW`(T2) eligibility 도입.
- ADR-0592/0630/0627/0628 — T2 lever 본체(R6 신선도·R6 stuck-exit·Gate1 RS 연속·intraday 신선화).
- ADR-0526 — strategy versioning operator/admin 게이팅 메커니즘 재사용.
- ADR-0157 — ENV `=== 'true'` 정확 비교. ADR-0607 — CH4 JOURNAL 라우팅. ADR-0530 — Patch Scope Guard.

---

## 8. Addendum — 소유자 chat fallback (운영자 게이팅 사용성, patch-type)

라이브에서 운영자가 `/approve_activation` 호출 시 `UNAUTHORIZED` 발생. 근본 원인: 재사용한
`resolveStrategyPermission` 은 allowlist 미설정 시 `userId === 'operator'/'admin'/'system'` 리터럴만
통과시켜, 실제 Telegram **숫자 userId** 가 탈락. 단일 소유자 봇에서 allowlist 강제는 불필요한 마찰.

처방 — 활성화 승인/철회 **전용** 게이팅 SSOT `resolveActivationPermission`
(`server/telegram/commands/system/activationPermission.ts`) 신설:
1. `TELEGRAM_OPERATOR_USER_IDS`/`TELEGRAM_ADMIN_USER_IDS` 설정 시 → 엄격 allowlist 매칭(불변).
2. **allowlist 미설정 시 → 소유자 chat(`TELEGRAM_CHAT_ID`) 에서 온 메시지면 운영자 인정** (단일
   소유자 봇 private 채널 = 본인이라는 강한 신호). 신규 ENV 0.
3. 레거시 폴백(userId 미상 통과·리터럴) 보존 — 기존 테스트 동치.

**`/strategy`(실거래 apply_live) 는 본 함수를 쓰지 않는다 — 인증 완화는 활성화 승인 경로 한정.**
allowlist 를 명시 설정하면 fallback 비활성(엄격 모드 우선)이라 보안 후퇴 없음. patch-type(신규 ADR 0건).
