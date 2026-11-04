import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const useCurrentUser = () => {
  return useQuery({
    queryKey: ["current-user"],
    queryFn: async () => {
      // The signed-in user comes from the saved session, the same source the header uses. Asking the server
      // (getUser) fails when the auth proxy is unreachable and made signed-in students look logged out.
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;

      if (!user) return null;

      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();

      return {
        ...user,
        profile
      };
    },
  });
};
