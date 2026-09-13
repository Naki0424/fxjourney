import React from "react";
import Sidebar from "./Sidebar";
export default function AppLayout({ path, open, onToggle, children }) {
  return (
    <div className="app">
      <button className="mobile-menu" onClick={onToggle}>
        ☰
      </button>
      <Sidebar path={path} open={open} />
      <main className="main">
        <section className="page">{children}</section>
      </main>
    </div>
  );
}
