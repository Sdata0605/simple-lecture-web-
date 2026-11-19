import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { OFFER_SELECT_FIELDS } from "@/lib/offers";

export interface LiveOfferCourse {
  id: string;
  name: string;
  slug: string;
  price_inr: number | null;
  original_price_inr: number | null;
  offer_active: boolean;
  offer_content: Record<string, string> | null;
}

/** Courses whose exam offer is currently live (public, cached for a minute). */
export const useLiveOffers = () =>
  useQuery({
    queryKey: ["live-offers"],
    queryFn: async (): Promise<LiveOfferCourse[]> => {
      const { data, error } = await supabase
        .from("courses")
        .select(`id, name, slug, price_inr, original_price_inr, ${OFFER_SELECT_FIELDS}`)
        .eq("offer_active", true)
        .eq("is_active", true)
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as LiveOfferCourse[];
    },
    staleTime: 60_000,
  });
