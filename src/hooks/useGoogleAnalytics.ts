import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { isExcludedPath } from '@/lib/analytics';

declare global {
  interface Window { gtag: (...args: any[]) => void; }
}

export const useGoogleAnalytics = () => {
  const location = useLocation();
  useEffect(() => {
    // Never report admin / internal pages.
    if (isExcludedPath(location.pathname)) return;
    if (window.gtag) {
      window.gtag('config', 'G-Y9TRRTCVJR', {
        page_path: location.pathname + location.search,
        send_page_view: true,
      });
    }
  }, [location]);
};
