# WARN Classification (P0~P5)

## 목적
운영 런타임 경고(P0~P4)와 문서/테스트/선언형 문자열(P5)을 분리하여 운영 지표 정확도를 보장한다.

## 분류
- P0~P4: runtimeCounted=true, 운영 경고 집계 포함
- P5: runtimeCounted=false, executionImpact=NONE, 운영 경고 집계/레일웨이 로그/텔레그램 운영 경고 알림 제외

## P5 reason 코드
- P5_DOC_ONLY_WARN (DOC_ONLY)
- P5_ADR_ONLY_WARN (ADR_ONLY)
- P5_TEST_ONLY_WARN (TEST_ONLY)
- P5_TYPE_ONLY_WARN (TYPE_ONLY)
- P5_ENUM_ONLY_WARN (ENUM_ONLY)
- P5_EXAMPLE_ONLY_WARN (EXAMPLE_ONLY)
- P5_WORKSPACE_ONLY_WARN (WORKSPACE_ONLY)
- P5_FIXTURE_ONLY_WARN (FIXTURE_ONLY)

## 필수 제외/분류 패턴
- docs/**
- docs/adr/**
- _workspace/**
- **/*.md
- **/*.mdx
- **/*.test.ts
- **/*.test.js
- **/*.spec.ts
- **/*.spec.js
- **/__tests__/**
- **/__mocks__/**
- **/fixtures/**
- **/samples/**
- **/examples/**
- **/*.fixture.ts
- **/*.mock.ts
- **/*.sample.ts
- ARCHITECTURE.md
- README.md
- .env.example

## 보호 규칙
- server/**, src/**의 실제 runtime `console.warn`은 P5로 숨기지 않는다.
- scripts/** 중 runtime 실행 경로는 문서/테스트로 오판되지 않도록 별도 검토한다.
- `suspiciousP5Candidates`를 항상 보고하여 오분류를 조기 탐지한다.
