// Mounted once in App. Shows the Ask AI screen whenever something on the site calls openAskAI() (see
// lib/askAIStore.ts): the same screen the lecture player's Ask AI button opens, so every Ask AI button leads to
// one place. The lecture player keeps its own copy of the screen, because it hands it the paused lecture.
import { useQuery } from "@tanstack/react-query";
import { teacherApi, type TeacherSubject } from "@/lib/aiTeacherApi";
import { chooseSubject, closeAskAI, useAskAIRequest } from "@/lib/askAIStore";
import { AskAIAssistant } from "./AskAIAssistant";

export function AskAIHost() {
  const request = useAskAIRequest();
  if (!request) return null;
  return <AskAIScreen request={request} />;
}

function AskAIScreen({ request }: { request: NonNullable<ReturnType<typeof useAskAIRequest>> }) {
  // Same query key as the lecture player, so the list is usually already there.
  const { data: subjects, isError, refetch } = useQuery({
    queryKey: ["ai-teacher", "subjects"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => (await teacherApi<{ subjects: TeacherSubject[] }>("subjects")).subjects,
  });

  const choice = subjects ? chooseSubject(request, subjects) : null;
  return (
    <AskAIAssistant
      trigger="ask"
      onClose={closeAskAI}
      subject={choice?.kind === "subject" ? choice.subject : null}
      topicTitle={request.topicTitle}
      choices={{
        subjects: subjects ?? null,
        failed: isError && !subjects,
        unknown: choice?.kind === "pick" ? choice.unknown : null,
        onRetry: () => void refetch(),
      }}
    />
  );
}

export default AskAIHost;
