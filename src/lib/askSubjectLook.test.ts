import { describe, expect, it } from "vitest";
import { lookFor } from "./askSubjectLook";

describe("lookFor", () => {
  it("gives maths a blue look", () => {
    expect(lookFor("Maths")).toMatchObject({ icon: "Calculator", from: "#123a73", to: "#0a1b3a", accent: "#2f7bea" });
    expect(lookFor("MATHEMATICS").icon).toBe("Calculator");
  });

  it("gives science a green look", () => {
    expect(lookFor("Science")).toMatchObject({ icon: "FlaskConical", from: "#0f5a4a", border: "#23b08f", accent: "#17b58f" });
  });

  it("gives social studies an amber look", () => {
    expect(lookFor("Social Studies")).toMatchObject({ icon: "Earth", from: "#6b4414", to: "#2a1a08", accent: "#c98a2e" });
  });

  it("gives other subjects a stable fallback", () => {
    const first = lookFor("Kannada");
    expect(lookFor("Kannada")).toEqual(first);
    expect(first.from).toBe("#123a73");
    expect(["Library", "Lightbulb", "School", "BookOpen", "Rocket", "Telescope"]).toContain(first.icon);
  });
});
