import { describe, expect, it } from "vitest";
import { courseNamesBySubject } from "./aiTeacherSubjects";

describe("courseNamesBySubject: which course a subject belongs to", () => {
  it("lists every visible course of a subject, once each, in order", () => {
    const rows = [
      {
        id: "sci",
        course_subjects: [
          { courses: { name: "Class 10 (SSLC - Karnataka)" } },
          { courses: { name: "Class 10 (CBSE) Complete Course 2026" } },
          { courses: { name: "Class 10 (SSLC - Karnataka)" } },
        ],
      },
    ];
    expect(courseNamesBySubject(rows)).toEqual({ sci: ["Class 10 (SSLC - Karnataka)", "Class 10 (CBSE) Complete Course 2026"] });
  });

  it("leaves out courses the student cannot see and subjects with no course at all", () => {
    const rows = [
      { id: "hidden", course_subjects: [{ courses: null }] },
      { id: "none", course_subjects: [] },
      { id: "missing", course_subjects: null },
      { id: "blank", course_subjects: [{ courses: { name: "  " } }, { courses: { name: null } }] },
      { id: "pharm", course_subjects: [{ courses: { name: " D.Pharmacy " } }] },
    ];
    expect(courseNamesBySubject(rows)).toEqual({ pharm: ["D.Pharmacy"] });
  });
});
