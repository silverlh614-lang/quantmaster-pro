// @responsibility index 텔레그램 모듈
// @responsibility: commands/trade/* 11 cmd 자동 등록 (buy/sell/cancel/adjust_qty/reconcile+reconcile_qty/scan/krx_scan/stage1_audit/report/shadow/force_watch_scan).
import './adjustQty.cmd.js';
import './buy.cmd.js';
import './cancel.cmd.js';
import './forceWatchScan.cmd.js';
import './krxScan.cmd.js';
import './reconcile.cmd.js';
import './report.cmd.js';
import './scan.cmd.js';
import './sell.cmd.js';
import './shadow.cmd.js';
import './stage1Audit.cmd.js';

export {};
