/**
 * Client-side text extraction for "Import from previous report".
 *
 * Why: the parse-inspection-docx edge function only ever uses plain text
 * (truncated to 60_000 chars) but historically received the entire file as
 * multipart/form-data. That capped imports at 20 MB and OOM'd the function on
 * photo-heavy PDFs. By extracting text in the browser we can import documents
 * of effectively any size — only the text crosses the wire.
 *
 * pdfjs-dist and mammoth are dynamically imported so they don't bloat the
 * dashboard bundle for users who never use the importer.
 */

export type SupportedExt = "docx" | "doc" | "pdf" | "md" | "markdown";

export function getExt(fileName: string): string {
  return fileName.toLowerCase().split(".").pop() || "";
}

export function isClientExtractable(ext: string): boolean {
  return ext === "docx" || ext === "pdf" || ext === "md" || ext === "markdown";
}

function stripMarkdown(text: string): string {
  let t = text;
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  t = t.replace(/^#{1,6}\s+/gm, "");
  t = t.replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1");
  t = t.replace(/_{1,3}([^_]+)_{1,3}/g, "$1");
  t = t.replace(/~~([^~]+)~~/g, "$1");
  t = t.replace(/`([^`]+)`/g, "$1");
  t = t.replace(/```[\s\S]*?```/g, "");
  t = t.replace(/^>\s*/gm, "");
  t = t.replace(/^[-*_]{3,}\s*$/gm, "");
  t = t.replace(/<[^>]+>/g, "");
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

async function extractDocxText(file: File): Promise<string> {
  const mammoth: any = await import("mammoth/mammoth.browser");
  const arrayBuffer = await file.arrayBuffer();
  const result = await (mammoth.default ?? mammoth).extractRawText({ arrayBuffer });
  return result.value || "";
}

async function extractPdfText(file: File): Promise<string> {
  const pdfjs: any = await import("pdfjs-dist");
  // Worker setup — use bundled worker URL; Vite resolves via ?url import.
  try {
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      // @ts-ignore — Vite-specific URL import resolved at build time.
      const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    }
  } catch {
    // Fallback: disable worker (slower but functional).
    pdfjs.GlobalWorkerOptions.workerSrc = "";
  }

  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({
    data: arrayBuffer,
    disableFontFace: true,
    isEvalSupported: false,
  });
  const pdf = await loadingTask.promise;
  const pageTexts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const strings = content.items.map((it: any) => ("str" in it ? it.str : "")).filter(Boolean);
    pageTexts.push(strings.join(" "));
    // Free page resources promptly to keep memory bounded on iPad.
    page.cleanup();
  }
  await pdf.destroy?.();
  return pageTexts.join("\n\n");
}

async function extractMarkdownText(file: File): Promise<string> {
  const raw = await file.text();
  return stripMarkdown(raw);
}

/**
 * Extract plain text from a document client-side.
 * Throws on unsupported types or unreadable content.
 */
export async function extractTextFromFile(file: File): Promise<string> {
  const ext = getExt(file.name);
  let text = "";
  if (ext === "docx") {
    text = await extractDocxText(file);
  } else if (ext === "pdf") {
    text = await extractPdfText(file);
  } else if (ext === "md" || ext === "markdown") {
    text = await extractMarkdownText(file);
  } else {
    throw new Error(`Client-side extraction not supported for .${ext} — falling back to server.`);
  }
  if (!text || text.trim().length < 50) {
    throw new Error("Could not extract enough text from the document. The file may be image-based or empty.");
  }
  return text;
}
