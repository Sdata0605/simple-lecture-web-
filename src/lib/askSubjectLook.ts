// Colours and icon for a subject card on the Ask AI subject picker. Matched by keyword, so "Maths",
// "Mathematics" and "Math" all look the same; anything else gets the blue look with a stable icon.

export interface SubjectLook {
  icon: string;
  from: string;
  to: string;
  border: string;
  accent: string;
}

const FALLBACK_ICONS = ["Library", "Lightbulb", "School", "BookOpen", "Rocket", "Telescope"] as const;

function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (h * 31 + text.charCodeAt(i)) >>> 0;
  }
  return h;
}

export function lookFor(name: string): SubjectLook {
  const key = name.toLowerCase();
  if (key.includes("social")) {
    return { icon: "Earth", from: "#6b4414", to: "#2a1a08", border: "#c98a2e", accent: "#c98a2e" };
  }
  if (key.includes("math")) {
    return { icon: "Calculator", from: "#123a73", to: "#0a1b3a", border: "#2f6fd0", accent: "#2f7bea" };
  }
  if (key.includes("science")) {
    return { icon: "FlaskConical", from: "#0f5a4a", to: "#08261f", border: "#23b08f", accent: "#17b58f" };
  }
  const icon = FALLBACK_ICONS[hash(key) % FALLBACK_ICONS.length];
  return { icon, from: "#123a73", to: "#0a1b3a", border: "#2f6fd0", accent: "#2f7bea" };
}
