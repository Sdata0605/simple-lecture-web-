import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { isExcludedPath } from '@/lib/analytics';

declare global {
  interface Window { gtag: (...args: any[]) => void; }
}

export const useGoogleAnalytics = () => {
  const location = useLocation();
  // index.html already configures GA and sends the first page_view; only send for later route changes.
  const isFirstRun = useRef(true);
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    // Never report admin / internal pages.
    if (isExcludedPath(location.pathname)) return;
    if (window.gtag) {
      window.gtag('config', 'G-58WPH9BBXM', {
        page_path: location.pathname + location.search,
        send_page_view: true,
      });
    }
  }, [location]);
};
