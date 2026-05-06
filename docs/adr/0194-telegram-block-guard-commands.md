# ADR-0194 — 텔레그램 신규 매수 차단 가드 명령 신설 (`/unblock_buy` + `/unmanage_only` + `/guards`)

@responsibility EmergencyActionsPanel 등가 텔레그램 명령 + 6 가드 통합 진단 SSOT.

## 컨텍스트

ADR-0193 (PR #619) 가 `/auto-trade/engine/manage-only` 비대칭 coupling 결함을
HTTP API + UI 측에서 차단했지만, **텔레그램 채널에서는 해제 명령 부재**:

| 가드 | 활성화 | 해제 (기존) | 해제 (본 ADR) |
|------|--------|-------------|---------------|
| `EMERGENCY_STOP` | `/stop` | `/reset <pwd>` | (기존) |
| `AUTO_TRADE_PAUSED` | `/pause` | `/resume` | (기존) |
| `DATA_INTEGRITY_BLOCKED` | (자동) | `/integrity clear` | (기존) |
| `MANUAL_BLOCK_NEW_BUY` | UI/HTTP | ❌ **부재** | **`/unblock_buy`** |
| `MANUAL_MANAGE_ONLY` | UI/HTTP | ❌ **부재** | **`/unmanage_only`** |
| 통합 조회 | — | ❌ **부재** | **`/guards`** |

사용자 5/6 보고 "신규매수차단 해제기능이 구현안된건가? 해제가 안됨" 의 텔레그램
채널 보강 — UI/HTTP 외 운영 채널 동등성 회복.

## 결정

### 결정 1 — `/unblock_buy` (alias `/unblock`, `/allow_buy`)

`MANUAL_BLOCK_NEW_BUY` 만 해제. category=`EMR`, riskLevel=1 (light mutate, ADR-0017
정합 — `/integrity` 와 동일 수준). 이미 비활성 시 멱등 안내. `MANUAL_MANAGE_ONLY`
상태도 함께 표시 (운영자가 다음 액션 결정).

### 결정 2 — `/unmanage_only` (alias `/manage_off`, `/unmanage`)

`MANUAL_MANAGE_ONLY` 해제 + ADR-0193 대칭 coupling 으로 `MANUAL_BLOCK_NEW_BUY`
도 동시 해제. ENV `MANAGE_ONLY_SYMMETRIC_COUPLING_DISABLED=true` 활성 시 legacy
모드 (manageOnly 만 해제, blockNewBuy 보존). `engineRouter.ts` 의 `/manage-only`
엔드포인트와 정책 byte-equivalent.

### 결정 3 — `/guards` (alias `/block_status`, `/blocks`)

6 가드 + 일일 손실 한도 + Pre-Market Smoke Test 통합 read-only 조회.
category=`EMR`, riskLevel=0 (read-only). 운영자가 *지금 신규 매수가 왜 안 되는지*
1 명령으로 식별. 각 가드별 해제 명령 라벨 명시.

### 결정 4 — barrel `commands/control/index.ts` +3 import

ADR-0017 commandRegistry SSOT 패턴 — 신규 명령 추가는 파일 1개 + barrel 1줄만.
`buildBotMenuCommandsExtended` (ADR-0017 §"메뉴 자동 동기화") 가 자동 노출.

## 안전 invariant 5종

1. **LIVE 매매 본체 0줄 변경** — `kisClient/**` / `signalScanner.ts` /
   `entryEngine.ts` / `orchestrator/**` / `autoTradeEngine*` 본체 무수정.
   3 명령 모두 `state.ts` SSOT read/write 만.
2. **KIS/KRX 자동매매 quota 0 침범** — 절대 규칙 #2/#3/#4. 외부 호출 0건.
3. **ADR-0193 대칭 coupling 정합 보존** — `/unmanage_only` 가 `engineRouter`
   `/manage-only` 와 동일 정책 (ENV 분기 byte-equivalent).
4. **commandRegistry 단일 통로** — ADR-0017 패턴 준수. 직접 `webhookHandler`
   case 추가 금지 (PR-43~48 압축 유지).
5. **read-only `/guards` riskLevel=0** — state.ts 외 호출 0, 6 가드 + 2 추가
   상태 모두 동시 캡처.

## 잘못된 해결 방법 영구 차단 5종

1. **`/unmanage_only` 가 `setManualManageOnly(false)` 만 호출** — ADR-0193
   대칭 coupling 정책 위반 (HTTP vs 텔레그램 동작 불일치).
2. **6 가드 일괄 해제 명령 (`/unblock_all`) 신설** — 위험. 비상정지 / 무결성
   차단 등 *각 가드는 독립 의미* 보존. 운영자 명시적 개별 해제 의무.
3. **별도 `webhookHandler.ts` switch case 추가** — ADR-0017 commandRegistry
   SSOT 위반. 본 PR 은 `commands/control/*.cmd.ts` 패턴 정합.
4. **`/guards` 에 mutation 액션 버튼 (인라인 키보드)** — riskLevel=0 read-only
   원칙 위반 + 우발적 토글 위험.
5. **alias 명령에 별도 동작 부여** — `/unblock`/`/allow_buy` 모두 동일 인스턴스
   바인딩 (ADR-0017 commandRegistry 패턴).

## 회귀 테스트 ≥10 케이스

- `controlGuardCommandsAdr0194.test.ts` — 정적 grep 가드 (3 cmd 파일 존재 +
  barrel 등록 + commandRegistry import + alias 등록) + 동작 매트릭스
  (`/unblock_buy` 활성→해제 / 이미 해제 시 멱등 / `/unmanage_only` ADR-0193
  symmetric / legacy ENV 보존 / `/guards` read-only + 6 가드 라벨).

## 운영자 활성화 절차

본 PR 머지 직후 자동 활성화. `commandRegistry` 자동 등록 + 텔레그램 봇 메뉴
자동 노출 (`buildBotMenuCommandsExtended`). 추가 ENV 설정 불필요.

회귀 발견 시 ENV `MANAGE_ONLY_SYMMETRIC_COUPLING_DISABLED=true` (ADR-0193 정합)
또는 commandRegistry 등록 해제 (barrel import 주석 처리, hot-fix PR).

## 결과

1. 운영자가 텔레그램 1 명령으로 신규 매수 차단 / 보유만 관리 모드 즉시 해제.
2. `/guards` 1 명령으로 6 가드 + 일일 손실 + 스모크 테스트 통합 진단 — *왜
   안 되는지* 식별 시간 ↓.
3. UI / HTTP / 텔레그램 3 채널 운영 동등성 회복.
4. ADR-0193 대칭 coupling 정책의 텔레그램 채널 노출 — *"해제가 안 됨"* 사용자
   보고 패턴 영구 차단.
