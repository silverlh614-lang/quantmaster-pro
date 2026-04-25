# ADR-0017 — Telegram 명령어 메뉴 압축 + 메타 명령어 + 모듈 분해 + 사용량 텔레메트리

- **Status**: Implemented (2026-04-25, PR-43 Stage 1 / PR-44~47 Stage 2 / PR-48 Stage 3 완료)
- **Owners**: architect, engine-dev
- **Branch**: `claude/telegram-refactor-UwyFS`

## 문제 정의

`server/telegram/webhookHandler.ts` 가 1,858줄까지 비대해지고 명령어가 59개로
누적되었다. `setMyCommands` 등록은 43개까지만 노출하고 16개는 숨겨져 있어
실제 노출/구현 사이 불일치가 발생한다. 사용자 측면에서:

1. **인지 부담**: `/` 입력 시 자동완성 메뉴에 43개가 한 번에 펼쳐짐 — 무엇을 외워야
   하는지 모호.
2. **카테고리 혼선**: 동일 의도 명령어가 흩어져 있음 (예: 워치리스트 관련
   `/watchlist /focus /add /remove /watchlist_channel` 5개가 평면 나열).
3. **장기 학습 신호 부재**: 어떤 명령어가 실제 사용되는지 텔레메트리가 없어
   안전한 폐기 후보를 식별할 수 없음.

운영 측면에서:

4. `webhookHandler.ts` 가 `scripts/check_complexity.js` 의 1,500줄 임계를 358줄
   초과 — CLAUDE.md "기존 복잡도 위반" 표 P1 우선순위로 기록되어 있음.
5. 신규 명령어 추가 시 `webhookHandler.ts` 의 거대 `switch` 와 `telegramClient.ts`
   의 `setMyCommands` 두 곳을 동시 수정해야 하는 drift 위험.

사용자 요청 (원문 축약): **"명령어 59개 → 8개로 압축 (메뉴 노출). 기존 핸들러는
하위호환 alias 로 유지. 메타 명령어는 인라인 키보드로 하위 명령어를 펼친다."**

## 결정 — 3-Stage 점진적 분해

### Stage 1 (본 PR) — 메타 명령어 6개 신설 + 메뉴 8개 압축

**목표**: 사용자 체감 즉시 변화 + 기존 51개 명령어 100% 하위호환.

#### 노출 메뉴 8개 (`setMyCommands`)

| 명령어 | 카테고리 | 핸들러 출처 |
|--------|----------|-------------|
| `/help` | 도움말 (인라인 메뉴) | 기존 webhookHandler.ts (보강) |
| `/status` | 시스템 현황 요약 | 기존 webhookHandler.ts (유지) |
| `/now` | "지금 매수해도 되나?" 1줄 판단 | **신규** metaCommands.ts |
| `/watch` | 워치리스트 통합 메뉴 | **신규** metaCommands.ts |
| `/positions` | 포지션·손익·미체결 통합 메뉴 | **신규** metaCommands.ts |
| `/learning` | 학습·Kelly·서킷·리스크 통합 메뉴 | **신규** metaCommands.ts |
| `/control` | pause/resume/stop/reset 제어판 | **신규** metaCommands.ts |
| `/admin` | 진단·관리 (숨김 메뉴) | **신규** metaCommands.ts |

#### 인라인 키보드 매핑 (메타 → 기존 alias)

```
/watch       → /watchlist /focus /add /remove /watchlist_channel
/positions   → /pos /pnl /pending /sell /cancel /adjust_qty /reconcile
/learning    → /learning_status /learning_history /kelly /kelly_surface
               /regime_coverage /ledger /counterfactual /risk /circuits
               /reset_circuits /ai_status
/control     → /pause /resume /stop /reset /integrity /refresh_token
               /scan /krx_scan /reconnect_ws
/admin       → /channel_health /channel_stats /alert_history /alert_replay
               /channel_test /dxy /news_lag /todaylog /digest_on /digest_off
               /digest_status /scheduler /health /regime /market /buy
               /stage1_audit /report /shadow
```

**총 51개 alias** — 모든 기존 핸들러는 `case` 문으로 100% 보존. 파워유저는
직접 입력 가능, 신규 사용자는 메타 메뉴로 진입.

#### Callback 라우팅 정책

신규 callback prefix `meta:` 를 도입한다.

```
callback_data = "meta:<action>:<nonce>"
  action = legacy command name (예: "watchlist", "pos_pnl")
```

기존 `buyApproval` / `T1Ack` / `operatorOverride` 핸들러 뒤에 4번째 핸들러로
`handleMetaMenuCallback` 를 prefix 매칭으로 추가. 충돌 없음.

#### `/now` 의사결정 1줄 판단

`/now` 는 다음 SSOT 를 1줄로 압축한다:

- 매크로 레짐 (`loadMacroState().regime`)
- 데이터 무결성 (`getDataIntegrityBlocked`)
- 비상정지 (`getEmergencyStop`)
- 일시정지 (`getAutoTradePaused`)
- 활성 포지션 / 최대 포지션 (`shadowTradeRepo` + `loadTradingSettings`)
- 마지막 매수 신호 시각 (`getLastBuySignalAt`)

응답 예: `🟢 OK (R3, 활성 5/10, 09:23 신호)` / `🔴 STOP (비상정지 ON)` / `🟡 HOLD (R6 방어 모드)`.

### Stage 2 (후속 PR) — 모듈 분해

`webhookHandler.ts` 를 명령어별 파일로 분해 (사용자 플랜 그대로):

```
server/telegram/
├── webhookHandler.ts          (~50줄, 라우팅만)
├── commandRegistry.ts         (자동 등록)
├── commands/
│   ├── _types.ts              (Command 인터페이스)
│   ├── system/                (status, health, regime, ai_status, ...)
│   ├── trade/                 (buy, sell, scan, krx_scan, ...)
│   ├── watchlist/             (watchlist, focus, add, remove, ...)
│   ├── learning/              (learning_*, kelly, ledger, ...)
│   ├── alert/                 (channel_*, alert_*, dxy, ...)
│   └── control/               (pause, resume, stop, reset, ...)
└── meta/
    ├── statusComposer.ts
    ├── nowComposer.ts
    ├── metaCommands.ts        (Stage 1 산출물 — 그대로 유지)
    └── inlineKeyboards.ts
```

`Command` 인터페이스 표준화 + `commandRegistry` 자동 등록으로 새 명령어 추가
시 파일만 떨구면 라우터에 자동 등록.

### Stage 3 (PR-48 구현 완료) — 사용량 텔레메트리 + 자기진화

- `server/persistence/commandUsageRepo.ts` 신설 — `recordUsage(name)` /
  `getTopUsage(N)` / `getStaleCommands(names, days)` / `flushCommandUsage()`
  + 200ms debounce flush + Volume JSON 영속(`COMMAND_USAGE_FILE`).
- `webhookHandler` 가 commandRegistry 매칭 직후 `recordUsage(handler.name)` 1줄로
  카운터 증가. alias 는 정식명으로 정규화되어 동일 인스턴스로 집계.
- `metaCommands.buildHelpMessage(topUsage?)` — Top 5 가 ≥1 건이면 메타 메뉴 위에
  "📊 자주 쓰는 명령 Top 5" 섹션 자동 노출. 신규 사용자(Top 0건) 는 미노출.
- `server/telegram/deprecationReport.ts` — `collectDeprecationCandidates(days)`
  + `formatDeprecationReport(data)` 순수 함수. 카테고리별 그룹핑 + Top 5 대비 표시
  + 30개 절삭 + HTML escape.
- `server/scheduler/commandUsageJobs.ts` — 매주 월요일 09:00 KST 폐기 후보
  T2_REPORT 발송 cron. 후보 0건이면 채팅 노이즈 방지로 스킵.
- 회귀 테스트 — `commandUsageRepo.test.ts` 12 + `deprecationReport.test.ts` 6 +
  `metaCommands.test.ts` Top 5 4 케이스 = 22 신규.

## 결과 (Consequences)

**즉시 효과 (Stage 1)**:
- 사용자가 외워야 할 명령어 8개로 압축 (43 → 8, -81%)
- 신규 사용자 진입 장벽 감소 — 메타 메뉴로 카테고리 탐색 가능
- 기존 핸들러 100% 보존 — 파워유저 무중단

**부작용/한계**:
- `webhookHandler.ts` 가 약 +30줄 증가 (case 6개 + callback 라우팅 4번째)
  — Stage 2 분해 시 즉시 해소 예정.
- 인라인 키보드 callback 은 Telegram 측 프로토콜이라 모바일 UX 의존성 발생.
- `/now` 가 합성 SSOT 라 호출당 비용은 기존 `/status` 와 동등 (KIS 호출 0건,
  메모리 read only).

**임포트 경로 변경**: 없음. 본 PR 은 `server/telegram/metaCommands.ts` 신규 +
`webhookHandler.ts` 내부 case 추가만 수행.

## 대안 검토 (Alternatives Considered)

1. **메뉴 8개로 줄이고 신규 핸들러 0건 (코드 무수정)** — 사용자가 `/now`,
   `/watch` 등 신규 메뉴를 탭했을 때 "Unknown command" 발생. 불가.
2. **Stage 1+2 통합 진행** — 1주 작업이지만 LIVE 자동매매 회귀 위험 (
   webhookHandler 거대 분해 + 메타 도입 동시). Stage 1 에서 사용자 검증 후
   Stage 2 진행이 안전.
3. **명령어 alias 시스템 (`/w` = `/watchlist`)** — 키보드 단축은 되지만
   카테고리화 효과 부재. 메타 메뉴 + 인라인 키보드가 더 직관적.

## Migration Plan

1. **PR-43 (본 PR, Stage 1)**:
   - ADR-0017 작성
   - `server/telegram/metaCommands.ts` 신규 (~250줄)
   - `server/telegram/metaCommands.test.ts` ~15 케이스
   - `webhookHandler.ts` case 6개 + callback prefix 추가
   - `telegramClient.ts setMyCommands` 43 → 8 압축
   - `/help` 메시지 보강 (메타 메뉴 우선 안내)

2. **PR-44 (Stage 2, 후속)**:
   - `commands/*` 디렉토리 분해
   - `commandRegistry` 자동 등록
   - `webhookHandler.ts` ≤50줄 축소 → CLAUDE.md "복잡도 위반" 표에서 제거

3. **PR-48 (Stage 3, 완료)**:
   - `commandUsageRepo` 텔레메트리 (recordUsage / getTopUsage / getStaleCommands)
   - 주간 폐기 후보 리포트 (월요일 09:00 KST T2_REPORT)
   - `/help` 개인화 Top 5

## Non-Goals (Stage 1 범위 밖)

- `webhookHandler.ts` 거대 switch 분해 — Stage 2
- 사용량 추적 텔레메트리 — Stage 3
- 새 비즈니스 로직 추가 (메타 핸들러는 기존 SSOT 호출만)
- LIVE 자동매매 경로 변경 (kisClient / orchestrator / signalScanner 무수정)
