import { afterEach, describe, expect, it, vi } from "vitest";
import type { TeacherSubject } from "./aiTeacherApi";
import { chooseSubject, closeAskAI, openAskAI, useAskAIRequest } from "./askAIStore";

vi.mock("react", () => ({ useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get() }));

const science: TeacherSubject = { id: "sci", name: "Science", topics: 40 };
const social: TeacherSubject = { id: "soc", name: "Social Science", topics: 30 };
const maths: TeacherSubject = { id: "mat", name: "Maths", topics: 50 };

describe("chooseSubject: which subject Ask AI teaches", () => {
  it("uses the subject the student is on, by id", () => {
    expect(chooseSubject({ subjectId: "soc", subjectName: "Whatever" }, [science, social])).toEqual({ kind: "subject", subject: social });
  });

  it("falls back to the subject's name, including the usual short names", () => {
    expect(chooseSubject({ subjectName: "Social Science" }, [science, social])).toEqual({ kind: "subject", subject: social });
    expect(chooseSubject({ subjectName: "Mathematics" }, [science, maths])).toEqual({ kind: "subject", subject: maths });
  });

  it("starts straight away when there is only one subject and the student was not on another", () => {
    expect(chooseSubject({}, [science])).toEqual({ kind: "subject", subject: science });
  });

  it("lets the student pick when they come from the home page and there are several subjects", () => {
    expect(chooseSubject({}, [science, social])).toEqual({ kind: "pick", unknown: null });
  });

  it("says so when the subject the student is on is not one the teacher can teach yet", () => {
    expect(chooseSubject({ subjectId: "acc", subjectName: "Accountancy" }, [science])).toEqual({ kind: "pick", unknown: "Accountancy" });
  });
});

describe("opening and closing Ask AI", () => {
  afterEach(() => closeAskAI());

  it("is closed until something opens it, and remembers what the student was on", () => {
    expect(useAskAIRequest()).toBeNull();
    openAskAI({ subjectId: "sci", subjectName: "Science", topicTitle: "Light" });
    expect(useAskAIRequest()).toEqual({ subjectId: "sci", subjectName: "Science", topicTitle: "Light" });
  });

  it("opens with no details at all (the floating AI button)", () => {
    openAskAI();
    expect(useAskAIRequest()).toEqual({});
  });

  it("closes again", () => {
    openAskAI();
    closeAskAI();
    expect(useAskAIRequest()).toBeNull();
  });
});
