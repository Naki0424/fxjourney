import React from "react";
export default function Stat({ label, value, sub, positive }) {
  return (
    <div className="stat">
      <label>{label}</label>
      <strong className={positive ? "positive" : ""}>{value}</strong>
      <small>{sub}</small>
    </div>
  );
}
