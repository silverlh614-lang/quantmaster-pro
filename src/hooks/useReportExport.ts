// @responsibility useReportExport React hook
import { useRef } from 'react';
import { toast } from 'sonner';
import { domToJpeg } from 'modern-screenshot';
import { jsPDF } from 'jspdf';
import { generateReportSummary } from '../services/stockService';
import { useRecommendationStore, useMarketStore, useAnalysisStore, useSettingsStore } from '../stores';
import { debugLog } from '../utils/debug';

export function useReportExport() {
  const { recommendations, searchResults } = useRecommendationStore();
  const { marketContext } = useMarketStore();
  const {
    deepAnalysisStock, reportSummary, setReportSummary,
    isSummarizing, setIsSummarizing,
    isGeneratingPDF, setIsGeneratingPDF,
    isExportingDeepAnalysis, setIsExportingDeepAnalysis,
    isSendingEmail, setIsSendingEmail,
  } = useAnalysisStore();
  const { emailAddress } = useSettingsStore();
  const analysisReportRef = useRef<HTMLDivElement>(null);

  const generatePDF = async (shouldDownload = true): Promise<string | null> => {
    setIsGeneratingPDF(true);
    debugLog('PDF 생성 시작 (modern-screenshot 사용)...');
    const originalStyles = new Map<HTMLElement, any>();
    const originalScrollY = window.scrollY;
    try {
      const element = document.getElementById('report-content');
      if (!element) {
        console.error('report-content element not found');
        toast.error('리포트 내용을 찾을 수 없습니다.');
        return null;
      }

      // Ensure we are at the top to capture everything correctly
      window.scrollTo(0, 0);

      // Give a small delay for any animations or lazy-loaded content to settle
      await new Promise(resolve => setTimeout(resolve, 800));

      // Temporarily expand all scrollable containers to capture full content
      const scrollableElements = element.querySelectorAll('.overflow-y-auto, .overflow-auto');
      
      scrollableElements.forEach((el) => {
        const htmlEl = el as HTMLElement;
        originalStyles.set(htmlEl, {
          maxHeight: htmlEl.style.maxHeight,
          overflow: htmlEl.style.overflow,
          overflowY: htmlEl.style.overflowY,
          height: htmlEl.style.height
        });
        htmlEl.style.maxHeight = 'none';
        htmlEl.style.overflow = 'visible';
        htmlEl.style.overflowY = 'visible';
        htmlEl.style.height = 'auto';
      });

      const fullHeight = element.scrollHeight;
      const fullWidth = element.scrollWidth;
      
      debugLog(`리포트 크기: ${fullWidth}x${fullHeight}`);

      // Cap scale if height is too large to avoid browser canvas limits (approx 32k)
      // Most browsers have a limit around 32,767px for canvas dimensions
      let captureScale = 1.5;
      if (fullHeight * captureScale > 30000) {
        captureScale = Math.max(1, 30000 / fullHeight);
        debugLog(`높이가 너무 커서 스케일을 ${captureScale.toFixed(2)}로 조정합니다.`);
      }

      debugLog('domToJpeg 호출 중...');
      // modern-screenshot supports modern CSS like oklch/oklab
      // We force height auto and overflow visible to ensure full capture
      const imgData = await domToJpeg(element, {
        scale: captureScale,
        quality: 0.8,
        backgroundColor: '#050505',
        width: fullWidth,
        height: fullHeight,
        style: {
          borderRadius: '0',
          backdropFilter: 'none',
          height: 'auto',
          overflow: 'visible',
          maxHeight: 'none',
          margin: '0',
          padding: '20px', // Add some padding for the PDF
        }
      });

      debugLog('이미지 생성 완료, PDF 변환 중...');
      
      // Create a temporary image to get dimensions
      const img = new Image();
      img.src = imgData;
      await new Promise((resolve) => (img.onload = resolve));

      const pdf = new jsPDF({
        orientation: img.width > img.height ? 'landscape' : 'portrait',
        unit: 'px',
        format: [img.width, img.height],
        compress: true
      });

      pdf.addImage(imgData, 'JPEG', 0, 0, img.width, img.height, undefined, 'FAST');
      
      const filename = `stock-analysis-${new Date().toISOString().split('T')[0]}.pdf`;
      if (shouldDownload) {
        debugLog('PDF 다운로드 시작...');
        pdf.save(filename);
      }

      debugLog('PDF 생성 완료');
      return pdf.output('datauristring');
    } catch (err: any) {
      console.error('PDF 생성 실패:', err);
      toast.error(`PDF 생성 중 오류가 발생했습니다: ${err.message || '알 수 없는 오류'}`);
      return null;
    } finally {
      // Restore scroll position
      window.scrollTo(0, originalScrollY);

      // Restore all original styles
      originalStyles.forEach((style, el) => {
        el.style.maxHeight = style.maxHeight;
        el.style.overflow = style.overflow;
        if (style.overflowY !== undefined) el.style.overflowY = style.overflowY;
        el.style.height = style.height;
      });
      setIsGeneratingPDF(false);
    }
  };

  const handleExportDeepAnalysisPDF = async () => {
    if (!analysisReportRef.current || !deepAnalysisStock) return;
    
    setIsExportingDeepAnalysis(true);
    const toastId = toast.loading(`${deepAnalysisStock.name} PDF 리포트를 생성 중입니다...`);
    
    const originalStyles = new Map<HTMLElement, any>();
    try {
      const element = analysisReportRef.current;
      
      // Temporarily expand all scrollable containers to capture full content
      const scrollableElements = element.querySelectorAll('.overflow-y-auto, .overflow-auto');
      
      // Save and modify root element
      originalStyles.set(element, {
        maxHeight: element.style.maxHeight,
        overflow: element.style.overflow,
        height: element.style.height
      });
      element.style.maxHeight = 'none';
      element.style.overflow = 'visible';
      element.style.height = 'auto';

      // Save and modify all nested scrollable elements
      scrollableElements.forEach((el) => {
        const htmlEl = el as HTMLElement;
        originalStyles.set(htmlEl, {
          maxHeight: htmlEl.style.maxHeight,
          overflow: htmlEl.style.overflow,
          overflowY: htmlEl.style.overflowY,
          height: htmlEl.style.height
        });
        htmlEl.style.maxHeight = 'none';
        htmlEl.style.overflow = 'visible';
        htmlEl.style.overflowY = 'visible';
        htmlEl.style.height = 'auto';
      });
      
      const fullHeight = element.scrollHeight;
      const fullWidth = element.scrollWidth;
      
      let captureScale = 1.2; // Reduced scale to save memory/size
      if (fullHeight * captureScale > 25000) {
        captureScale = Math.max(0.8, 25000 / fullHeight);
      }

      // Add a small delay to allow browser to re-render expanded elements
      await new Promise(resolve => setTimeout(resolve, 300));

      const imgData = await domToJpeg(element, {
        scale: captureScale,
        quality: 0.7, // Reduced quality for smaller file size
        backgroundColor: '#050505',
        width: fullWidth,
        height: fullHeight,
        filter: (node) => {
          if (node instanceof HTMLElement && node.classList.contains('no-print')) {
            return false;
          }
          return true;
        }
      });
      
      const img = new Image();
      img.src = imgData;
      await new Promise((resolve) => (img.onload = resolve));

      const pdf = new jsPDF({
        orientation: img.width > img.height ? 'landscape' : 'portrait',
        unit: 'px',
        format: [img.width, img.height],
        compress: true
      });

      pdf.addImage(imgData, 'JPEG', 0, 0, img.width, img.height, undefined, 'FAST');
      pdf.save(`${deepAnalysisStock.name}_AI_Analysis_Report.pdf`);
      
      toast.success('PDF 리포트가 성공적으로 저장되었습니다.', { id: toastId });
    } catch (error: any) {
      console.error('PDF Export Error:', error);
      toast.error(`PDF 생성 중 오류가 발생했습니다: ${error.message || '알 수 없는 오류'}`, { id: toastId });
    } finally {
      // Restore all original styles
      originalStyles.forEach((style, el) => {
        el.style.maxHeight = style.maxHeight;
        el.style.overflow = style.overflow;
        if (style.overflowY !== undefined) el.style.overflowY = style.overflowY;
        el.style.height = style.height;
      });
      setIsExportingDeepAnalysis(false);
    }
  };

  const handleGenerateSummary = async () => {
    if (isSummarizing) return;
    
    setIsSummarizing(true);
    try {
      debugLog('AI 요약 생성 중...');
      // 추천 종목과 검색 결과를 합쳐서 요약 대상으로 전달
      const allStocks = [...(recommendations || []), ...(searchResults || [])];
      const summary = await generateReportSummary(allStocks, marketContext);
      setReportSummary(summary);
    } catch (err: any) {
      const errObj = err?.error || err;
      const message = errObj?.message || err?.message || "";
      const status = errObj?.status || err?.status;
      const code = errObj?.code || err?.code;
      const isRateLimit = message.includes('429') || status === 429 || code === 429 || status === 'RESOURCE_EXHAUSTED' || message.includes('quota');
      
      if (isRateLimit) {
        console.warn('AI 요약 생성 할당량 초과');
        toast.error('API 할당량 초과: 잠시 후 다시 시도해 주세요.');
      } else {
        console.error('요약 생성 실패:', err);
        toast.error(`요약 생성 중 오류가 발생했습니다: ${message}`);
      }
    } finally {
      setIsSummarizing(false);
    }
  };

  const sendEmail = async () => {
    if (!emailAddress) {
      toast.warning('이메일 주소를 입력해주세요.');
      return;
    }

    setIsSendingEmail(true);
    try {
      let summary = reportSummary;
      if (!summary) {
        setIsSummarizing(true);
        debugLog('AI 요약 생성 중...');
        summary = await generateReportSummary(recommendations, marketContext);
        setReportSummary(summary);
        setIsSummarizing(false);
      }
      
      debugLog('PDF 생성 중...');
      const pdfBase64 = await generatePDF(false);
      if (!pdfBase64) return;

      debugLog('이메일 전송 중...');
      const response = await fetch('/api/send-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: emailAddress,
          subject: `[QuantMaster Pro] 주식 분석 리포트 - ${new Date().toLocaleDateString()}`,
          text: `안녕하세요. 'QuantMaster Pro' 분석 리포트입니다.\n\n[AI 요약 리포트]\n${summary}\n\n상세 내용은 첨부된 PDF 파일을 확인해주세요.`,
          pdfBase64,
          filename: `stock-analysis-${new Date().toISOString().split('T')[0]}.pdf`
        }),
      });

      const result = await response.json();
      if (result.success) {
        toast.success('이메일이 성공적으로 전송되었습니다.');
      } else {
        throw new Error(result.error || '전송 실패');
      }
    } catch (err: any) {
      console.error('이메일 전송 실패:', err);
      const errObj = err?.error || err;
      const message = errObj?.message || err?.message || "";
      const status = errObj?.status || err?.status;
      const code = errObj?.code || err?.code;
      const isRateLimit = message.includes('429') || status === 429 || code === 429 || status === 'RESOURCE_EXHAUSTED' || message.includes('quota');
      
      if (isRateLimit) {
        toast.error('API 할당량 초과: 잠시 후 다시 시도해 주세요.');
      } else {
        toast.error(`이메일 전송 중 오류가 발생했습니다: ${message}`);
      }
    } finally {
      setIsSendingEmail(false);
      setIsSummarizing(false);
    }
  };

  return {
    generatePDF, handleExportDeepAnalysisPDF, handleGenerateSummary, sendEmail,
    analysisReportRef,
  };
}
