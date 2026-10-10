import { GraduationCap } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Skeleton } from "@/components/ui/skeleton";
import type { OutlineChapter } from "@/lib/aiTeacherApi";

export interface PickedTopic { id: string; title: string; chapterTitle: string }

export function Syllabus({
  chapters,
  loading,
  onPick,
}: {
  chapters: OutlineChapter[] | undefined;
  loading: boolean;
  onPick: (t: PickedTopic) => void;
}) {
  if (loading) return <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-9 w-full" />)}</div>;
  if (!chapters?.length) return <p className="p-2 text-sm text-muted-foreground">No lessons available for this subject yet.</p>;
  return (
    <Accordion type="single" collapsible className="w-full">
      {chapters.map((c) => (
        <AccordionItem key={c.id} value={c.id} className="border-b">
          <AccordionTrigger className="py-2.5 text-left text-sm hover:no-underline">
            <span><span className="mr-1.5 font-semibold text-emerald-700">{c.number}.</span>{c.title}</span>
          </AccordionTrigger>
          <AccordionContent className="pb-2">
            <ul className="space-y-0.5">
              {c.topics.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => onPick({ id: t.id, title: t.title, chapterTitle: c.title })}
                    className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                    title="Teach me this lesson"
                  >
                    <GraduationCap className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-primary" />
                    <span className="flex-1"><span className="mr-1.5 text-xs text-muted-foreground">{t.label}</span>{t.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
