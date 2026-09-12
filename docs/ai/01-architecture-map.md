# 구조 안내

- src/: 화면·공유 타입·클라이언트 서비스.
- server/: 데이터 수집·매매·학습·스케줄·API.
- scripts/: 정적 검사·검증.
- docs/adr/: 설계 결정. INDEX.md는 번호·파일 검색용.
- 모듈 책임은 [ARCHITECTURE.md](../../ARCHITECTURE.md)에서 대상 경로만 검색한다.

## 작업 방식

[AGENTS.md](../../AGENTS.md)의 단일 에이전트·최소 기록 절차를 따른다. 고정 역할팀이나 하네스는 없다.
큰 파일도 현재 크기와 import/테스트를 확인한 뒤 필요한 책임만 분리한다. 오래된 줄 수 표와 완료 목록은 복제하지 않는다.
복잡도 기준과 예외는 scripts/check_complexity.js가 관리한다. 검증 결과로 현재 상태를 판단한다.
