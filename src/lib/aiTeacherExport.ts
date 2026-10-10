import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export interface DocData {
  title: string;
  sections: { heading: string; points: string[] }[];
  mcqs: { question: string; options: string[]; correct_index: number; explanation?: string }[];
  big_questions: { question: string; answer: string }[];
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const LETTERS = "ABCDEFGH";

const CSS = `
  @page { size: A4; margin: 18mm; }
  body { font-family: "Segoe UI", "Noto Sans", "Noto Sans Kannada", "Noto Sans Devanagari", Arial, sans-serif; color: #1f2937; line-height: 1.55; font-size: 12pt; }
  h1 { font-size: 22pt; color: #065f46; border-bottom: 3px solid #10b981; padding-bottom: 6px; margin: 0 0 4px; }
  h2 { font-size: 15pt; color: #065f46; margin: 18px 0 6px; }
  h3 { font-size: 12.5pt; margin: 12px 0 4px; }
  .sub { color: #6b7280; font-size: 10pt; margin-bottom: 14px; }
  ul, ol { margin: 4px 0 8px 22px; padding: 0; } li { margin: 3px 0; }
  .q { margin: 10px 0 2px; font-weight: 600; } .opt { margin: 2px 0 2px 18px; }
  .ans { margin: 6px 0; padding: 8px 10px; background: #ecfdf5; border-left: 4px solid #10b981; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0; } th, td { border: 1px solid #d1d5db; padding: 5px 8px; text-align: left; } th { background: #f3f4f6; }
  blockquote { border-left: 3px solid #d1d5db; margin: 8px 0; padding-left: 10px; color: #4b5563; }
  .foot { margin-top: 24px; color: #9ca3af; font-size: 9pt; border-top: 1px solid #e5e7eb; padding-top: 6px; }
`;

function wrapHtml(title: string, body: string): string {
  return `<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body>${body}<div class="foot">Made by your AI Teacher · SimpleLecture</div></body></html>`;
}

/** Notes the voice teacher composed (sections + MCQs + big questions + answer key). */
export function docToHtml(d: DocData): string {
  const sections = d.sections
    .map((s) => `<h2>${esc(s.heading)}</h2><ul>${s.points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>`)
    .join("");
  const mcqs = d.mcqs.length
    ? `<h2>📝 Practice questions (MCQ)</h2>` +
      d.mcqs.map((q, i) => `<div class="q">${i + 1}. ${esc(q.question)}</div>${q.options.map((o, j) => `<div class="opt">${LETTERS[j]}) ${esc(o)}</div>`).join("")}`).join("")
    : "";
  const big = d.big_questions.length
    ? `<h2>✍️ Big questions</h2>` + d.big_questions.map((q, i) => `<div class="q">${i + 1}. ${esc(q.question)}</div>`).join("")
    : "";
  const key =
    d.mcqs.length || d.big_questions.length
      ? `<h2>✅ Answer key</h2>` +
        d.mcqs.map((q, i) => `<div class="ans">MCQ ${i + 1}: <b>${LETTERS[q.correct_index] ?? "?"}) ${esc(q.options[q.correct_index] ?? "")}</b>${q.explanation ? ` — ${esc(q.explanation)}` : ""}</div>`).join("") +
        d.big_questions.map((q, i) => `<div class="ans">Big question ${i + 1}: ${esc(q.answer)}</div>`).join("")
      : "";
  return wrapHtml(d.title, `<h1>${esc(d.title)}</h1><div class="sub">Study notes · ${new Date().toLocaleDateString()}</div>${sections}${mcqs}${big}${key}`);
}

/** A chat answer (Markdown) saved as a document. */
export function markdownToHtml(title: string, markdown: string): string {
  const body = renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm], children: markdown }));
  return wrapHtml(title, `<h1>${esc(title)}</h1><div class="sub">Study notes · ${new Date().toLocaleDateString()}</div>${body}`);
}

const fileSafe = (s: string) => s.replace(/[^\p{L}\p{N} _.-]+/gu, "").trim().replace(/\s+/g, "_").slice(0, 60) || "notes";

/** Word opens HTML saved as .doc with its formatting intact (and so do Google Docs and LibreOffice). */
export function downloadWord(html: string, title: string) {
  const blob = new Blob(["﻿", html], { type: "application/msword" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${fileSafe(title)}.doc`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * PDF through the browser's own "Save as PDF" so emojis and Hindi/Kannada text render correctly.
 * A hidden frame avoids pop-up blockers; if printing from a frame is not possible, a new tab is used.
 */
export function printPdf(html: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win || typeof win.print !== "function") {
    frame.remove();
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    window.open(url, "_blank");
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
  setTimeout(() => {
    try { win.focus(); win.print(); } catch { /* user can use the browser menu */ }
    setTimeout(() => frame.remove(), 60_000);
  }, 400);
}
