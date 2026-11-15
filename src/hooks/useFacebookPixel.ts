import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { isExcludedPath } from "@/lib/analytics";

declare global {
  interface Window {
    fbq: (...args: any[]) => void;
  }
}

export const useFacebookPixel = () => {
  const location = useLocation();
  // index.html already sends the first PageView on load; only send for later route changes.
  const isFirstRun = useRef(true);

  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    // Never report admin / internal pages.
    if (isExcludedPath(location.pathname)) return;
    if (typeof window.fbq === "function") {
      window.fbq("track", "PageView");
    }
  }, [location.pathname, location.search]);
};
