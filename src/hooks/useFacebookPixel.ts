import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { isExcludedPath } from "@/lib/analytics";

declare global {
  interface Window {
    fbq: (...args: any[]) => void;
  }
}

export const useFacebookPixel = () => {
  const location = useLocation();

  useEffect(() => {
    // Never report admin / internal pages.
    if (isExcludedPath(location.pathname)) return;
    if (typeof window.fbq === "function") {
      window.fbq("track", "PageView");
    }
  }, [location.pathname, location.search]);
};
