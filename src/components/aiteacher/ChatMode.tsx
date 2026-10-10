import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, FileText, GraduationCap, ListChecks, Loader2, Send, Sparkles, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { teacherApi, type ChatResult, type OutlineChapter } from "@/lib/aiTeacherApi";
import { Markdown } from "./Markdown";
import { ReferenceList } from "./PresentationPanel";
import { QuizCard, bankToQuiz, type QuizItem } from "./QuizCard";

interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  error?: boolean;
  result?: ChatResult;
}

export interface ChatRequest { nonce: number; text: string; topicId?: string }

export function ChatMode({
  subjectId,
  subjectName,
  outline,
  request,
}: {
  subjectId: string;
  subjectName: string;
  outline: OutlineChapter[] | undefined;
  request: ChatRequest | null;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(1);
  const handledRef = useRef(0);
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, busy]);

  const ask = useCallback(async (question: string, topicId?: string) => {
    const q = question.trim();
    if (!q || busy) return;
    const history = messagesRef.current.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content }));
    setMessages((p) => [...p, { id: idRef.current++, role: "user", content: q }]);
    setBusy(true);
    try {
      const r = await teacherApi<ChatResult>("chat", { subjectId, question: q, messages: history, topicId });
      setMessages((p) => [...p, { id: idRef.current++, role: "assistant", content: r.answer, result: r }]);
    } catch (e) {
      setMessages((p) => [...p, { id: idRef.current++, role: "assistant", content: e instanceof Error ? e.message : "Something went wrong.", error: true }]);
    } finally {
      setBusy(false);
    }
  }, [busy, subjectId]);

  // "Teach me this lesson" clicks from the syllabus
  useEffect(() => {
    if (request && request.nonce !== handledRef.current) {
      handledRef.current = request.nonce;
      void ask(request.text, request.topicId);
    }
  }, [request, ask]);

  const submit = () => {
    const q = text;
    if (!q.trim() || busy) return;
    setText("");
    void ask(q);
  };

  const starters = [
    outline?.[0]?.topics?.[0] ? { label: `Teach me: ${outline[0].topics[0].title}`, text: `Teach me the lesson: ${outline[0].topics[0].title}`, topicId: outline[0].topics[0].id } : null,
    { label: "Explain the most important points of a chapter", text: `Which are the most important chapters in ${subjectName} and what are they about?` },
    { label: "Give me a quick quiz", text: `Ask me one question from ${subjectName} to test myself.` },
  ].filter(Boolean) as { label: string; text: string; topicId?: string }[];

  return (
    <section className="flex min-h-[480px] flex-1 flex-col rounded-2xl border bg-card shadow-sm">
      <div className="min-h-0 flex-1 space-y-5 overflow-auto p-4">
        {messages.length === 0 && (
          <div className="mx-auto flex max-w-xl flex-col items-center gap-4 py-10 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Sparkles className="h-7 w-7" /></div>
            <div>
              <h2 className="text-lg font-semibold">Ask anything from {subjectName}</h2>
              <p className="text-sm text-muted-foreground">Type a question or ask me to teach a lesson. Answers come from your study notes, with the sources shown.</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {starters.map((s) => (
                <Button key={s.label} variant="outline" size="sm" className="h-auto whitespace-normal py-2 text-left" onClick={() => void ask(s.text, s.topicId)}>{s.label}</Button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={cn("flex gap-3", m.role === "user" && "flex-row-reverse")}>
            <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", m.role === "user" ? "bg-primary text-primary-foreground" : "bg-emerald-100 text-emerald-700")}>
              {m.role === "user" ? <User className="h-4 w-4" /> : <GraduationCap className="h-4 w-4" />}
            </div>
            <div className={cn("min-w-0 max-w-[88%] space-y-2", m.role === "user" && "text-right")}>
              {m.role === "user" ? (
                <p className="inline-block rounded-2xl bg-primary px-3 py-2 text-left text-sm text-primary-foreground">{m.content}</p>
              ) : (
                <div className={cn("rounded-2xl border bg-background px-4 py-3", m.error && "border-destructive/40 text-destructive")}>
                  <Markdown>{m.content}</Markdown>
                </div>
              )}
              {m.result && <AnswerExtras result={m.result} />}
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex items-center gap-3 text-sm text-muted-foreground" aria-live="polite">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><GraduationCap className="h-4 w-4" /></div>
            <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Looking through your notes…</span>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="flex items-end gap-2 border-t p-3">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          placeholder={`Ask a question or say "teach me …" (Enter to send)`}
          aria-label="Ask a question"
          rows={1}
          maxLength={1500}
          className="max-h-40 min-h-[44px] resize-none"
        />
        <Button type="submit" size="icon" className="h-11 w-11 shrink-0" disabled={!text.trim() || busy} aria-label="Send"><Send className="h-4 w-4" /></Button>
      </form>
    </section>
  );
}

function AnswerExtras({ result }: { result: ChatResult }) {
  const quizzes = result.questions.map(bankToQuiz).filter((q): q is QuizItem => !!q);
  const Section = ({ icon: Icon, label, children }: { icon: typeof BookOpen; label: string; children: React.ReactNode }) => (
    <details className="group rounded-xl border bg-muted/30 text-left">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground">
        <Icon className="h-3.5 w-3.5" />{label}
      </summary>
      <div className="p-3 pt-1">{children}</div>
    </details>
  );
  return (
    <div className="space-y-2">
      {result.references.length > 0 && (
        <Section icon={BookOpen} label={`Sources from your notes (${result.references.length})`}>
          <ReferenceList references={result.references} />
        </Section>
      )}
      {result.documents.length > 0 && (
        <Section icon={FileText} label={`PDF files (${result.documents.length})`}>
          <ul className="space-y-1.5 text-sm">
            {result.documents.map((d, i) => <li key={i}><a className="text-primary underline" href={d.url} target="_blank" rel="noreferrer">{d.title}</a></li>)}
          </ul>
        </Section>
      )}
      {quizzes.length > 0 && (
        <Section icon={ListChecks} label={`Practice questions (${quizzes.length})`}>
          <div className="space-y-3">{quizzes.map((q) => <QuizCard key={q.id} quiz={q} />)}</div>
        </Section>
      )}
    </div>
  );
}
