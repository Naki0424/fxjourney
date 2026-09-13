import React from "react";
import Stat from "./Stat";
export default function Stats({ analytics = false }) {
  const vals = analytics
    ? [
        ["Total Net P&L", "+$2,453.67", "+12.35% vs Apr 1 – Apr 30", 1],
        ["Total Trades", "48", "+10 vs previous period"],
        ["Win Rate", "62.5%", "+8.3% vs previous period"],
        ["Profit Factor", "1.82", "+0.28 vs previous period"],
        ["Expectancy (R)", "+0.72R", "+0.21R vs previous period", 1],
        ["Average R:R", "1.64", "-0.05 vs previous period"],
      ]
    : [
        ["Total P/L", "+ $1,250.75", "+12.45% vs last 7 days ↑", 1],
        ["Win Rate", "62.50%", "15W / 9L"],
        ["Total Trades", "24", "vs last 7 days +6"],
        ["Profit Factor", "2.18", "vs last 7 days +0.35"],
        ["Expectancy", "+ $52.11", "vs last 7 days +8.11", 1],
      ];
  return (
    <div className="stats">
      {vals.map((v, i) => (
        <Stat key={i} label={v[0]} value={v[1]} sub={v[2]} positive={v[3]} />
      ))}
    </div>
  );
}
