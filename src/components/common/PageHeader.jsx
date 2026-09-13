import React from "react";
export default function PageHeader({ title, sub, children }) {
  return (
    <div className="topline">
      <div>
        <h1>{title}</h1>
        <p>{sub}</p>
      </div>
      <div className="actions">{children}</div>
    </div>
  );
}
