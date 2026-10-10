import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, FileText, GraduationCap, ListChecks, Loader2, Send, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { teacherApi, type ChatResult, type TeacherSubject } from "@/lib/aiTeacherApi";
import { detectSubject, isOnlySubject } from "@/lib/aiTeacherSubjects";
import { Markdown } from "./Markdown";
import { ReferenceList } from "./PresentationPanel";
import { QuizCard, bankToQuiz, type QuizItem } from "./QuizCard";

interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  error?: boolean;
  /** Written by the page itself (greeting, "which subject?"), never sent to the AI as history. */
  local?: boolean;
  /** "subjects" shows one tappable chip per subject; a list shows fixed quick replies. */
  chips?: "subjects" | { label: string; text: string }[];
  result?: ChatResult;
}

export interface ChatRequest { nonce: number; text: string; topicId?: string }

const WELCOME = "Hi! How can I help you today? Which subject would you like to study?";

export function ChatMode({
  subjects,
  subject,
  onSubject,
  request,
}: {
  subjects: TeacherSubject[];
  subject: TeacherSubject | null;
  onSubject: (s: TeacherSubject) => void;
  request: ChatRequest | null;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([{ id: 0, role: "assistant", content: WELCOME, local: true, chips: "subjects" }]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(1);
  const handledRef = useRef(0);
  const messagesRef = useRef<ChatMessage[]>(messages);
  messagesRef.current = messages;
  const subjRef = useRef<TeacherSubject | null>(subject);
  subjRef.current = subject;
  const pendingRef = useRef<{ q: string; topicId?: string } | null>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, busy]);

  const push = useCallback((m: Omit<ChatMessage, "id">) => {
    setMessages((p) => [...p, { ...m, id: idRef.current++ }]);
  }, []);

  /** Calls the teacher for a question whose user bubble is already on screen. */
  const run = useCallback(async (q: string, subj: TeacherSubject, topicId?: string) => {
    const history = messagesRef.current.filter((m) => !m.error && !m.local).map((m) => ({ role: m.role, content: m.content }));
    setBusy(true);
    try {
      const r = await teacherApi<ChatResult>("chat", { subjectId: subj.id, question: q, messages: history, topicId });
      push({ role: "assistant", content: r.answer, result: r });
    } catch (e) {
      push({ role: "assistant", content: e instanceof Error ? e.message : "Something went wrong.", error: true });
    } finally {
      setBusy(false);
    }
  }, [push]);

  const ask = useCallback(async (question: string, topicId?: string) => {
    const q = question.trim();
    if (!q || busy) return;
    push({ role: "user", content: q });

    // A lesson picked from the list already has its subject; otherwise listen for one in the message.
    const named = topicId ? null : detectSubject(q, subjects);
    let subj = subjRef.current;
    if (named && named.id !== subj?.id) {
      subj = named;
      subjRef.current = named;
      onSubject(named);
    }

    if (!subj) {
      pendingRef.current = { q, topicId };
      push({ role: "assistant", content: "Sure! Which subject is this for?", local: true, chips: "subjects" });
      return;
    }

    if (named && isOnlySubject(q, named)) {
      const pending = pendingRef.current;
      pendingRef.current = null;
      push({
        role: "assistant",
        local: true,
        content: pending
          ? `Got it, ${named.name}! Let me answer your question.`
          : `Great, ${named.name}! What would you like to learn? Ask me any question, or say "teach me chapter 3 topic 1".`,
        chips: pending ? undefined : [
          { label: "What are the main chapters?", text: `What are the main chapters in ${named.name} and what are they about?` },
          { label: "Ask me a quick question", text: `Ask me one question from ${named.name} to test myself.` },
        ],
      });
      if (pending) await run(pending.q, named, pending.topicId);
      return;
    }

    pendingRef.current = null;
    await run(q, subj, topicId);
  }, [busy, onSubject, push, run, subjects]);

  // "Teach me this lesson" taps from the lessons list
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

  const lastId = messages[messages.length - 1]?.id;

  return (
    <section className="flex min-h-[480px] flex-1 flex-col rounded-2xl border bg-card shadow-sm">
      <div className="min-h-0 flex-1 space-y-5 overflow-auto p-4">
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
              {m.chips && m.id === lastId && !busy && (
                <div className="flex flex-wrap gap-2">
                  {(m.chips === "subjects" ? subjects.map((s) => ({ label: s.name, text: s.name })) : m.chips).map((c) => (
                    <Button key={c.label} variant="outline" size="sm" className="h-auto whitespace-normal rounded-full py-1.5" onClick={() => void ask(c.text)}>{c.label}</Button>
                  ))}
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
          placeholder={subject ? `Ask a ${subject.name} question or say "teach me …" (Enter to send)` : "Tell me the subject, or ask your question (Enter to send)"}
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
