import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, ExternalLink, FileText, ListChecks, Presentation } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { BankQuestion, TeacherDocument, TeacherReference } from "@/lib/aiTeacherApi";
import type { BoardItem } from "./useLiveTeacher";
import { Markdown } from "./Markdown";
import { QuizCard, bankToQuiz, type QuizItem } from "./QuizCard";

interface Props {
  board: BoardItem[];
  references: TeacherReference[];
  documents: TeacherDocument[];
  practice: BankQuestion[];
  onQuizAnswer?: (quiz: QuizItem, optionIndex: number) => void;
}

const Empty = ({ icon: Icon, text }: { icon: typeof BookOpen; text: string }) => (
  <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
    <Icon className="h-8 w-8 opacity-40" />
    <p className="max-w-xs">{text}</p>
  </div>
);

export function ReferenceList({ references }: { references: TeacherReference[] }) {
  return (
    <div className="space-y-3">
      {references.map((r) => (
        <article key={r.id} className="rounded-xl border bg-card p-3 shadow-sm">
          <p className="mb-1 text-xs font-medium text-primary">
            {[r.chapter_title, r.topic_title].filter(Boolean).join(" › ")}
          </p>
          <p className="mb-2 text-xs text-muted-foreground">{r.heading_path.split(" > ").slice(-2).join(" › ")}</p>
          <div className="max-h-56 overflow-auto pr-1">
            <Markdown>{r.content}</Markdown>
          </div>
        </article>
      ))}
    </div>
  );
}

export function PresentationPanel({ board, references, documents, practice, onQuizAnswer }: Props) {
  const [tab, setTab] = useState("board");
  const endRef = useRef<HTMLDivElement>(null);
  const quizzes = useMemo(() => practice.map(bankToQuiz).filter((q): q is QuizItem => !!q), [practice]);

  // Jump to the board when the teacher puts something on it.
  useEffect(() => {
    if (board.length) {
      setTab("board");
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [board.length]);

  return (
    <Tabs value={tab} onValueChange={setTab} className="flex h-full min-h-0 flex-col">
      <TabsList className="grid w-full grid-cols-4">
        <TabsTrigger value="board" className="gap-1 text-xs sm:text-sm"><Presentation className="h-4 w-4" /><span>Board</span></TabsTrigger>
        <TabsTrigger value="notes" className="gap-1 text-xs sm:text-sm">
          <BookOpen className="h-4 w-4" /><span>Notes</span>
          {references.length > 0 && <Badge variant="secondary" className="h-5 px-1.5">{references.length}</Badge>}
        </TabsTrigger>
        <TabsTrigger value="files" className="gap-1 text-xs sm:text-sm">
          <FileText className="h-4 w-4" /><span>Files</span>
          {documents.length > 0 && <Badge variant="secondary" className="h-5 px-1.5">{documents.length}</Badge>}
        </TabsTrigger>
        <TabsTrigger value="practice" className="gap-1 text-xs sm:text-sm">
          <ListChecks className="h-4 w-4" /><span>Practice</span>
          {quizzes.length > 0 && <Badge variant="secondary" className="h-5 px-1.5">{quizzes.length}</Badge>}
        </TabsTrigger>
      </TabsList>

      <div className="mt-3 min-h-0 flex-1 overflow-auto pr-1">
        <TabsContent value="board" className="m-0 space-y-3">
          {board.length === 0 ? (
            <Empty icon={Presentation} text="Slides and quick questions from your teacher will appear here while you talk." />
          ) : (
            board.map((item) =>
              item.kind === "slide" ? (
                <section key={item.id} className="rounded-xl border bg-gradient-to-br from-emerald-50 to-white p-4 shadow-sm">
                  <h3 className="mb-2 text-base font-semibold text-emerald-900">{item.title}</h3>
                  <ul className="list-disc space-y-1 pl-5 text-sm">
                    {item.bullets.map((b, i) => <li key={i}>{b}</li>)}
                  </ul>
                </section>
              ) : (
                <QuizCard key={item.id} quiz={item.quiz} onAnswer={(i) => onQuizAnswer?.(item.quiz, i)} />
              ),
            )
          )}
          <div ref={endRef} />
        </TabsContent>

        <TabsContent value="notes" className="m-0">
          {references.length === 0
            ? <Empty icon={BookOpen} text="The notes your teacher is using will show up here, with chapter and topic." />
            : <ReferenceList references={references} />}
        </TabsContent>

        <TabsContent value="files" className="m-0">
          {documents.length === 0 ? (
            <Empty icon={FileText} text="No PDF files are linked to this topic yet. The notes tab has the full text." />
          ) : (
            <ul className="space-y-2">
              {documents.map((d, i) => (
                <li key={i}>
                  <a href={d.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg border bg-card p-3 text-sm hover:bg-accent">
                    <FileText className="h-4 w-4 shrink-0 text-red-500" />
                    <span className="flex-1">{d.title}</span>
                    <ExternalLink className="h-4 w-4 text-muted-foreground" />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="practice" className="m-0 space-y-3">
          {quizzes.length === 0
            ? <Empty icon={ListChecks} text="Practice questions for the topic you are learning will appear here." />
            : quizzes.map((q) => <QuizCard key={q.id} quiz={q} onAnswer={(i) => onQuizAnswer?.(q, i)} />)}
        </TabsContent>
      </div>
    </Tabs>
  );
}
