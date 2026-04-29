# ADR-0097 — VerdictCard (V-E-R) + TimeBand (UI Phase C)

**상태**: Accepted (PR-Z10 / Phase C)
**작성일**: 2026-04-29
**관련**: ADR-0019 (RecommendationSnapshot lifecycle), ADR-0028 (UI 재설계 P0 — DataQualityBadge),
ADR-0094 (UI Language SSOT — Phase A), ADR-0096 (IDontKnow + Ribbon — Phase B)

## 배경

사용자 12 아이디어 분석 중 Phase C 의 3 항목 단일 PR 통합:

- **#6 V-E-R Card Migration Gate** (S/C 5.0) — Verdict-Evidence-Risk 3 슬라이스 카드 + 점진 도입 안전망
- **#7 Stop-loss First** (S/C 4.0) — Risk 슬라이스에서 손절가 가장 큰 폰트 (행동경제학 loss framing)
- **#8 Time-band 띠** (S/C 2.5) — Verdict 라벨 아래 1-2px 두께 신뢰 유효시간

세 항목 모두 **종목 카드의 *결정 가능* 형태** 라는 공통 목적 — 분리하면 import/렌더 흐름이 흩어지므로 단일 컴포넌트 세트로 통합.

### 사용자 분석 직접 인용

#### #6 — Migration Gate

> *"V-E-R Card 를 한 번에 모든 종목 카드에 적용하면 화면이 휘청합니다. Card.variant 에 'verdict' 를 추가하되, 기본값은 여전히 'default'. 새 카드는 명시적 opt-in 으로만 V-E-R 모드가 됩니다. 가장 핵심: 3 슬라이스 props 가 모두 빠지면 자동으로 default variant 로 다운그레이드"*

#### #7 — Stop-loss First

> *"페르소나의 'Stop-loss is operating cost, not failure' 를 V-E-R Card 의 가장 깊은 부분에 박습니다. Risk 슬라이스에서 stop-loss 가격이 가장 큰 폰트, invalidation 은 그 다음, scenarios 는 가장 작게."*
>
> *"대부분의 카드 디자인은 '수익률/목표가'를 크게 보여주지만, 이는 사용자의 욕망을 키울 뿐 규율을 만들지 못합니다. 손절가를 가장 크게 보여주면 사용자는 무의식적으로 '감내해야 할 손실'을 먼저 인식하고 매수를 결정합니다."*

행동경제학의 **loss framing** 을 시스템 가치 (손절 규율) 에 정확히 정렬한 디자인 결정.

#### #8 — Time-band

> *"Verdict 가 단지 'Execution Ready' 라고만 표시되면 사용자는 '이 결론이 언제까지 유효한가'를 모릅니다. Verdict 라벨 아래 1-2px 두께의 띠로 신뢰 유효시간을 표시합니다. 띠가 줄어들수록 verdict 의 신뢰도가 줄어들며, 끝에 도달하면 verdict 가 자동으로 'Awaiting Reverification' 로 전환."*

ADR-0019 RecommendationSnapshot lifecycle (`createdAt` + `expiresAt` 30일 만료) 와 결합 — 백엔드 SSOT 가 UI 띠에 그대로 반영. **별도 위젯 아니라 V-E-R Card 의 자연 부분** (1-2px CSS 라인). ExecutionWindow 카운트다운 아이디어 (이전 분석) 를 카드 안 1픽셀 띠로 축소 → Phase C 안에서 자연스럽게 풀림.

## 결정

2 신규 컴포넌트 — Phase A/A-2/B SSOT 위에 자연 확장.

### Layer 1 — `src/components/common/TimeBand.tsx`

```tsx
<TimeBand createdAt={snapshot.createdAt} expiresAt={snapshot.expiresAt} height={2} onExpire={...} />
```

- **`computeRemainingPct(createdAt, expiresAt, now)` 순수 함수 SSOT** — 진행률 ∈ [0, 1] clamp
- **`classifyTimeBandGrade(pct)` 4 분기 SSOT** — FRESH (>0.5) / AGING (>0.2) / STALE (>0) / EXPIRED (=0)
- **색상 매핑**: emerald / amber / red / zinc (1-2px 띠)
- **`onExpire` 콜백** — 만료 도달 시 1회 호출 (parent 가 verdict 라벨 전환 트리거)
- **`tickIntervalMs` 기본 1분** — 시간 진행 자동 갱신
- **`nowProvider` 옵셔널** — 테스트 시 시각 주입 (fake timer 대안)
- **ARIA `role="progressbar"`** + aria-valuenow/min/max 접근성

### Layer 2 — `src/components/common/VerdictCard.tsx` compound

```tsx
<VerdictCard variant="verdict" createdAt={snapshot.createdAt} expiresAt={snapshot.expiresAt}>
  <VerdictCard.Verdict verdict="STRONG_BUY" regime="R2_BULL" />
  <VerdictCard.Evidence>{...ConfluenceMeter (Phase D)}</VerdictCard.Evidence>
  <VerdictCard.Risk stopLoss={9500} entryPrice={10000} invalidation="..." targetPrice={11000} />
</VerdictCard>
```

#### Migration Gate (#6 Migration Gate)

- `variant='default'` (기본값) — 기존 카드와 동일 작동, V-E-R 슬롯 미렌더 → **회귀 0**
- `variant='verdict'` 명시 시에만 V-E-R 모드 진입
- 3 슬롯 children 모두 부재 → 자동 placeholder 다운그레이드
- 신규 카드만 점진 도입, 기존 WatchlistCard 무수정

#### Verdict slot (#6 + #8)

- 5 OverallVerdict 라벨 (STRONG_BUY/BUY/HOLD/CAUTION/AVOID) — `useUILang().card(...)` SSOT
- regime 표시 (R1~R6) — `useUILang().regime(...)` SSOT
- `expired=true` → "재검증 대기" 자동 라벨 전환 (만료 도달 시)
- `data-vcard-verdict` / `data-vcard-regime` / `data-vcard-expired` 속성 (e2e 친화)

#### Evidence slot

- children 자유도 (Phase D `ConfluenceMeter` 사전 등록)
- children 부재 → "근거 미수집" placeholder

#### Risk slot — Stop-loss First (#7)

| 요소 | 폰트 | 위계 | 의도 |
|---|---|---|---|
| 손절가 | `text-2xl font-black` | 가장 큰 | 감내해야 할 손실 *우선* 인식 → 규율 형성 |
| 손절 % | `text-xs font-bold` | 보조 | (-5.0%) 같은 비율 표기 |
| invalidation | `text-sm` | 두 번째 | "박스권 하단 이탈" 같은 청산 트리거 |
| targetPrice | `text-xs opacity-70` | 가장 작은 | 기대 인플레이션 차단 |
| scenarios | `text-xs opacity-80` | 가장 작은 | "긍정 +20% / 부정 -10%" 메모 |

`formatKrw(n)` 헬퍼 — `Intl.NumberFormat('ko-KR')` + NaN/Infinity → "—" 안전 fallback. 손절 % 산출은 entryPrice 있을 때만 (`(stopLoss - entryPrice) / entryPrice * 100`).

#### Time-band 통합 (#8)

- `createdAt` + `expiresAt` 모두 있을 때만 TimeBand 렌더 (옵셔널)
- 만료 도달 → `onExpire` 호출 + `data-vcard-expired="true"` 마커
- ADR-0019 RecommendationSnapshot 결합 — 백엔드 lifecycle 이 UI 띠에 그대로 반영

## 회귀 테스트

**3 파일 신규**:

1. `src/components/common/TimeBand.test.tsx` — jsdom 회귀 22 케이스
   - `computeRemainingPct` 순수 함수 9 (시작/중간/만료/시작전/createdAt≥expiresAt/NaN/ISO)
   - `classifyTimeBandGrade` 4 분기 boundary 8
   - TimeBand 컴포넌트 9 (FRESH/AGING/EXPIRED/STALE grade + onExpire + ARIA + height/className)
2. `src/components/common/VerdictCard.test.tsx` — jsdom 회귀 30 케이스
   - Migration Gate 5 (variant default/verdict + 부재 시 placeholder)
   - Verdict slot 6 (5 OverallVerdict + regime + expired)
   - Risk Stop-loss First 9 (text-2xl 손절가 + 손절% + invalidation text-sm + target text-xs + scenarios + 폰트 위계 + NaN fallback)
   - Evidence slot 2 (children + placeholder)
   - Time-band 4 (렌더 분기 + onExpire + 만료 마커)
   - 통합 4 (V+E+R+TimeBand 모두 + className 전파)
3. ADR-0097 + ARCHITECTURE.md boundary rule + CLAUDE.md 변경 이력

총 신규 약 52 케이스.

## 비결과 (out-of-scope)

본 PR 은 **컴포넌트 신설** — 이하 항목은 후속 PR 분리:

- **WatchlistCard 마이그레이션**: 기존 종목 카드를 VerdictCard 로 점진 전환은 후속 PR (각 컴포넌트 PR 별도 — 회귀 위험 격리)
- **RecommendationSnapshot wiring**: createdAt/expiresAt 을 백엔드 snapshot 에서 주입하는 wiring 은 후속 PR (ADR-0019 결합)
- **DiscoverWatchlistPage Top 3 임베드**: 사용자 분석에서 권장한 "Discovery 페이지 Top 3 카드부터 V-E-R" 시범 임베드는 후속 PR
- **ConfluenceMeter (Phase D)**: Evidence slot 안에 들어갈 ConfluenceMeter 4축 컴포넌트는 PR-Phase-D 별도 (사전 등록만)
- **expired Verdict slot 내부 자동 전환**: 현재 `expired` prop 명시 필요 — `injectExpiredIntoVerdict` 트리 순회 자동 주입은 후속 PR (React.cloneElement 패턴 검토)

## 운영 효과

- **Stop-loss First 규율 형성**: 사용자가 종목 카드를 볼 때 무의식적으로 손절가 (감내 손실) 우선 인식 → 욕망 키우는 카드 디자인 영구 차단
- **신뢰 유효시간 노출**: TimeBand 띠로 verdict 신뢰도가 *시간이 지나면 떨어진다* 는 인지 형성 → 오래된 추천 맹신 차단
- **Migration Gate 회귀 격리**: variant='verdict' 명시적 opt-in 으로 50+ 기존 카드 무영향, 신규/마이그레이션 카드만 V-E-R
- **Phase D 진입 준비**: Evidence slot 이 ConfluenceMeter 4축 (사용자 #9 #10) 컨테이너로 자연 매핑

## 회귀 위험 평가

- **자동매매 본체 0줄 변경** — UI 컴포넌트만 도입 (절대 규칙 #2/#3/#4 미위반)
- **기존 컴포넌트 무수정** — WatchlistCard / GateStatusCard 본체 보존, 마이그레이션은 후속 PR
- **KIS/KRX/Yahoo 호출 0건** — 클라이언트 컴포넌트만
- **회귀 가드** — 신규 52 jsdom 케이스 + computeRemainingPct/classifyTimeBandGrade 순수 함수 17 케이스
- **롤백 안전** — 신규 컴포넌트만 도입, 기존 사용처 0건 (시범 임베드도 본 PR 미포함)
- **TypeScript 안전성** — VerdictCardProps / VerdictSlotProps 등 모든 슬롯 타입 명시 export

## 후속 PR 후보

- **PR-Phase-C-2**: WatchlistCard 마이그레이션 (각 컴포넌트 PR 별도)
- **PR-Phase-C-3**: DiscoverWatchlistPage Top 3 시범 임베드
- **PR-Phase-C-4**: RecommendationSnapshot.createdAt/expiresAt wiring (ADR-0019 결합)
- **PR-Phase-D**: ConfluenceMeter 4축 + 축 결손 사유 (#9, #10) — Evidence slot 안에 자식으로 박힘 (단방향 결합)
- **PR-Verbose**: useSettingsStore uiVerbosity 토글 (#12) — VerdictCard variant + ConfluenceMeter 가시성 분기

## Stack PR 메타

본 PR 의 base = `claude/ui-phase-b-idontknow-ribbon-TVTMY` (PR #422). PR 머지 시 base 자동 변경.
**4중 stack**: PR #420 (Phase A SSOT) → PR #421 (Phase A-2 5-tier) → PR #422 (Phase B IDontKnow + Ribbon) → **본 PR (Phase C V-E-R Card + Stop-loss First + Time-band)**.

자기학습 시리즈 패턴 차용 — Phase 별 단일 PR 분리로 회귀 위험 격리, base 자동 변경으로 stack 단순화.
