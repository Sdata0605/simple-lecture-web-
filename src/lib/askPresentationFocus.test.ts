import { describe, expect, it } from "vitest";
import { focusReducer, type FocusEvent, type FocusState } from "./askPresentationFocus";

describe("focusReducer", () => {
  it("starts a presentation from the full lesson", () => {
    expect(focusReducer("lesson-full", "PRESENTATION_START")).toBe("presenting");
  });

  it("opens the panel while presenting", () => {
    expect(focusReducer("presenting", "OPEN_PANEL")).toBe("presenting-with-panel");
  });

  it("minimises the panel back to presenting", () => {
    expect(focusReducer("presenting-with-panel", "MINIMISE")).toBe("presenting");
  });

  it("ends the presentation from either presenting state", () => {
    expect(focusReducer("presenting", "PRESENTATION_END")).toBe("lesson-full");
    expect(focusReducer("presenting-with-panel", "PRESENTATION_END")).toBe("lesson-full");
  });

  it("resets to the full lesson from any state", () => {
    const states: FocusState[] = ["lesson-full", "presenting", "presenting-with-panel"];
    for (const state of states) {
      expect(focusReducer(state, "RESET")).toBe("lesson-full");
    }
  });

  it("returns the same state for pairs that do not apply", () => {
    const pairs: [FocusState, FocusEvent][] = [
      ["lesson-full", "OPEN_PANEL"],
      ["lesson-full", "MINIMISE"],
      ["lesson-full", "PRESENTATION_END"],
      ["presenting", "PRESENTATION_START"],
      ["presenting", "MINIMISE"],
      ["presenting-with-panel", "OPEN_PANEL"],
      ["presenting-with-panel", "PRESENTATION_START"],
    ];
    for (const [state, event] of pairs) {
      expect(focusReducer(state, event)).toBe(state);
    }
  });
});
