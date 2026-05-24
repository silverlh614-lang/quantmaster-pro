// @responsibility Blog export, Telegram summary, image capture, snapshot history for Public Report Mode.

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
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4 text-sm text-white/50">
        No saved report snapshots yet.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((row) => {
        const snapshot = snapshots.find((item) => item.reportId === row.reportId);
        if (!snapshot) return null;
        return (
          <div key={row.reportId} className="grid grid-cols-1 gap-3 rounded-xl border border-white/[0.08] bg-black/10 p-3 lg:grid-cols-[1fr_auto] lg:items-center">
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
                sectors {row.topSectors.join(' / ') || 'N/A'} · candidates {row.candidateCount} · blocked {row.blockedCount} · shadow {row.shadowCount}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="ghost" size="sm" icon={<Eye className="h-4 w-4" />} onClick={() => onView(snapshot)}>
                View
              </Button>
              <Button type="button" variant="ghost" size="sm" icon={<ClipboardCopy className="h-4 w-4" />} onClick={() => onCopy(snapshot, 'blogMarkdown')}>
                Markdown
              </Button>
              <Button type="button" variant="ghost" size="sm" icon={<Send className="h-4 w-4" />} onClick={() => onCopy(snapshot, 'telegramSummary')}>
                Telegram
              </Button>
              <Button type="button" variant="danger" size="sm" icon={<Trash2 className="h-4 w-4" />} onClick={() => onDelete(row.reportId)}>
                Delete
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
    <div id="public-report-capture-layout" className="w-full max-w-[1080px] rounded-2xl border border-white/10 bg-[#06111f] p-6 text-white shadow-2xl">
      <div className="flex items-start justify-between gap-6">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.22em] text-blue-200/70">QuantMaster Public Report</p>
          <h3 className="mt-2 text-2xl font-black tracking-tight">{report.blogTitle}</h3>
          <p className="mt-2 text-sm text-white/55">snapshot {report.sourceSnapshotId} · {report.reportDate}</p>
        </div>
        <Badge variant="info" size="md">PUBLIC</Badge>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
          <p className="text-[10px] font-black uppercase tracking-wider text-white/45">Market Gate</p>
          <p className="mt-2 text-3xl font-black">{market?.marketGateStatus ?? 'GRAY'}</p>
          <p className="mt-1 text-sm text-white/60">MHS {market?.macroHealthScore ?? 0}/100 · {market?.engineMode ?? 'UNKNOWN'}</p>
          <p className="mt-3 text-xs leading-relaxed text-white/55">{market?.primaryReason ?? 'Market data requires verification.'}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
          <p className="text-[10px] font-black uppercase tracking-wider text-white/45">Sector Rotation</p>
          <div className="mt-3 space-y-2">
            {(sector?.topSectors.slice(0, 3) ?? []).map((item, index) => (
              <div key={item.sectorName} className="flex items-center justify-between gap-3 text-sm">
                <span>{index + 1}. {item.sectorName}</span>
                <span className="font-black">{item.sectorScore}</span>
              </div>
            ))}
            {sector?.topSectors.length === 0 && <p className="text-sm text-white/45">Needs verification</p>}
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
          <p className="text-[10px] font-black uppercase tracking-wider text-white/45">Candidate Summary</p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <span>Watch</span><b className="text-right">{summary.watchCount}</b>
            <span>Wait</span><b className="text-right">{summary.waitPullbackCount}</b>
            <span>Blocked</span><b className="text-right">{summary.blockedCount}</b>
            <span>Shadow</span><b className="text-right">{summary.shadowTrackingCount}</b>
          </div>
        </div>
      </div>

      <p className="mt-6 text-xs leading-relaxed text-white/45">
        Public capture excludes entry price, stop price, target price, tranche plans, raw logs, provider responses, and execution traces.
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
    toast.success('Report snapshot saved');
  };

  const handleDeleteSnapshot = (reportId: string) => {
    deletePublicReportSnapshot(reportId);
    if (selectedSnapshot?.reportId === reportId) setSelectedSnapshot(null);
    refreshSnapshots();
    toast.success('Report snapshot deleted');
  };

  const handleDownloadImage = async () => {
    const element = document.getElementById('public-report-capture-layout');
    if (!element) {
      toast.error('Report capture layout is not available');
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
      toast.success('Report image downloaded');
    } catch {
      downloadText(`${report.reportDate}-quantmaster-public-report.html`, report.blogHtml, 'text/html;charset=utf-8');
      toast.warning('Image capture failed; HTML export was downloaded instead');
    }
  };

  return (
    <Card id="public-report-blog-export" padding="sm" className="scroll-mt-24">
      <CardHeader className="mb-4">
        <CardTitle>Blog Export & Report Snapshot</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="info" size="sm">Naver-ready copy</Badge>
          <Badge variant="success" size="sm">Shadow report ON</Badge>
          <Badge variant="default" size="sm">raw logs excluded</Badge>
        </div>
      </CardHeader>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-4">
          <div id="public-report-telegram-summary" className="scroll-mt-24 rounded-xl border border-white/[0.08] bg-white/[0.025] p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/40">Blog Title Preview</p>
            <p className="mt-2 text-lg font-black text-white">{report.blogTitle}</p>
            <p className="mt-2 text-sm leading-relaxed text-white/55">{report.oneLineSummary}</p>
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="rounded-xl border border-white/[0.08] bg-black/20 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/40">Markdown Preview</p>
                <Badge variant="default" size="sm">{report.blogMarkdown.split('\n').length} lines</Badge>
              </div>
              <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-black/20 p-3 text-xs leading-relaxed text-white/60">
                {previewText(report.blogMarkdown)}
              </pre>
            </div>
            <div className="rounded-xl border border-white/[0.08] bg-black/20 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/40">HTML Preview</p>
                <Badge variant="default" size="sm">Naver paste</Badge>
              </div>
              <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-black/20 p-3 text-xs leading-relaxed text-white/60">
                {previewText(report.blogHtml)}
              </pre>
            </div>
          </div>

          <div className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/40">Naver Tag Suggestions</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {report.blogTags.map((tag) => (
                <Badge key={tag} variant="default" size="sm">{tag}</Badge>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/40">Telegram Summary Preview</p>
            <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-black/20 p-3 text-xs leading-relaxed text-white/65">{report.telegramSummary}</pre>
          </div>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-2">
            <Button type="button" variant="secondary" size="sm" icon={<FileText className="h-4 w-4" />} onClick={() => copyText(report.blogTitle, 'Blog title copied')}>
              Copy Blog Title
            </Button>
            <Button type="button" variant="secondary" size="sm" icon={<ClipboardCopy className="h-4 w-4" />} onClick={() => copyText(report.blogMarkdown, 'Blog Markdown copied')}>
              Copy Blog Markdown
            </Button>
            <Button type="button" variant="secondary" size="sm" icon={<FileCode className="h-4 w-4" />} onClick={() => copyText(report.blogHtml, 'Blog HTML copied')}>
              Copy Blog HTML
            </Button>
            <Button type="button" variant="secondary" size="sm" icon={<Tags className="h-4 w-4" />} onClick={() => copyText(tagText, 'Blog tags copied')}>
              Copy Tags
            </Button>
            <Button type="button" variant="secondary" size="sm" icon={<Send className="h-4 w-4" />} onClick={() => copyText(report.telegramSummary, 'Telegram summary copied')}>
              Copy Telegram Summary
            </Button>
            <Button type="button" variant="secondary" size="sm" icon={<ImageDown className="h-4 w-4" />} onClick={handleDownloadImage}>
              Download Report Image
            </Button>
            <Button type="button" variant="ghost" size="sm" icon={<Download className="h-4 w-4" />} onClick={() => downloadText(`${report.reportDate}-quantmaster-report.html`, report.blogHtml, 'text/html;charset=utf-8')}>
              Download Blog HTML
            </Button>
            <Button type="button" variant="primary" size="sm" icon={<Save className="h-4 w-4" />} onClick={handleSaveSnapshot}>
              Save Report Snapshot
            </Button>
          </div>

          <div className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/40">Public Export Boundary</p>
            <p className="mt-2 text-xs leading-relaxed text-white/55">
              Public export includes market state, top sectors, candidate summary, block reasons, Shadow performance, and data trust. Entry, stop, target, tranche plans, raw provider responses, and execution traces stay out.
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
            <p className="text-sm font-black text-white">Report Snapshot History</p>
            <p className="text-xs text-white/45">Saved reports can be reopened for Markdown or Telegram copy.</p>
          </div>
          <Badge variant="default" size="sm">{snapshots.length} saved</Badge>
        </div>
        <SnapshotHistory
          snapshots={snapshots}
          onCopy={(snapshot, field) => copyText(snapshot[field], field === 'blogMarkdown' ? 'Snapshot Markdown copied' : 'Snapshot Telegram copied')}
          onDelete={handleDeleteSnapshot}
          onView={setSelectedSnapshot}
        />
        {selectedSnapshot && (
          <div className="rounded-xl border border-blue-400/20 bg-blue-400/[0.04] p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-100/70">Selected Snapshot</p>
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
