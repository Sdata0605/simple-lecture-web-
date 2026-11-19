import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const useSubjectCourses = (subjectId?: string) => {
  return useQuery({
    queryKey: ["subject-courses", subjectId],
    queryFn: async () => {
      if (!subjectId) return [];

      const { data, error } = await supabase
        .from("course_subjects")
        .select(`
          course_id,
          courses (
            id,
            name,
            slug,
            price_inr,
            original_price_inr, offer_active, offer_content,
            is_active
          )
        `)
        .eq("subject_id", subjectId);

      if (error) throw error;
      return data.map(cs => cs.courses).filter(Boolean);
    },
    enabled: !!subjectId,
  });
};
