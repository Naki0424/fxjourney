import React, { useEffect, useState } from "react";
import AppLayout from "./components/layout/AppLayout";
import { useApplication } from "./context/ApplicationContext";
import Dashboard from "./pages/Dashboard";
import Trades from "./pages/Trades";
import Journal from "./pages/Journal";
import Screenshots from "./pages/Screenshots";
import Goals from "./pages/Goals";
import Analytics from "./pages/Analytics";
import Settings from "./pages/Settings";
import NewTrade from "./pages/NewTrade";
import TradeDetails from "./pages/TradeDetails";
import Analyzer from "./pages/Analyzer";

function usePath() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  return path;
}

function StartupState({ status, error, onRetry }) {
  if (status === "loading") {
    return (
      <div className="startup-state" role="status" aria-live="polite">
        <span className="startup-state-icon">◌</span>
        <h1>Loading FXJourney</h1>
        <p>Preparing your local workspace and accounts.</p>
      </div>
    );
  }

  return (
    <div className="startup-state startup-state-error" role="alert">
      <span className="startup-state-icon">!</span>
      <h1>Workspace unavailable</h1>
      <p>{error?.message || "Unable to load your local workspace."}</p>
      <button className="btn primary" onClick={onRetry}>Retry</button>
    </div>
  );
}

export default function App() {
  const path = usePath();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { status, error, refresh } = useApplication();
  const route = path.slice(1) || "dashboard";
  const pages = {
    dashboard: <Dashboard />,
    trades: <Trades />,
    journal: <Journal />,
    screenshots: <Screenshots />,
    goals: <Goals />,
    analytics: <Analytics />,
    settings: <Settings />,
    "new-trade": <NewTrade />,
    "trade-details": <TradeDetails />,
    analyzer: <Analyzer />,
  };
  const content = status === "ready"
    ? pages[route] || pages.dashboard
    : <StartupState status={status} error={error} onRetry={refresh} />;

  return (
    <AppLayout
      path={path}
      open={sidebarOpen}
      onToggle={() => setSidebarOpen((value) => !value)}
    >
      {content}
    </AppLayout>
  );
}
