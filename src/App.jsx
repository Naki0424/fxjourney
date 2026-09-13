import React, { useEffect, useState } from "react";
import AppLayout from "./components/layout/AppLayout";
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

export default function App() {
  const path = usePath();
  const [sidebarOpen, setSidebarOpen] = useState(false);
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
  return (
    <AppLayout
      path={path}
      open={sidebarOpen}
      onToggle={() => setSidebarOpen((value) => !value)}
    >
      {pages[route] || pages.dashboard}
    </AppLayout>
  );
}
