// @responsibility index 텔레그램 모듈
// @responsibility: commands/control/* 10 cmd 자동 등록 (pause/resume/stop/reset/integrity/unblockBuy/unmanageOnly/guards/r3Unblock/r3Status).
import './integrity.cmd.js';
import './pause.cmd.js';
import './reset.cmd.js';
import './resume.cmd.js';
import './stop.cmd.js';
// ADR-0194 — UI EmergencyActionsPanel 등가 텔레그램 명령 + 가드 통합 조회.
import './unblockBuy.cmd.js';
import './unmanageOnly.cmd.js';
import './guards.cmd.js';
// ADR-0195 — R3 sanity block 영속 latch 텔레그램 즉시 해제.
import './r3Unblock.cmd.js';
// ADR-0401 — R3 Sanity 단계형 state machine 통합 진단 (read-only).
import './r3Status.cmd.js';

export {};
