// Focus state for the Ask AI overlay while a presentation (lesson cards) is on screen. The teacher panel
// slides away to the right while a presentation is shown; a small robot in the top bar brings it back.

export type FocusState = "lesson-full" | "presenting" | "presenting-with-panel";

export type FocusEvent = "PRESENTATION_START" | "PRESENTATION_END" | "OPEN_PANEL" | "MINIMISE" | "RESET";

export function focusReducer(state: FocusState, event: FocusEvent): FocusState {
  if (event === "RESET") return "lesson-full";

  switch (state) {
    case "lesson-full":
      return event === "PRESENTATION_START" ? "presenting" : state;
    case "presenting":
      if (event === "OPEN_PANEL") return "presenting-with-panel";
      if (event === "PRESENTATION_END") return "lesson-full";
      return state;
    case "presenting-with-panel":
      if (event === "MINIMISE") return "presenting";
      if (event === "PRESENTATION_END") return "lesson-full";
      return state;
    default:
      return state;
  }
}
