# ADR-0100 — UIVerbosityToggle Settings 모달 임베드 (PR-Verbose-Embed)

**상태**: Accepted (PR-Z13 / Phase Verbose 후속 — Embed)
**작성일**: 2026-04-29
**관련**: ADR-0099 (UIVerbosity 토글 + 매트릭스 SSOT, PR #425)

## 배경

PR #425 (ADR-0099) 가 `useSettingsStore.uiVerbosity` + `useUIVerbosity()` hook + `UIVerbosityToggle` 컴포넌트를 도입했지만 **사용자가 토글에 접근할 경로 부재** — 컴포넌트만 정의되고 어디에도 임베드 안 됨. 사용자가 verbosity 를 변경하려면 localStorage 직접 수정이 유일한 방법.

본 PR 은 `UIVerbosityToggle` 을 **SettingsModal 안 신규 "정보 밀도" 섹션** 에 임베드 — 사용자 즉시 접근 가능 + 기존 Settings UX 흐름 자연 통합.

## 결정

`SettingsModal.tsx` 의 ModalBody 에 신규 섹션 추가:
- 위치: API Key + Theme 섹션 다음 (3번째 섹션)
- 라벨: "정보 밀도" + Layers 아이콘
- 컴포넌트: `<UIVerbosityToggle className="w-full justify-between" />` (배너 모드, 풀 라벨 표시)
- 설명 텍스트: 3 단계 의미 안내 ("간결: 핵심 결정만 / 균형: V-E-R 3 슬롯 / 상세: 합치도·결손 사유·신뢰 띠")

## 회귀 테스트

`src/components/common/SettingsModal.embed.test.tsx` — jsdom 회귀 8 케이스:

1. showSettings=true → 모달 렌더 + 토글 임베드 노출 (3 옵션 모두)
2. showSettings=false → 모달 미렌더 → 토글 미노출
3. 임베드 토글 클릭 → store.uiVerbosity 즉시 갱신
4. **Migration Gate** — 기존 섹션 (API Key / Theme) 무영향
5. "정보 밀도" 라벨 + 설명 텍스트 노출 (간결/균형/상세/운영자)
6. balanced 기본값 → balanced 옵션 active
7. minimal → balanced 순환 가능
8. "설정 저장" 버튼 클릭 → showSettings=false (임베드 영향 0)

## 비결과 (out-of-scope)

본 PR 은 **임베드만** — 이하 항목은 후속 PR 분리:

- **컴포넌트 wiring**: VerdictCard / ConfluenceMeter / DataQualityBadge / DataQualityRibbon / IDontKnow / GateStatusCard / GateMiniIndicator 가 `useUIVerbosity().shouldShow(...)` 로 자기 가시성 분기 — 후속 PR-Verbose-Wiring-1~3 (각 컴포넌트 PR 별도, 회귀 위험 격리)
- **페이지 헤더 임베드**: MarketOverviewHeader 등 페이지 상단 compact 토글 — 후속 PR
- **persist 마이그레이션**: 기존 사용자의 localStorage 에 uiVerbosity 부재 시 default 'balanced' fallback (zustand persist 동작) — 회귀 0

## 운영 효과

- **사용자 토글 접근 경로 확보**: Settings 모달 1회 클릭으로 verbosity 변경
- **Settings UX 자연 통합**: 기존 API Key / Theme 옆 신규 섹션, UX 학습 부담 0
- **wiring 후속 PR 효과 가시화 준비**: 토글 작동 후 wiring 진행하면 즉시 시각 변화
- **default 'balanced' 보존**: 기존 사용자 무영향, 토글 변경 시에만 효과

## 회귀 위험 평가

- **자동매매 본체 0줄 변경** — UI 임베드만 (절대 규칙 #2/#3/#4 미위반)
- **기존 SettingsModal 섹션 무수정** — Migration Gate 정합 (회귀 테스트 자동 검증)
- **KIS/KRX/Yahoo 호출 0건** — UI only
- **회귀 가드** — 8 jsdom 케이스 + 기존 섹션 무영향 검증
- **롤백 안전** — 신규 섹션 1개 + import 1개만 추가

## 후속 PR

- **PR-Verbose-Wiring-1**: VerdictCard 자기 가시성 분기 (variant='verdict' + shouldShow('evidence'/'risk'/'time-band'))
- **PR-Verbose-Wiring-2**: ConfluenceMeter atLeast('verbose') 분기
- **PR-Verbose-Wiring-3**: IDontKnow / DataQualityBadge / DataQualityRibbon / GateStatusCard / GateMiniIndicator 가시성 분기 (각 별도 PR — 회귀 위험 격리)
- **PR-Verbose-Header-Embed**: MarketOverviewHeader 페이지 상단 compact 토글 임베드

## 메모

- ADR-0099 (UIVerbosity SSOT 도입) → ADR-0100 (사용자 노출) 자연 의존
- 본 PR 은 PR #425 머지 후 main 위에 빌드 (stack 부재, 단순 PR)
- byte-equivalent 패턴 (SettingsModal 본체 무수정, 신규 섹션 1개 추가만)
