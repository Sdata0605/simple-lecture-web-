import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

// The AI Teacher no longer has a page of its own. Every AI Teacher entry opens the Ask AI overlay (see
// lib/askAIStore.ts). /aiteacher and /aiteacher-1-to-1 send the student home and ask the app (App.tsx, AskAILayer)
// to open the overlay on arrival, keeping any ?subject= link.
export default function AITeacher() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const subjectName = params.get("subject")?.trim() || undefined;

  useEffect(() => {
    navigate("/", { replace: true, state: { askAI: { subjectName } } });
    // Runs once on arrival; the page is gone after the redirect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
