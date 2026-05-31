// @responsibility Blog export, Telegram summary, image capture, and snapshot history for Public Report Mode.

import React, { useMemo, useState } from 'react';
import { ClipboardCopy, Download, Eye, FileCode, FileText, ImageDown, Save, Send, Tags, Trash2 } from 'lucide-react';
import { domToPng } from 'modern-screenshot';
import { toast } from 'sonner';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { Card, CardHeader, CardTitle } from '../../ui/card';
import {
  deletePublicReportSnapshot,
  listPublicReportSnapshots,
  savePublicReportSnapshot,
  summarizePublicReportSnapshots,
} from '../../public-report/reportAdapter';
import type { PublicReportModel, PublicReportSnapshot } from '../../public-report/reportTypes';

interface BlogExportPanelProps {
  report: PublicReportModel;
}

async function copyText(text: string, successMessage: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  } else {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
  toast.success(successMessage);
}

function downloadText(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function previewText(text: string, max = 900): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}\n...`;
}

function SnapshotHistory({
  snapshots,
  onCopy,
  onDelete,
  onView,
}: {
  snapshots: PublicReportSnapshot[];
  onCopy: (snapshot: PublicReportSnapshot, field: 'blogMarkdown' | 'telegramSummary') => void;
  onDelete: (reportId: string) => void;
  onView: (snapshot: PublicReportSnapshot) => void;
}) {
  const rows = summarizePublicReportSnapshots(snapshots).slice(0, 5);

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-white/[0.05] bg-white/[0.025] p-4 text-sm text-white/50">
        저장된 리포트 스냅샷이 아직 없습니다.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((row) => {
        const snapshot = snapshots.find((item) => item.reportId === row.reportId);
        if (!snapshot) return null;
        return (
          <div key={row.reportId} className="grid grid-cols-1 gap-3 rounded-xl border border-white/[0.05] bg-black/10 p-3 lg:grid-cols-[1fr_auto] lg:items-center">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="default" size="sm">{row.reportDate}</Badge>
                <Badge variant={row.marketGateStatus === 'RED' ? 'danger' : row.marketGateStatus === 'GREEN' ? 'success' : 'warning'} size="sm">
                  {row.marketGateStatus}
                </Badge>
                <span className="truncate text-xs font-bold text-white/50">{row.sourceSnapshotId}</span>
              </div>
              <p className="mt-2 truncate text-sm font-black text-white">{snapshot.blogTitle}</p>
              <p className="mt-1 text-xs text-white/45">
                섹터 {row.topSectors.join(' / ') || 'N/A'} · 후보 {row.candidateCount} · 차단 {row.blockedCount} · Shadow {row.shadowCount}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="ghost" size="sm" icon={<Eye className="h-4 w-4" />} onClick={() => onView(snapshot)}>
                보기
              </Button>
              <Button type="button" variant="ghost" size="sm" icon={<ClipboardCopy className="h-4 w-4" />} onClick={() => onCopy(snapshot, 'blogMarkdown')}>
                Markdown
              </Button>
              <Button type="button" variant="ghost" size="sm" icon={<Send className="h-4 w-4" />} onClick={() => onCopy(snapshot, 'telegramSummary')}>
                Telegram
              </Button>
              <Button type="button" variant="danger" size="sm" icon={<Trash2 className="h-4 w-4" />} onClick={() => onDelete(row.reportId)}>
                삭제
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ReportCaptureLayout({ report }: { report: PublicReportModel }) {
  const market = report.marketGate;
  const sector = report.sectorRotation;
  const summary = report.candidateSummary;

  return (
    <div id="public-report-capture-layout" className="w-full max-w-[1080px] rounded-2xl border border-white/[0.07] bg-[#06111f] p-6 text-white shadow-xl">
      <div className="flex items-start justify-between gap-6">
        <div>
          <p className="text-xs font-black tracking-tight text-blue-200/70">QuantMaster 공개 리포트</p>
          <h3 className="mt-2 text-2xl font-black tracking-tight">{report.blogTitle}</h3>
          <p className="mt-2 text-sm text-white/55">스냅샷 {report.sourceSnapshotId} · {report.reportDate}</p>
        </div>
        <Badge variant="info" size="md">공개</Badge>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.04] p-4">
          <p className="text-[10px] font-semibold tracking-tight text-white/45">마켓 게이트</p>
          <p className="mt-2 text-3xl font-black">{market?.marketGateStatus ?? 'GRAY'}</p>
          <p className="mt-1 text-sm text-white/60">MHS {market?.macroHealthScore ?? 0}/100 · {market?.engineMode ?? 'UNKNOWN'}</p>
          <p className="mt-3 text-xs leading-relaxed text-white/55">{market?.primaryReason ?? '시장 데이터 검증이 필요합니다.'}</p>
        </div>
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.04] p-4">
          <p className="text-[10px] font-semibold tracking-tight text-white/45">섹터 로테이션</p>
          <div className="mt-3 space-y-2">
            {(sector?.topSectors.slice(0, 3) ?? []).map((item, index) => (
              <div key={item.sectorName} className="flex items-center justify-between gap-3 text-sm">
                <span>{index + 1}. {item.sectorName}</span>
                <span className="font-black">{item.sectorScore}</span>
              </div>
            ))}
            {sector?.topSectors.length === 0 && <p className="text-sm text-white/45">검증 필요</p>}
          </div>
        </div>
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.04] p-4">
          <p className="text-[10px] font-semibold tracking-tight text-white/45">후보 요약</p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <span>관찰</span><b className="text-right">{summary.watchCount}</b>
            <span>대기</span><b className="text-right">{summary.waitPullbackCount}</b>
            <span>차단</span><b className="text-right">{summary.blockedCount}</b>
            <span>Shadow</span><b className="text-right">{summary.shadowTrackingCount}</b>
          </div>
        </div>
      </div>

      <p className="mt-6 text-xs leading-relaxed text-white/45">
        공개 캡처에는 진입가, 손절가, 목표가, 분할매수 계획, 원시 로그, 공급자 응답, 실행 추적이 포함되지 않습니다.
      </p>
    </div>
  );
}

export function BlogExportPanel({ report }: BlogExportPanelProps) {
  const [snapshots, setSnapshots] = useState<PublicReportSnapshot[]>(() => listPublicReportSnapshots());
  const [selectedSnapshot, setSelectedSnapshot] = useState<PublicReportSnapshot | null>(null);
  const tagText = useMemo(() => report.blogTags.join(' '), [report.blogTags]);

  const refreshSnapshots = () => setSnapshots(listPublicReportSnapshots());

  const handleSaveSnapshot = () => {
    const snapshot = savePublicReportSnapshot(report);
    setSelectedSnapshot(snapshot);
    refreshSnapshots();
    toast.success('리포트 스냅샷을 저장했습니다');
  };

  const handleDeleteSnapshot = (reportId: string) => {
    deletePublicReportSnapshot(reportId);
    if (selectedSnapshot?.reportId === reportId) setSelectedSnapshot(null);
    refreshSnapshots();
    toast.success('리포트 스냅샷을 삭제했습니다');
  };

  const handleDownloadImage = async () => {
    const element = document.getElementById('public-report-capture-layout');
    if (!element) {
      toast.error('리포트 캡처 레이아웃을 사용할 수 없습니다');
      return;
    }

    try {
      const dataUrl = await domToPng(element, {
        backgroundColor: '#06111f',
        scale: 2,
        width: element.scrollWidth,
        height: element.scrollHeight,
      });
      const anchor = document.createElement('a');
      anchor.href = dataUrl;
      anchor.download = `${report.reportDate}-quantmaster-public-report.png`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      toast.success('리포트 이미지를 다운로드했습니다');
    } catch {
      downloadText(`${report.reportDate}-quantmaster-public-report.html`, report.blogHtml, 'text/html;charset=utf-8');
      toast.warning('이미지 캡처에 실패하여 HTML 내보내기로 대체 다운로드했습니다');
    }
  };

  return (
    <Card id="public-report-blog-export" padding="sm" className="scroll-mt-24">
      <CardHeader className="mb-4">
        <CardTitle>블로그 내보내기 & 리포트 스냅샷</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="info" size="sm">네이버 붙여넣기 지원</Badge>
          <Badge variant="success" size="sm">Shadow 리포트 ON</Badge>
          <Badge variant="default" size="sm">원시 로그 제외</Badge>
        </div>
      </CardHeader>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-4">
          <div id="public-report-telegram-summary" className="scroll-mt-24 rounded-xl border border-white/[0.05] bg-white/[0.025] p-4">
            <p className="text-[10px] font-black tracking-tight text-white/40">블로그 제목 미리보기</p>
            <p className="mt-2 text-lg font-black text-white">{report.blogTitle}</p>
            <p className="mt-2 text-sm leading-relaxed text-white/55">{report.oneLineSummary}</p>
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="rounded-xl border border-white/[0.05] bg-black/20 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-black tracking-tight text-white/40">Markdown 미리보기</p>
                <Badge variant="default" size="sm">{report.blogMarkdown.split('\n').length}줄</Badge>
              </div>
              <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-black/20 p-3 text-xs leading-relaxed text-white/60">
                {previewText(report.blogMarkdown)}
              </pre>
            </div>
            <div className="rounded-xl border border-white/[0.05] bg-black/20 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-black tracking-tight text-white/40">HTML 미리보기</p>
                <Badge variant="default" size="sm">네이버 붙여넣기</Badge>
              </div>
              <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-black/20 p-3 text-xs leading-relaxed text-white/60">
                {previewText(report.blogHtml)}
              </pre>
            </div>
          </div>

          <div className="rounded-xl border border-white/[0.05] bg-white/[0.025] p-4">
            <p className="text-[10px] font-black tracking-tight text-white/40">네이버 태그 추천</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {report.blogTags.map((tag) => (
                <Badge key={tag} variant="default" size="sm">{tag}</Badge>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-white/[0.05] bg-white/[0.025] p-4">
            <p className="text-[10px] font-black tracking-tight text-white/40">Telegram 요약 미리보기</p>
            <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-black/20 p-3 text-xs leading-relaxed text-white/65">{report.telegramSummary}</pre>
          </div>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-2">
            <Button type="button" variant="secondary" size="sm" icon={<FileText className="h-4 w-4" />} onClick={() => copyText(report.blogTitle, '블로그 제목을 복사했습니다')}>
              블로그 제목 복사
            </Button>
            <Button type="button" variant="secondary" size="sm" icon={<ClipboardCopy className="h-4 w-4" />} onClick={() => copyText(report.blogMarkdown, '블로그 Markdown을 복사했습니다')}>
              블로그 Markdown 복사
            </Button>
            <Button type="button" variant="secondary" size="sm" icon={<FileCode className="h-4 w-4" />} onClick={() => copyText(report.blogHtml, '블로그 HTML을 복사했습니다')}>
              블로그 HTML 복사
            </Button>
            <Button type="button" variant="secondary" size="sm" icon={<Tags className="h-4 w-4" />} onClick={() => copyText(tagText, '블로그 태그를 복사했습니다')}>
              태그 복사
            </Button>
            <Button type="button" variant="secondary" size="sm" icon={<Send className="h-4 w-4" />} onClick={() => copyText(report.telegramSummary, 'Telegram 요약을 복사했습니다')}>
              Telegram 요약 복사
            </Button>
            <Button type="button" variant="secondary" size="sm" icon={<ImageDown className="h-4 w-4" />} onClick={handleDownloadImage}>
              리포트 이미지 다운로드
            </Button>
            <Button type="button" variant="ghost" size="sm" icon={<Download className="h-4 w-4" />} onClick={() => downloadText(`${report.reportDate}-quantmaster-report.html`, report.blogHtml, 'text/html;charset=utf-8')}>
              블로그 HTML 다운로드
            </Button>
            <Button type="button" variant="primary" size="sm" icon={<Save className="h-4 w-4" />} onClick={handleSaveSnapshot}>
              리포트 스냅샷 저장
            </Button>
          </div>

          <div className="rounded-xl border border-white/[0.05] bg-white/[0.025] p-4">
            <p className="text-[10px] font-black tracking-tight text-white/40">공개 내보내기 범위</p>
            <p className="mt-2 text-xs leading-relaxed text-white/55">
              공개 내보내기에는 시장 상태, 상위 섹터, 후보 요약, 차단 사유, Shadow 성과, 데이터 신뢰도가 포함됩니다. 진입가, 손절가, 목표가, 분할매수 계획, 원시 공급자 응답, 실행 추적은 제외됩니다.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-5">
        <ReportCaptureLayout report={report} />
      </div>

      <div className="mt-5 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-black text-white">리포트 스냅샷 기록</p>
            <p className="text-xs text-white/45">저장된 리포트를 다시 열어 Markdown 또는 Telegram으로 복사할 수 있습니다.</p>
          </div>
          <Badge variant="default" size="sm">{snapshots.length}개 저장됨</Badge>
        </div>
        <SnapshotHistory
          snapshots={snapshots}
          onCopy={(snapshot, field) => copyText(snapshot[field], field === 'blogMarkdown' ? '스냅샷 Markdown을 복사했습니다' : '스냅샷 Telegram을 복사했습니다')}
          onDelete={handleDeleteSnapshot}
          onView={setSelectedSnapshot}
        />
        {selectedSnapshot && (
          <div className="rounded-xl border border-blue-400/20 bg-blue-400/[0.04] p-4">
            <p className="text-[10px] font-black tracking-tight text-blue-100/70">선택한 스냅샷</p>
            <p className="mt-2 text-sm font-black text-white">{selectedSnapshot.blogTitle}</p>
            <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-black/20 p-3 text-xs leading-relaxed text-white/60">
              {previewText(selectedSnapshot.blogMarkdown, 700)}
            </pre>
          </div>
        )}
      </div>
    </Card>
  );
}
