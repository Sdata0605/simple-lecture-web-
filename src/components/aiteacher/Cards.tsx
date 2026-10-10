import { useState } from "react";
import { Download, FileText, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { docToHtml, downloadWord, printPdf, type DocData } from "@/lib/aiTeacherExport";
import { Markdown } from "./Markdown";

export interface VisualItem { emoji: string; title: string; text?: string; group?: string }
export interface VisualData { kind: "scene" | "timeline" | "steps" | "compare" | "keyterms"; title: string; items: VisualItem[]; caption?: string }

const Frame = ({ title, children, caption, tone = "emerald" }: { title: string; children: React.ReactNode; caption?: string; tone?: "emerald" | "sky" | "amber" }) => (
  <section
    className={cn(
      "min-w-0 rounded-2xl border p-3.5 shadow-sm",
      tone === "emerald" && "bg-gradient-to-br from-emerald-50 to-white",
      tone === "sky" && "bg-gradient-to-br from-sky-50 to-white",
      tone === "amber" && "bg-gradient-to-br from-amber-50 to-white",
    )}
  >
    <h3 className="mb-2.5 text-sm font-semibold text-emerald-900">{title}</h3>
    {children}
    {caption && <p className="mt-3 rounded-lg bg-white/70 px-3 py-2 text-xs italic text-muted-foreground">💡 {caption}</p>}
  </section>
);

/** Emoji scene, timeline, steps, comparison or key terms: the teacher's way of "showing" an idea. */
export function VisualCard({ visual }: { visual: VisualData }) {
  const { kind, title, items, caption } = visual;

  if (kind === "scene") {
    return (
      <Frame title={title} caption={caption} tone="sky">
        <div className="flex flex-wrap items-start justify-center gap-x-1 gap-y-3">
          {items.map((it, i) => (
            <div key={i} className="flex items-start">
              <div className="flex w-[84px] flex-col items-center text-center sm:w-24">
                <span className="text-4xl leading-none sm:text-5xl" role="img" aria-label={it.title}>{it.emoji}</span>
                <span className="mt-1.5 text-xs font-semibold">{it.title}</span>
                {it.text && <span className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{it.text}</span>}
              </div>
              {i < items.length - 1 && <span aria-hidden className="mt-3 px-0.5 text-lg text-sky-400">➜</span>}
            </div>
          ))}
        </div>
      </Frame>
    );
  }

  if (kind === "timeline") {
    return (
      <Frame title={title} caption={caption} tone="amber">
        <ol className="relative ml-3 space-y-3 border-l-2 border-amber-300 pl-5">
          {items.map((it, i) => (
            <li key={i} className="relative">
              <span className="absolute -left-[34px] flex h-7 w-7 items-center justify-center rounded-full border-2 border-amber-300 bg-white text-base" aria-hidden>{it.emoji}</span>
              <p className="text-sm font-semibold text-amber-900">{it.title}</p>
              {it.text && <p className="text-sm text-muted-foreground">{it.text}</p>}
            </li>
          ))}
        </ol>
      </Frame>
    );
  }

  if (kind === "steps") {
    return (
      <Frame title={title} caption={caption}>
        <ol className="space-y-1.5">
          {items.map((it, i) => (
            <li key={i}>
              <div className="flex items-start gap-3 rounded-xl border bg-white p-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white">{i + 1}</span>
                <span className="text-2xl leading-none" aria-hidden>{it.emoji}</span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{it.title}</p>
                  {it.text && <p className="text-xs text-muted-foreground">{it.text}</p>}
                </div>
              </div>
              {i < items.length - 1 && <p aria-hidden className="py-0.5 text-center text-xs text-emerald-500">▼</p>}
            </li>
          ))}
        </ol>
      </Frame>
    );
  }

  if (kind === "compare") {
    const groups: string[] = [];
    items.forEach((it) => { const g = it.group || ""; if (!groups.includes(g)) groups.push(g); });
    const cols = groups.slice(0, 2);
    return (
      <Frame title={title} caption={caption}>
        <div className={cn("grid gap-2", cols.length > 1 && "sm:grid-cols-2")}>
          {cols.map((g) => (
            <div key={g} className="rounded-xl border bg-white p-2.5">
              {g && <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-emerald-700">{g}</p>}
              <ul className="space-y-1.5">
                {items.filter((it) => (it.group || "") === g).map((it, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-xl leading-none" aria-hidden>{it.emoji}</span>
                    <span className="min-w-0 text-sm"><b>{it.title}</b>{it.text ? <span className="text-muted-foreground"> — {it.text}</span> : null}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Frame>
    );
  }

  // keyterms
  return (
    <Frame title={title} caption={caption}>
      <div className="grid gap-2 sm:grid-cols-2">
        {items.map((it, i) => (
          <div key={i} className="flex items-start gap-2.5 rounded-xl border bg-white p-2.5">
            <span className="text-2xl leading-none" aria-hidden>{it.emoji}</span>
            <div className="min-w-0">
              <p className="text-sm font-semibold">{it.title}</p>
              {it.text && <p className="text-xs text-muted-foreground">{it.text}</p>}
            </div>
          </div>
        ))}
      </div>
    </Frame>
  );
}

/** "Do you understand?" with three quick taps. */
export function UnderstandCard({ topic, onChoose }: { topic?: string; onChoose: (choice: "got_it" | "somewhat" | "confused") => void }) {
  const [picked, setPicked] = useState<string | null>(null);
  const options = [
    { id: "got_it" as const, emoji: "👍", label: "Got it!" },
    { id: "somewhat" as const, emoji: "🤔", label: "Somewhat" },
    { id: "confused" as const, emoji: "😕", label: "Confused" },
  ];
  return (
    <section className="rounded-2xl border bg-gradient-to-br from-violet-50 to-white p-3.5 shadow-sm">
      <p className="mb-2.5 text-sm font-semibold text-violet-900">Are you understanding{topic ? ` “${topic}”` : ""}?</p>
      <div className="grid grid-cols-3 gap-2">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            disabled={!!picked}
            onClick={() => { setPicked(o.id); onChoose(o.id); }}
            className={cn(
              "flex flex-col items-center gap-1 rounded-xl border bg-white px-2 py-2.5 text-xs font-medium transition-colors",
              !picked && "hover:border-violet-400 hover:bg-violet-50",
              picked === o.id && "border-violet-500 bg-violet-100",
              picked && picked !== o.id && "opacity-50",
            )}
          >
            <span className="text-2xl" aria-hidden>{o.emoji}</span>{o.label}
          </button>
        ))}
      </div>
    </section>
  );
}

/** A longer question: answer by speaking, or type here. */
export function BigQuestionCard({ question, hint, onSubmit }: { question: string; hint?: string; onSubmit: (answer: string) => void }) {
  const [text, setText] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  return (
    <section className="rounded-2xl border bg-gradient-to-br from-rose-50 to-white p-3.5 shadow-sm">
      <p className="mb-1 text-xs font-bold uppercase tracking-wide text-rose-700">✍️ Big question</p>
      <Markdown className="font-medium">{question}</Markdown>
      {hint && <p className="mt-1 text-xs text-muted-foreground">Hint: {hint}</p>}
      {sent ? (
        <p className="mt-2.5 rounded-lg bg-white/80 p-2.5 text-sm"><span className="text-xs text-muted-foreground">Your answer:</span><br />{sent}</p>
      ) : (
        <div className="mt-2.5 space-y-2">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={1200} placeholder="Say your answer out loud, or type it here…" className="resize-none bg-white text-base md:text-sm" aria-label="Your answer" />
          <Button type="button" size="sm" disabled={text.trim().length < 3} onClick={() => { const t = text.trim(); setSent(t); onSubmit(t); }} className="gap-1.5"><Send className="h-3.5 w-3.5" />Send my answer</Button>
        </div>
      )}
    </section>
  );
}

/** Study notes the teacher made, ready to download. */
export function DocumentCard({ format, doc }: { format: "pdf" | "word" | "both"; doc: DocData }) {
  const html = docToHtml(doc);
  return (
    <section className="rounded-2xl border bg-gradient-to-br from-teal-50 to-white p-3.5 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-100 text-teal-700"><FileText className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{doc.title}</p>
          <p className="text-xs text-muted-foreground">{doc.sections.length} sections · {doc.mcqs.length} MCQs · {doc.big_questions.length} big questions</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {(format === "pdf" || format === "both") && (
          <Button type="button" size="sm" variant="outline" className="gap-1.5 bg-white" onClick={() => printPdf(html)}><Download className="h-3.5 w-3.5" />📄 PDF</Button>
        )}
        {(format === "word" || format === "both") && (
          <Button type="button" size="sm" variant="outline" className="gap-1.5 bg-white" onClick={() => downloadWord(html, doc.title)}><Download className="h-3.5 w-3.5" />📝 Word</Button>
        )}
      </div>
      {(format === "pdf" || format === "both") && <p className="mt-2 text-[11px] text-muted-foreground">PDF opens your browser’s print window: choose “Save as PDF”.</p>}
    </section>
  );
}
