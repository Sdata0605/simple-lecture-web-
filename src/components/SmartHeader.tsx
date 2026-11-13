import { Suspense } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Header } from "@/components/Header";
import { lazyWithRetry } from "@/lib/lazyWithRetry";

// The logged-in header (with notifications and the dashboard menu) is only needed
// for signed-in visitors, so it is loaded on demand. Guests never download it.
const DashboardHeader = lazyWithRetry(() =>
  import("@/components/dashboard/DashboardHeader").then((m) => ({ default: m.DashboardHeader }))
);

interface SmartHeaderProps {
  minimal?: boolean;
}

export const SmartHeader = ({ minimal = false }: SmartHeaderProps = {}) => {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <Header minimal={minimal} />;
  }

  return isAuthenticated ? (
    <Suspense fallback={null}>
      <DashboardHeader minimal={minimal} />
    </Suspense>
  ) : (
    <Header minimal={minimal} />
  );
};
