import React from "react";
export default function LineChart() {
  return (
    <div className="chart">
      <svg viewBox="0 0 500 190" preserveAspectRatio="none">
        <path
          d="M0 155 L45 170 L85 145 L120 155 L160 120 L205 120 L245 88 L285 105 L325 75 L360 45 L390 72 L420 48 L455 32 L500 18"
          fill="none"
          stroke="#2869ed"
          strokeWidth="3"
        />
        <path
          d="M0 155 L45 170 L85 145 L120 155 L160 120 L205 120 L245 88 L285 105 L325 75 L360 45 L390 72 L420 48 L455 32 L500 18 V190 H0Z"
          fill="#2869ed"
          opacity=".1"
        />
      </svg>
    </div>
  );
}
