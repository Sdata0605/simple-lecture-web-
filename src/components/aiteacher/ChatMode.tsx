import { useCallback, useEffect, useRef, useState } from "react";
import { FileDown, FileText, GraduationCap, Loader2, Send, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { type BigQuestionData, type TeacherSubject } from "@/lib/aiTeacherApi";
import { teacherChat, isExternalTopicQuery, extractExternalTopicName } from "@/lib/aiTeacherChat";
import { usePrefs } from "@/lib/aiTeacherPrefs";
import { detectSubject, isOnlySubject } from "@/lib/aiTeacherSubjects";
import { downloadWord, markdownToHtml, printPdf } from "@/lib/aiTeacherExport";
import { Markdown } from "./Markdown";
import { QuizCard, type QuizItem } from "./QuizCard";

interface ChipDef { label: string; text?: string; mode?: "quiz" | "bigq" | "skip" }

interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  error?: boolean;
  /** Written by the page itself (greeting, "which subject?"), never sent to the AI as history. */
  local?: boolean;
  chips?: ChipDef[];
  quiz?: QuizItem;
  /** Teaching answers can be saved as a PDF or Word document. */
  exportable?: boolean;
}

const WELCOME = "Namaste! How can I help you today? Which subject would you like to study?";

const AFTER_ANSWER: ChipDef[] = [
  { label: "👍 Got it", text: "👍 Got it! Please continue with the next part." },
  { label: "😕 Explain again", text: "😕 I didn't understand. Please explain again more simply, with a new real-life example." },
  { label: "📝 Quiz me", mode: "quiz" },
  { label: "✍️ Big question", mode: "bigq" },
];

const AFTER_PRACTICE: ChipDef[] = [
  { label: "📝 Another question", mode: "quiz" },
  { label: "✍️ Big question", mode: "bigq" },
  { label: "➡️ Continue the lesson", text: "Please continue with the next part of the lesson." },
];

export function ChatMode({
  subjects,
  subject,
  onSubject,
  enrolledSubjects,
}: {
  subjects: TeacherSubject[];
  subject: TeacherSubject | null;
  onSubject: (s: TeacherSubject) => void;
  enrolledSubjects?: string;
}) {
  const [prefs] = usePrefs();
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const enrolledSubjectsRef = useRef(enrolledSubjects);
  enrolledSubjectsRef.current = enrolledSubjects;

  const [messages, setMessages] = useState<ChatMessage[]>([{ id: 0, role: "assistant", content: WELCOME, local: true }]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [awaitingAnswer, setAwaitingAnswer] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(1);
  const messagesRef = useRef<ChatMessage[]>(messages);
  messagesRef.current = messages;
  const subjRef = useRef<TeacherSubject | null>(subject);
  subjRef.current = subject;
  const pendingRef = useRef<{ q: string } | null>(null);          // a question asked before the subject was chosen
  const bigQRef = useRef<BigQuestionData | null>(null);            // a big question waiting for the student's answer
  const lastTopicRef = useRef<string | undefined>(undefined);      // topic of the last answer (for quizzes)
  const lastQuestionRef = useRef<string>("");
  const askedRef = useRef<string[]>([]);                           // quiz questions already asked

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, busy]);

  const push = useCallback((m: Omit<ChatMessage, "id">) => {
    setMessages((p) => [...p, { ...m, id: idRef.current++ }]);
  }, []);

  const fail = useCallback((e: unknown) => {
    push({ role: "assistant", content: e instanceof Error ? e.message : "Something went wrong.", error: true });
  }, [push]);

  /** Calls the teacher for a question whose user bubble is already on screen. */
  const run = useCallback(async (q: string, subj: TeacherSubject) => {
    const history = messagesRef.current.filter((m) => !m.error && !m.local && !m.quiz).map((m) => ({ role: m.role, content: m.content }));
    setBusy(true);
    try {
      const r = await teacherChat(
        { subjectId: subj.id, question: q, messages: history },
        prefsRef.current,
        enrolledSubjectsRef.current
      );
      lastTopicRef.current = r.topics?.[0]?.topic_id ?? lastTopicRef.current;
      lastQuestionRef.current = q;
      push({ role: "assistant", content: r.answer ?? "", exportable: true, chips: AFTER_ANSWER });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }, [fail, push]);

  /** "Quiz me" / "Big question": a practice question about what we just learned. */
  const practice = useCallback(async (mode: "quiz" | "bigq", label: string) => {
    const subj = subjRef.current;
    if (!subj || busy) return;
    push({ role: "user", content: label });
    setBusy(true);
    try {
      const r = await teacherChat(
        { mode, subjectId: subj.id, question: label, topicId: lastTopicRef.current, context: lastQuestionRef.current, avoid: askedRef.current },
        prefsRef.current,
        enrolledSubjectsRef.current
      );
      if (mode === "quiz" && r.quiz) {
        askedRef.current = [...askedRef.current, r.quiz.question].slice(-8);
        push({
          role: "assistant",
          local: true,
          content: "Here is a question for you 👇",
          quiz: { id: `q${Date.now()}`, question: r.quiz.question, options: r.quiz.options, correctIndex: r.quiz.correct_index, explanation: r.quiz.explanation },
        });
      } else if (mode === "bigq" && r.bigq) {
        bigQRef.current = r.bigq;
        setAwaitingAnswer(true);
        push({
          role: "assistant",
          local: true,
          content: `✍️ **Big question**\n\n${r.bigq.question}\n\nType your answer below and I will mark it. 📝`,
          chips: [{ label: "Skip this one", mode: "skip" }],
        });
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }, [busy, fail, push]);

  const gradeAnswer = useCallback(async (answer: string) => {
    const subj = subjRef.current;
    const bq = bigQRef.current;
    if (!subj || !bq) return;
    bigQRef.current = null;
    setAwaitingAnswer(false);
    setBusy(true);
    try {
      const r = await teacherChat(
        { mode: "grade", subjectId: subj.id, question: answer, bigq: bq },
        prefsRef.current,
        enrolledSubjectsRef.current
      );
      push({ role: "assistant", content: r.answer ?? "", chips: AFTER_PRACTICE });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }, [fail, push]);

  const ask = useCallback(async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    push({ role: "user", content: q });

    // The next message after a big question is the student's answer.
    if (bigQRef.current) { await gradeAnswer(q); return; }

    const enrolledList = enrolledSubjectsRef.current || subjects.map(s => s.name).join(", ");

    // 1. Enforce enrolled syllabus boundary: check for topics outside enrolled courses
    if (isExternalTopicQuery(q, enrolledList)) {
      const externalTopic = extractExternalTopicName(q);
      push({
        role: "assistant",
        content: `I am your personal AI tutor for your enrolled syllabus (${enrolledList}). I cannot answer questions about external topics like ${externalTopic}. Which of your enrolled subjects would you like to study today?`,
        local: true,
      });
      return;
    }

    // 2. Greeting check: when user says "hey" or "hello", prompt them for the subject
    const isGreeting = /^(hi|hey|hello|namaste|vanakkam|good\s*(morning|afternoon|evening)|hola)(\s*teacher|\s*sir|\s*madam)?\b[!.?]*$/i.test(q);
    if (isGreeting) {
      if (!subjRef.current) {
        push({
          role: "assistant",
          content: "Namaste! How can I help you today? Which subject would you like to study?",
          local: true,
        });
        return;
      } else {
        push({
          role: "assistant",
          content: `Namaste! We are currently studying ${subjRef.current.name}. What would you like to learn today? Ask me any question, or say "teach me chapter 1".`,
          local: true,
        });
        return;
      }
    }

    // 3. Listen for a subject in the message.
    const named = detectSubject(q, subjects);
    let subj = subjRef.current;
    if (named) {
      subj = named;
      subjRef.current = named;
      onSubject(named);
    }

    // 4. If user named a subject (e.g. Science, Mathematics, Social Science) or only subject
    const isSubjectIntent = named && (
      isOnlySubject(q, named) ||
      /^(i\s*(want|would like)\s*to\s*(study|learn)|let('?s)?\s*(study|learn)|teach\s*me|start\s*with)\b/i.test(q)
    );

    if (isSubjectIntent && named) {
      const pending = pendingRef.current;
      pendingRef.current = null;
      push({
        role: "assistant",
        local: true,
        content: pending
          ? `Great, let's study ${named.name}! Let me answer your question: "${pending.q}".`
          : `Great, let's study ${named.name}! What would you like to learn today? Ask me any question, or say "teach me chapter 1".`,
      });
      if (pending) await run(pending.q, named);
      return;
    }

    // 5. If still no subject is selected, ask conversationally
    if (!subj) {
      pendingRef.current = { q };
      push({
        role: "assistant",
        content: "Namaste! How can I help you today? Which subject would you like to study?",
        local: true,
      });
      return;
    }

    pendingRef.current = null;
    await run(q, subj);
  }, [busy, gradeAnswer, onSubject, push, run, subjects]);

  const onChip = (c: ChipDef) => {
    if (c.mode === "skip") {
      bigQRef.current = null;
      setAwaitingAnswer(false);
      push({ role: "assistant", local: true, content: "No problem, we can skip it! 😊 What next?", chips: AFTER_PRACTICE });
    } else if (c.mode) {
      void practice(c.mode, c.label);
    } else if (c.text) {
      void ask(c.text);
    }
  };

  const submit = () => {
    const q = text;
    if (!q.trim() || busy) return;
    setText("");
    void ask(q);
  };

  const lastId = messages[messages.length - 1]?.id;

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain p-3 sm:p-4">
        {messages.map((m) => (
          <div key={m.id} className={cn("flex gap-3", m.role === "user" && "flex-row-reverse")}>
            <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", m.role === "user" ? "bg-primary text-primary-foreground" : "bg-emerald-100 text-emerald-700")}>
              {m.role === "user" ? <User className="h-4 w-4" /> : <GraduationCap className="h-4 w-4" />}
            </div>
            <div className={cn("min-w-0 max-w-[88%] space-y-2", m.role === "user" && "text-right")}>
              {m.role === "user" ? (
                <p className="inline-block rounded-2xl bg-primary px-3 py-2 text-left text-sm text-primary-foreground">{m.content}</p>
              ) : (
                <>
                  {m.content && (
                    <div className={cn("rounded-2xl border bg-background px-4 py-3", m.error && "border-destructive/40 text-destructive")}>
                      <Markdown>{m.content}</Markdown>
                    </div>
                  )}
                  {m.quiz && (
                    <QuizCard
                      quiz={m.quiz}
                      onAnswer={(_, correct) => push({
                        role: "assistant",
                        local: true,
                        content: correct ? "🎉 Correct! Want another one?" : "No worries, now you know! 💪 Want to try another?",
                        chips: AFTER_PRACTICE,
                      })}
                    />
                  )}
                  {m.exportable && <ExportRow markdown={m.content} subjectName={subject?.name} />}
                </>
              )}
              {m.chips && m.id === lastId && !busy && (
                <div className="flex flex-wrap gap-2">
                  {m.chips.map((c) => (
                    <Button key={c.label} variant="outline" size="sm" className="h-auto whitespace-normal rounded-full py-1.5" onClick={() => onChip(c)}>{c.label}</Button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex items-center gap-3 text-sm text-muted-foreground" aria-live="polite">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><GraduationCap className="h-4 w-4" /></div>
            <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Thinking…</span>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="flex shrink-0 items-end gap-2 border-t bg-card p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          placeholder={awaitingAnswer ? "Type your answer to the big question…" : subject ? "Ask a question or say “teach me…”" : "Tell me the subject or ask a question"}
          aria-label="Ask a question"
          rows={1}
          maxLength={1500}
          className="max-h-32 min-h-[44px] resize-none text-base md:text-sm"
        />
        <Button type="submit" size="icon" className="h-11 w-11 shrink-0" disabled={!text.trim() || busy} aria-label="Send"><Send className="h-4 w-4" /></Button>
      </form>
    </section>
  );
}

/** Save a teaching answer as a PDF or Word document. */
function ExportRow({ markdown, subjectName }: { markdown: string; subjectName?: string }) {
  if (markdown.trim().length < 80) return null;
  const heading = markdown.match(/^#{1,3}\s+(.+)$/m)?.[1]?.replace(/[*_`]/g, "").trim();
  const title = heading || `${subjectName ?? "Study"} notes`;
  return (
    <div className="flex flex-wrap items-center gap-2 pl-1">
      <button type="button" onClick={() => printPdf(markdownToHtml(title, markdown))} className="flex items-center gap-1 rounded-full border bg-background px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
        <FileDown className="h-3.5 w-3.5" />PDF
      </button>
      <button type="button" onClick={() => downloadWord(markdownToHtml(title, markdown), title)} className="flex items-center gap-1 rounded-full border bg-background px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
        <FileText className="h-3.5 w-3.5" />Word
      </button>
    </div>
  );
}
