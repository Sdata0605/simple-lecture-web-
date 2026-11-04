import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentAuthUser } from "@/hooks/useCurrentAuthUser";

export const useInstructorSubjectsAssigned = () => {
  const { data: authUser } = useCurrentAuthUser();

  return useQuery({
    queryKey: ["instructor-subjects-assigned", authUser?.id],
    queryFn: async () => {
      if (!authUser?.id) return [];

      // No foreign keys exist on instructor_subjects, so the subject and course are loaded separately.
      const { data: rows, error } = await supabase
        .from("instructor_subjects")
        .select("id, subject_id, course_id")
        .eq("instructor_id", authUser.id);

      if (error) throw error;
      const assigned = rows ?? [];
      const subjectIds = [...new Set(assigned.map((r) => r.subject_id).filter(Boolean) as string[])];
      const courseIds = [...new Set(assigned.map((r) => r.course_id).filter(Boolean) as string[])];

      const [{ data: subjects }, { data: courses }] = await Promise.all([
        subjectIds.length
          ? supabase.from("popular_subjects").select("id, name, slug, description, image_url").in("id", subjectIds)
          : Promise.resolve({ data: [] as any[] }),
        courseIds.length
          ? supabase.from("courses").select("id, name, slug").in("id", courseIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);

      const subjectById = new Map((subjects ?? []).map((s: any) => [s.id, s]));
      const courseById = new Map((courses ?? []).map((c: any) => [c.id, c]));
      return assigned.map((r) => ({
        id: r.id,
        subject: (r.subject_id && subjectById.get(r.subject_id)) || null,
        course: (r.course_id && courseById.get(r.course_id)) || null,
      }));
    },
    enabled: !!authUser?.id,
  });
};
