import React from "react";
import { navItems } from "../../data/mockData";
import { navigate } from "../../lib/navigation";
export default function Sidebar({ path, open }) {
  return (
    <aside className={"sidebar " + (open ? "open" : "")}>
      <div className="brand">
        <span className="brand-mark">▥</span>
        <span>
          FOREX
          <br />
          <span>JOURNEY</span>
        </span>
      </div>
      <div className="tagline">Your Journey. Your Edge.</div>
      <nav className="nav">
        {navItems.map(([label, to]) => (
          <button
            key={to}
            className={path === to ? "active" : ""}
            onClick={() => navigate(to)}
          >
            <span className="nav-icon">
              {label === "Dashboard" ? "▦" : label === "Settings" ? "⚙" : "▤"}
            </span>
            {label}
          </button>
        ))}
        <button
          className={path === "/analyzer" ? "active" : ""}
          onClick={() => navigate("/analyzer")}
        >
          <span className="nav-icon">✦</span>AI Analyzer
        </button>
      </nav>
      <div className="sidebar-bottom">
        <div className="profile">
          <div className="avatar" />
          <div>
            John Trader
            <br />
            <small>Pro Account</small>
          </div>
          <span className="profile-chevron">⌄</span>
        </div>
        <div className="time-box">
          Current Time<b>May 18, 2024&nbsp;&nbsp; 10:30 AM</b>London, GMT+1
        </div>
        <div className="dark-mode-row">
          <span>◐　Dark Mode</span>
          <i />
        </div>
      </div>
    </aside>
  );
}
