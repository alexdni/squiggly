// Client-side exports for the analysis page. Each result card is marked with
// data-report-section="<title>" (plus data-visual when it is a figure); cards are rasterized from
// the live DOM with html-to-image, so the exports show exactly what the page renders, legacy PNGs
// and WebGL canvases included. Controls marked data-export-ignore are left out of the captures.
// The libraries are loaded on demand to keep them out of the page bundle.

export interface ReportSection {
  title: string;
  el: HTMLElement;
  visual: boolean;
}

export interface ReportMeta {
  /** Defaults to "EEG Analysis Report". */
  title?: string;
  filename: string;
  /** Download name without extension; defaults to the recording's base name plus "-report". */
  downloadName?: string;
  completedAt: string | null;
  details: [string, string][];
}

export type ProgressFn = (done: number, total: number) => void;

export function collectSections(root: ParentNode, { visualOnly = false } = {}): ReportSection[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-report-section]'))
    .map((el) => ({ title: el.dataset.reportSection || 'Section', el, visual: el.dataset.visual !== undefined }))
    .filter((s) => !visualOnly || s.visual);
}

export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'section'
  );
}

/** Recording filename without its extension, safe to use in a download name. */
export function baseName(filename: string): string {
  return slugify(filename.replace(/\.[^.]+$/, '')) || 'analysis';
}

const keepNode = (node: Node) => !(node instanceof HTMLElement && node.dataset.exportIgnore !== undefined);

async function makeCapturer(sections: ReportSection[]) {
  const { getFontEmbedCSS, toCanvas } = await import('html-to-image');
  // Font CSS is the same for every card; embedding it once saves refetching per capture
  const fontEmbedCSS = sections.length ? await getFontEmbedCSS(sections[0].el).catch(() => '') : '';
  return (el: HTMLElement) =>
    toCanvas(el, { pixelRatio: 2, backgroundColor: '#ffffff', filter: keepNode, fontEmbedCSS });
}

/** Marks the page as exporting (expands scroll boxes, see globals.css) while `run` captures it. */
async function whileExporting<T>(root: ParentNode, run: () => Promise<T>): Promise<T> {
  const el = root instanceof HTMLElement ? root : null;
  el?.setAttribute('data-exporting', '');
  try {
    return await run();
  } finally {
    el?.removeAttribute('data-exporting');
  }
}

function triggerDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const canvasBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), 'image/png')
  );

/** One PNG per figure card, zipped. */
export function exportVisualizationsZip(root: ParentNode, meta: ReportMeta, onProgress?: ProgressFn) {
  return whileExporting(root, () => buildVisualizationsZip(root, meta, onProgress));
}

async function buildVisualizationsZip(root: ParentNode, meta: ReportMeta, onProgress?: ProgressFn) {
  const sections = collectSections(root, { visualOnly: true });
  if (!sections.length) throw new Error('No visualizations to export');
  const [{ default: JSZip }, capture] = await Promise.all([import('jszip'), makeCapturer(sections)]);
  const zip = new JSZip();
  const used = new Set<string>();
  for (let i = 0; i < sections.length; i++) {
    onProgress?.(i, sections.length);
    let name = `${String(i + 1).padStart(2, '0')}-${slugify(sections[i].title)}`;
    while (used.has(name)) name += '-x';
    used.add(name);
    zip.file(`${name}.png`, await canvasBlob(await capture(sections[i].el)));
  }
  onProgress?.(sections.length, sections.length);
  triggerDownload(await zip.generateAsync({ type: 'blob' }), `${baseName(meta.filename)}-visualizations.zip`);
}

// A4 portrait, millimetres
const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 14;
const CONTENT_W = PAGE_W - 2 * MARGIN;
const FOOTER_H = 8;
const BODY_BOTTOM = PAGE_H - MARGIN - FOOTER_H;
const SECTION_GAP = 5;

/** Recording details, then every result card in page order, split across pages where needed. */
export function exportPdfReport(root: ParentNode, meta: ReportMeta, onProgress?: ProgressFn) {
  return whileExporting(root, () => buildPdfReport(root, meta, onProgress));
}

async function buildPdfReport(root: ParentNode, meta: ReportMeta, onProgress?: ProgressFn) {
  const sections = collectSections(root);
  if (!sections.length) throw new Error('No results to export');
  const [{ jsPDF }, capture] = await Promise.all([import('jspdf'), makeCapturer(sections)]);
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

  // Cover block
  let y = MARGIN + 4;
  pdf.setFont('helvetica', 'bold').setFontSize(20).setTextColor(17, 24, 39);
  pdf.text(meta.title ?? 'EEG Analysis Report', MARGIN, y);
  y += 8;
  pdf.setFont('helvetica', 'normal').setFontSize(11).setTextColor(55, 65, 81);
  const filenameLines: string[] = pdf.splitTextToSize(meta.filename, CONTENT_W);
  pdf.text(filenameLines, MARGIN, y);
  y += 5 * filenameLines.length + 1;
  pdf.setFontSize(9).setTextColor(107, 114, 128);
  const dates = [
    meta.completedAt ? `Analysis completed ${new Date(meta.completedAt).toLocaleString()}` : null,
    `Report generated ${new Date().toLocaleString()}`,
  ].filter(Boolean);
  pdf.text(dates.join('  ·  '), MARGIN, y);
  y += 8;

  const colW = CONTENT_W / 4;
  meta.details.forEach(([label, value], i) => {
    const col = i % 4;
    const rowY = y + Math.floor(i / 4) * 11;
    pdf.setFontSize(8).setTextColor(107, 114, 128).text(label, MARGIN + col * colW, rowY);
    pdf.setFontSize(10).setTextColor(17, 24, 39).text(value, MARGIN + col * colW, rowY + 4.5);
  });
  y += Math.ceil(meta.details.length / 4) * 11 + 2;
  pdf.setDrawColor(229, 231, 235).line(MARGIN, y, PAGE_W - MARGIN, y);
  y += SECTION_GAP;

  for (let i = 0; i < sections.length; i++) {
    onProgress?.(i, sections.length);
    const canvas = await capture(sections[i].el);
    const mmPerPx = CONTENT_W / canvas.width;
    const fullH = canvas.height * mmPerPx;

    // Start a fresh page unless the card fits, or is taller than a page anyway
    const pageBodyH = BODY_BOTTOM - MARGIN;
    if (y + fullH > BODY_BOTTOM && (fullH <= pageBodyH || BODY_BOTTOM - y < pageBodyH * 0.3)) {
      pdf.addPage();
      y = MARGIN;
    }

    let srcY = 0;
    while (srcY < canvas.height) {
      if (BODY_BOTTOM - y < 20) {
        pdf.addPage();
        y = MARGIN;
      }
      const sliceH = Math.min(canvas.height - srcY, Math.floor((BODY_BOTTOM - y) / mmPerPx));
      const slice = document.createElement('canvas');
      slice.width = canvas.width;
      slice.height = sliceH;
      slice.getContext('2d')!.drawImage(canvas, 0, srcY, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
      pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', MARGIN, y, CONTENT_W, sliceH * mmPerPx);
      srcY += sliceH;
      y += sliceH * mmPerPx;
    }
    y += SECTION_GAP;
  }
  onProgress?.(sections.length, sections.length);

  const pages = pdf.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    pdf.setPage(p);
    pdf.setFont('helvetica', 'normal').setFontSize(8).setTextColor(156, 163, 175);
    pdf.text('Squiggly · For research and educational use; not a medical diagnosis', MARGIN, PAGE_H - MARGIN + 2);
    pdf.text(`${p} / ${pages}`, PAGE_W - MARGIN, PAGE_H - MARGIN + 2, { align: 'right' });
  }

  pdf.save(`${meta.downloadName ?? `${baseName(meta.filename)}-report`}.pdf`);
}
