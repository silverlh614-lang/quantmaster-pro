# ADR-0195 — R3 Sanity Block 텔레그램 즉시 해제 + /guards 가시화 + cooldown 24h

@responsibility R3 sanity block 영속 latch 운영 결함 차단 — 텔레그램 즉시 해제 + UI 가시화 + 알림 도배 차단.

## 컨텍스트

사용자 5/6 KST 10:21 보고 — 정규 매매 시간대 + `/guards` 7가드 모두 비활성인데도 로그에 `[AutoTrade] R3 sanity block active — 신규 매수 차단 (GATE1_PASS_ZERO, R3_EARLY)` 매 cron tick 마다 표시 + 매수 0건.

코드 audit (`server/persistence/r3SanityBlockRepo.ts` + `server/trading/signalScanner/preflight.ts:168-183`) 결과:

1. **R3 sanity block** 은 영속 latch (`data/r3-sanity-block.json`) 로 한 번 발동 후 자동 해제 안 됨. ADR-0120 (PR-B) 의 "시스템 결함 의심 시 운영자 명시 확인 후 해제" 정책 — 안전 의도.
2. **결함 1**: `/guards` 명령 (ADR-0194) 에 표시 안 됨 → 운영자가 7 가드 통과 했다고 판단 → 실제로는 8번째 latch 가 차단 중.
3. **결함 2**: 텔레그램 즉시 해제 명령 부재 → ENV `R3_SANITY_OPERATOR_ACK=<triggeredAt>` 설정 + Railway 재배포만 가능 → 매매 기회 손실.
4. **결함 3**: 텔레그램 HIGH 알림 cooldown 60분 → 매 1시간마다 중복 발송 → 운영자 인지 부담.

## 결정

### 결정 1 — `/r3_unblock` 텔레그램 명령 신설

`server/telegram/commands/control/r3Unblock.cmd.ts` 신규. category=`EMR`, riskLevel=2 (LIVE 매매 영향, ADR-0146 PR 자가 review 의무). alias `/r3_clear`, `/clear_r3_sanity`. `acknowledgeR3SanityBlock('telegram_operator')` 직접 호출 → 즉시 latch 해제 + 다음 cron tick 부터 신규 매수 재개.

### 결정 2 — `/guards` 응답에 R3 sanity latch 8번째 라인 추가

`server/telegram/commands/control/guards.cmd.ts` 본체에 `loadR3SanityBlockState()` 호출 + 활성 시 `🚨 R3 Sanity Block (활성, GATE1_PASS_ZERO/R3_EARLY) — /r3_unblock 으로 해제` 라인 추가. `anyBlocked` 합산 분기에도 포함 → "모든 가드 정상" 메시지 신뢰성 격상.

### 결정 3 — 텔레그램 HIGH 알림 cooldown 60min → 24h

`preflight.ts:176` `cooldownMs: 60 * 60_000` → `cooldownMs: 24 * 60 * 60_000`. ADR-0120 정합 (사용자 9번 §6 "1일 1회 알림"). dedupeKey `r3_sanity_block_active` 그대로 (24h cooldown 안 첫 호출만 발송).

### 결정 4 — ENV 우회 부재

본 PR 의 3 변경 모두 안전 격리 (read-only 표시 추가 / 신규 명령 / cooldown 확장). ENV 우회 도입 시 *영속 latch 해제 자체* 가 ENV 로 가능해져 운영 안전 정책 약화 — ADR-0120 ENV `R3_SANITY_OPERATOR_ACK` 만 보존.

## 안전 invariant 5종

1. **LIVE 매매 본체 0줄 변경** — `signalScanner.ts` / `entryEngine.ts` / `exitEngine/**` / `kisClient/**` / `orchestrator/**` 본체 무수정. preflight.ts cooldown 1줄 + 명령 SSOT 1개 + guards.cmd 라인 1개.
2. **KIS/KRX 자동매매 quota 0 침범** — 절대 규칙 #2/#3/#4. r3SanityBlockRepo SSOT read/write 만.
3. **ADR-0120 영속 latch 정책 보존** — `acknowledgeR3SanityBlock()` 만 호출, latch 자동 해제 도입 금지 (시스템 결함 의심 시 운영자 명시 확인 의무).
4. **ADR-0017 commandRegistry 단일 통로** — `/r3_unblock` 도 commandRegistry 자동 등록 + `buildBotMenuCommandsExtended` 자동 노출.
5. **`/r3_unblock` riskLevel=2** — LIVE 매매 즉시 영향 (다음 tick 부터 매수 재개) → 운영자 명시 의도 의무 (ADR-0146 자가 review).

## 잘못된 해결 방법 영구 차단 5종

1. **R3 sanity latch 자동 해제** — ADR-0120 정책 위반 (시스템 결함 의심 시 운영자 명시 확인 의무).
2. **`/r3_unblock` riskLevel=0 (read-only)** — LIVE 매매 즉시 영향 → riskLevel=2 의무.
3. **cooldown 7일 격상** — 24h 가 ADR-0120 §6 정합 (1일 1회). 더 늘리면 운영자 인지 지연.
4. **`/guards` 라인 추가가 R3 sanity latch 자동 해제** — read-only 가드.
5. **`/r3_unblock` 이 다른 가드 (emergencyStop / pause / blockNewBuy) 도 함께 해제** — 결정 분리 의무 (각 가드 독립 의미).

## 회귀 테스트 ≥10 케이스

- `r3UnblockCmd.test.ts` — 정적 grep + 동작 매트릭스 (latch active → 해제 + 메시지 / 이미 비활성 → 멱등 / alias 동일 인스턴스 / acknowledgeR3SanityBlock 호출 검증 / riskLevel=2 / category=EMR).
- `guardsR3Sanity.test.ts` — `/guards` 응답 R3 latch 라인 (활성 시 표시 / 비활성 시 라인 미노출 / `/r3_unblock` 라벨 / anyBlocked 합산 정합).
- `preflightCooldownAdr0195.test.ts` — preflight.ts cooldown 24h 정적 grep 가드.

## 운영자 활성화 절차

본 PR 머지 직후 자동 활성화. Railway 배포 완료 후:

```
/guards         → 8번째 라인 (R3 sanity block) 활성 표시 확인
/r3_unblock     → 즉시 latch 해제 + 메시지 수신
/guards         → 8번째 라인 비활성 확인
                  → 다음 cron tick 부터 신규 매수 재개
```

## 결과

1. 사용자 KST 10:21 시점 매수 차단 결함 텔레그램 1 명령으로 즉시 해제 가능.
2. `/guards` 8 가드 통합 SSOT 회복 (ADR-0194 7 → 8 격상).
3. 알림 도배 24h cooldown 으로 차단.
4. ADR-0120 R3 sanity block 정책 보존 (운영자 명시 확인 의무).
