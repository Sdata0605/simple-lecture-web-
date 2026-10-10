import type { TeacherSubject } from "./aiTeacherApi";

const norm = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9ऀ-ॿಀ-೿\s]/g, " ").replace(/\s+/g, " ").trim();

/** Other ways students name a subject, keyed by the normalized subject name. */
const ALIASES: Record<string, string[]> = {
  "social science": ["social studies", "sst", "social"],
  maths: ["math", "mathematics"],
  mathematics: ["math", "maths"],
  science: ["general science"],
};

function namesFor(s: TeacherSubject): string[] {
  const n = norm(s.name);
  return [n, ...(ALIASES[n] ?? [])].filter(Boolean);
}

/** Longest-name-first so "social science" wins over "science". */
export function detectSubject(text: string, subjects: TeacherSubject[]): TeacherSubject | null {
  const t = ` ${norm(text)} `;
  const candidates = subjects
    .flatMap((s) => namesFor(s).map((n) => ({ s, n })))
    .sort((a, b) => b.n.length - a.n.length);
  for (const { s, n } of candidates) if (t.includes(` ${n} `)) return s;
  return null;
}

const FILLER = new Set([
  "i", "want", "to", "study", "learn", "the", "subject", "please", "choose", "pick", "select", "about", "for", "in",
  "of", "my", "is", "it", "its", "lets", "let", "us", "start", "with", "teach", "me", "like", "would", "do", "need", "help",
]);

/** True when the message is just a subject choice ("social science", "I want to study maths"). */
export function isOnlySubject(text: string, subject: TeacherSubject): boolean {
  let t = ` ${norm(text)} `;
  for (const n of namesFor(subject).sort((a, b) => b.length - a.length)) t = t.replace(` ${n} `, " ");
  return t.split(" ").filter(Boolean).every((w) => FILLER.has(w));
}

/** Resolve a name the voice teacher passes to select_subject. */
export function matchSubjectByName(name: string, subjects: TeacherSubject[]): TeacherSubject | null {
  const n = norm(name);
  if (!n) return null;
  return (
    subjects.find((s) => norm(s.name) === n) ??
    detectSubject(name, subjects) ??
    subjects.find((s) => norm(s.name).includes(n) || n.includes(norm(s.name))) ??
    null
  );
}
