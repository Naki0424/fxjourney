import React from "react";
import Button from "../components/common/Button";
import Card from "../components/common/Card";
import PageHeader from "../components/common/PageHeader";
import Stats from "../components/common/Stats";
import LineChart from "../components/dashboard/LineChart";
import { dashboardGoals, journalPreview, recentTrades } from "../data/mockData";

function PerformanceOverview() {
  const stats = [
    ["Best Day", "+$530.60", "May 16, 2024"],
    ["Worst Day", "-$150.75", "May 13, 2024"],
    ["Avg Win", "+$120.45", ""],
    ["Avg Loss", "-$85.30", ""],
    ["Avg Trade", "+$52.11", ""],
    ["R:R Ratio", "1.42", ""],
  ];

  return (
    <Card title="Performance Overview ⓘ">
      <LineChart />
      <div className="performance-stats">
        {stats.map(([label, value, date]) => (
          <div className="metric" key={label}>
            <small>{label}</small>
            <b className={value.startsWith("-") ? "negative" : "positive"}>
              {value}
            </b>
            {date && <small>{date}</small>}
          </div>
        ))}
      </div>
    </Card>
  );
}

function TradesBreakdown() {
  return (
    <Card title="Trades Breakdown">
      <div className="donut compact-donut" />
      <div className="legend">
        <span style={{ "--c": "#159447" }}>
          15 Winning <small>(62.50%)</small>
        </span>
        <span style={{ "--c": "#e5484d" }}>
          9 Losing <small>(37.50%)</small>
        </span>
        <span style={{ "--c": "#aab5c6" }}>
          0 Breakeven <small>(0.00%)</small>
        </span>
      </div>
    </Card>
  );
}

function RecentTrades() {
  return (
    <Card
      title={
        <>
          <span>Recent Trades</span>
          <a className="card-link">View All Trades</a>
        </>
      }
      className="recent-card"
    >
      <div className="recent-list">
        {recentTrades.map((trade) => (
          <div className="recent-trade" key={trade.pair}>
            <div>
              <b>{trade.pair}</b>
              <small>
                {trade.type}　•　{trade.lots}
              </small>
            </div>
            <span
              className={`pill ${trade.result === "Win" ? "green" : "red"}`}
            >
              {trade.result}
            </span>
            <b className={trade.pnl.startsWith("-") ? "negative" : "positive"}>
              {trade.pnl}
            </b>
            <small>{trade.rr}</small>
            <span className="chevron">›</span>
          </div>
        ))}
      </div>
      <a className="card-link bottom-link">View all trades　→</a>
    </Card>
  );
}

function StreakConsistency() {
  const days = [
    ["Sun", "L", "red"],
    ["Mon", "W", "green"],
    ["Tue", "W", "green"],
    ["Wed", "–", "gray"],
    ["Thu", "W", "green"],
    ["Fri", "W", "green"],
    ["Sat", "W", "green"],
  ];

  return (
    <Card title="Streak & Consistency">
      <div className="metric-grid streak-metrics">
        <div className="metric">
          <span className="streak-flame">♨</span>
          <small>Current Streak</small>
          <b>3</b>
          <small>Wins in a row</small>
        </div>
        <div className="metric">
          <small>Longest Win Streak</small>
          <b>7</b>
          <small>May 6 – May 10</small>
        </div>
      </div>
      <h3 className="trading-days-title">Trading Days</h3>
      <div className="days-row">
        {days.map(([day, value, tone]) => (
          <div key={day}>
            <small>{day}</small>
            <span className={`day-dot ${tone}`}>{value}</span>
          </div>
        ))}
      </div>
      <div className="day-legend">
        <span>
          <i className="dot green" />
          Win
        </span>
        <span>
          <i className="dot red" />
          Loss
        </span>
        <span>
          <i className="dot gray" />
          Breakeven
        </span>
        <span>
          <i className="dot empty" />
          No Trade
        </span>
      </div>
    </Card>
  );
}

function JournalPreview() {
  return (
    <Card
      title={
        <>
          <span>Journal Preview</span>
          <a className="card-link">View Journal</a>
        </>
      }
      className="journal-preview"
    >
      {journalPreview.map((entry) => (
        <div className="journal-preview-entry" key={entry.day}>
          <div className="journal-date">
            <small>{entry.month}</small>
            <b>{entry.day}</b>
            <small>2024</small>
          </div>
          <div className="journal-copy">
            <b>{entry.title}</b>
            <small>{entry.copy}</small>
            <div>
              <span className="chip">{entry.tags[0]}</span>{" "}
              <span className="chip">{entry.tags[1]}</span>
            </div>
          </div>
          <div className="journal-meta">
            <span>⋮</span>
            <small>{entry.time}</small>
          </div>
        </div>
      ))}
      <a className="card-link bottom-link">Go to Journal　→</a>
    </Card>
  );
}

function GoalsOverview() {
  return (
    <Card title="Goals Overview" className="goals-overview">
      {dashboardGoals.map((goal) => (
        <div className="goal-overview-row" key={goal.title}>
          <span className="goal-overview-icon">{goal.icon}</span>
          <div>
            <b>{goal.title}</b>
            <small>{goal.subtitle}</small>
            <div className="goal-status">
              <span>{goal.percentage}</span>
              <div className="bar">
                <i className={goal.tone} style={{ width: goal.percentage }} />
              </div>
            </div>
          </div>
          <strong>{goal.status}</strong>
        </div>
      ))}
    </Card>
  );
}

function DailyFocus() {
  return (
    <div className="bottom-note">
      <b>💡 Daily Focus</b>
      <br />
      Focus on high-quality setups and protecting your capital. Consistency is
      the key.
    </div>
  );
}

export default function Dashboard() {
  return (
    <>
      <PageHeader
        title="Good morning, John! 👋"
        sub="Here's how your trading journey looks today."
      >
        <Button>▣ May 12 – May 18, 2024⌄</Button>
        <Button>☷ Customize Dashboard</Button>
      </PageHeader>
      <Stats />
      <div className="dashboard-row dashboard-top">
        <PerformanceOverview />
        <TradesBreakdown />
        <RecentTrades />
      </div>
      <div className="dashboard-row dashboard-bottom">
        <StreakConsistency />
        <JournalPreview />
        <GoalsOverview />
      </div>
      <DailyFocus />
    </>
  );
}
