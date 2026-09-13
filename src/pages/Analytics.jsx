import React, { useState } from "react";
import Button from "../components/common/Button";
import Card from "../components/common/Card";
import PageHeader from "../components/common/PageHeader";
import {
  analyticsInsights,
  analyticsSummary,
  correlationMatrix,
  dayAnalytics,
  emotionAnalytics,
  equityCurveData,
  monthlyPerformance,
  pairAnalytics,
  performanceOverview,
  pnlDistribution,
  setupAnalytics,
  timeframeAnalytics,
} from "../data/mockData";

const detailTabs = [
  "By Setup",
  "By Pair",
  "By Timeframe",
  "By Session",
  "By Day",
  "By Direction",
];

function InfoIcon() {
  return <span className="analytics-info" title="Mock analytics data">i</span>;
}

function Sparkline({ values, tone = "blue" }) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 120;
      const y = 28 - ((value - min) / range) * 22;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg className={`sparkline sparkline-${tone}`} viewBox="0 0 120 32" aria-hidden="true">
      <polyline points={points} fill="none" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function AnalyticsKpis() {
  return (
    <section className="analytics-kpis" aria-label="Analytics key performance indicators">
      {analyticsSummary.map((item) => (
        <article className={`analytics-kpi analytics-kpi-${item.tone}`} key={item.label}>
          <span className="analytics-kpi-label">{item.label}</span>
          <strong>{item.value}</strong>
          <small>{item.comparison}</small>
          <Sparkline values={item.sparkline} tone={item.tone} />
        </article>
      ))}
    </section>
  );
}

function chartPath(values, width, height, min, max) {
  const range = max - min || 1;
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function EquityCurve() {
  const values = equityCurveData.map((point) => point.value);
  const width = 500;
  const height = 190;
  const min = -1000;
  const max = 4000;
  const equityPath = chartPath(values, width, height, min, max);
  const areaPath = `${equityPath} L ${width} ${height} L 0 ${height} Z`;
  const trendPath = `M 0 ${height - ((-250 - min) / (max - min)) * height} L ${width} ${height - ((3000 - min) / (max - min)) * height}`;

  return (
    <Card className="equity-card">
      <div className="analytics-chart-header">
        <h2>
          Equity Curve <InfoIcon />
        </h2>
        <div className="analytics-chart-actions">
          <span className="chart-legend equity-legend">Equity</span>
          <span className="chart-legend trend-legend">Trendline</span>
          <select className="field" defaultValue="By Date" aria-label="Equity curve grouping">
            <option>By Date</option>
            <option>By Week</option>
          </select>
        </div>
      </div>
      <div className="equity-chart-wrap">
        <div className="equity-y-labels">
          {["$4,000", "$3,000", "$2,000", "$1,000", "$0", "-$1,000"].map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
        <div className="equity-plot">
          <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-label="Equity curve chart">
            {[0, 1, 2, 3, 4, 5].map((line) => (
              <line
                key={line}
                x1="0"
                x2={width}
                y1={(line / 5) * height}
                y2={(line / 5) * height}
                className="chart-grid-line"
              />
            ))}
            <path d={areaPath} className="equity-area" />
            <path d={trendPath} className="equity-trend" />
            <path d={equityPath} className="equity-line" />
            <line x1="294" x2="294" y1="68" y2={height} className="equity-highlight-line" />
            <circle cx="294" cy="68" r="4" className="equity-highlight-point" />
          </svg>
          <div className="equity-tooltip">
            <strong>May 11, 2024</strong>
            <span>Equity: $1,658.23</span>
          </div>
          <div className="equity-x-labels">
            {["May 1", "May 4", "May 7", "May 10", "May 13", "May 16", "May 18"].map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

const distributionStats = [
  { label: "Best Trade", value: "+4.35R", tone: "green" },
  { label: "Worst Trade", value: "-2.21R", tone: "red" },
  { label: "Average Trade", value: "+0.72R", tone: "blue" },
  { label: "Median Trade", value: "+0.45R", tone: "purple" },
];

function PnlDistribution() {
  return (
    <Card className="distribution-card">
      <div className="analytics-chart-header">
        <h2>
          P&amp;L Distribution (R) <InfoIcon />
        </h2>
        <select className="field" defaultValue="By R Multiple" aria-label="P and L grouping">
          <option>By R Multiple</option>
          <option>By Trade</option>
        </select>
      </div>
      <div className="pnl-chart-wrap">
        <div className="pnl-y-labels">
          {["16", "12", "8", "4", "0"].map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
        <div className="pnl-chart">
          <div className="pnl-grid-lines">
            {[0, 1, 2, 3, 4].map((line) => <i key={line} />)}
          </div>
          <div className="pnl-bars">
            {pnlDistribution.map((item, index) => (
              <span className={`pnl-bar-${item.tone}`} key={`${item.label}-${index}`}>
                <i style={{ height: `${(item.value / 13) * 100}%` }} />
              </span>
            ))}
          </div>
          <div className="pnl-x-labels">
            {pnlDistribution.map((item, index) => (
              <span key={`${item.label}-label-${index}`}>{item.label}</span>
            ))}
          </div>
        </div>
      </div>
      <div className="distribution-stats">
        {distributionStats.map((stat) => (
          <div className={`distribution-stat ${stat.tone}`} key={stat.label}>
            <span>{stat.label}</span>
            <strong>{stat.value}</strong>
          </div>
        ))}
      </div>
    </Card>
  );
}

function PerformanceOverview() {
  return (
    <Card className="performance-overview">
      <h2>Performance Overview</h2>
      <div className="overview-list">
        {performanceOverview.map((metric) => (
          <div className="overview-row" key={metric.label}>
            <span>{metric.label}</span>
            <div className="overview-bar">
              <i className={metric.tone} style={{ width: `${metric.width}%` }} />
            </div>
            <strong className={`analytics-value-${metric.tone}`}>{metric.value}</strong>
          </div>
        ))}
      </div>
    </Card>
  );
}

function TradesBreakdown() {
  return (
    <Card className="trades-breakdown">
      <h2>Trades Breakdown</h2>
      <div className="breakdown-main">
        <div className="trade-donut">
          <div>
            <strong>48</strong>
            <span>Total Trades</span>
          </div>
        </div>
        <div className="breakdown-legend">
          <span><i className="legend-swatch won" />Won <b>30</b> (62.5%)</span>
          <span><i className="legend-swatch lost" />Lost <b>16</b> (33.3%)</span>
          <span><i className="legend-swatch breakeven" />Breakeven <b>2</b> (4.2%)</span>
        </div>
      </div>
      <div className="direction-stats">
        <div><span className="direction-icon long">↗</span><span>Long Trades<small>28 (58.3%)</small></span></div>
        <div><span className="direction-icon short">↘</span><span>Short Trades<small>20 (41.7%)</small></span></div>
      </div>
    </Card>
  );
}

function MonthlyPerformance() {
  const maxValue = Math.max(...monthlyPerformance.map((item) => Math.abs(item.value)));

  return (
    <Card className="monthly-performance">
      <div className="analytics-card-heading">
        <h2>Monthly Performance</h2>
        <select className="field" defaultValue="This Year" aria-label="Monthly performance period">
          <option>This Year</option>
          <option>Last Year</option>
        </select>
      </div>
      <div className="monthly-chart-wrap">
        <div className="monthly-y-labels"><span>$6K</span><span>$4K</span><span>$2K</span><span>$0</span><span>-$2K</span><span>-$4K</span></div>
        <div className="monthly-chart">
          <div className="monthly-zero-line" />
          {monthlyPerformance.map((item) => (
            <div className="monthly-column" key={item.month}>
              <div className="monthly-bar-track">
                <i
                  className={item.value >= 0 ? "positive-bar" : "negative-bar"}
                  style={{ height: `${Math.max((Math.abs(item.value) / maxValue) * 45, 8)}px` }}
                />
              </div>
              <span>{item.month}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="monthly-notes">
        <span>Best Month <b>Apr 2024</b> <strong className="positive">+$3,248.60</strong></span>
        <span>Worst Month <b>Mar 2024</b> <strong className="negative">-$1,123.45</strong></span>
      </div>
    </Card>
  );
}

function valueTone(value) {
  return String(value).startsWith("-") ? "negative" : "positive";
}

function AnalyticsTable({ title, headers, rows, pair = false, timeframe = false, footer }) {
  return (
    <section className="analytics-table-section">
      <h3>{title}</h3>
      <div className="analytics-table-wrap">
        <table className="analytics-table">
          <thead>
            <tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name}>
                <th>
                  {pair && <span className="pair-dot">{row.icon}</span>}
                  {row.name}
                </th>
                <td>{row.trades}</td>
                <td>{row.winRate}</td>
                {!timeframe && <td className={valueTone(row.pnl)}>{row.pnl}</td>}
                <td className={valueTone(row.expectancy)}>{row.expectancy}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="analytics-link">{footer} →</button>
    </section>
  );
}

function DetailedAnalytics() {
  const [activeTab, setActiveTab] = useState("By Setup");

  return (
    <Card className="detailed-analytics">
      <div className="analytics-tabs">
        {detailTabs.map((tab) => (
          <button className={activeTab === tab ? "active" : ""} key={tab} onClick={() => setActiveTab(tab)}>
            {tab}
          </button>
        ))}
      </div>
      <div className="analytics-tables-grid">
        <AnalyticsTable
          footer="View all setups"
          headers={["Setup", "Trades", "Win Rate", "Net P&L", "Expectancy (R)"]}
          rows={setupAnalytics}
          title="Top Setups"
        />
        <AnalyticsTable
          footer="View all pairs"
          headers={["Pair", "Trades", "Win Rate", "Net P&L", "Expectancy (R)"]}
          pair
          rows={pairAnalytics}
          title="By Currency Pair"
        />
        <AnalyticsTable
          footer="View all timeframes"
          headers={["Timeframe", "Trades", "Win Rate", "Expectancy (R)"]}
          rows={timeframeAnalytics}
          timeframe
          title="By Timeframe"
        />
      </div>
    </Card>
  );
}

function CorrelationMatrix() {
  const { labels, rows } = correlationMatrix;
  return (
    <Card className="correlation-card">
      <h2>Performance Correlation <InfoIcon /></h2>
      <div className="correlation-wrap">
        <table className="correlation-table">
          <thead>
            <tr><th />{labels.map((label) => <th key={label}>{label}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={labels[rowIndex]}>
                <th>{labels[rowIndex]}</th>
                {row.map((value, columnIndex) => (
                  <td
                    key={`${rowIndex}-${columnIndex}`}
                    style={{ backgroundColor: `rgba(21, 148, 71, ${0.08 + value * 0.22})` }}
                  >
                    {value.toFixed(2)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="correlation-scale">
        <div><i /><i /><i /><i /><i /></div>
        <span>-1</span><span>-0.5</span><span>0</span><span>0.5</span><span>1</span>
      </div>
    </Card>
  );
}

function SmallAnalyticsTable({ title, rows, emotion = false, footer }) {
  return (
    <Card className="small-analytics-card">
      <h2>{title} <InfoIcon /></h2>
      <div className="small-table-wrap">
        <table className="small-analytics-table">
          <thead><tr><th>{emotion ? "Emotion" : "Day"}</th><th>Trades</th><th>Win Rate</th><th>Expectancy (R)</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name}>
                <th>{emotion && <span className={`emotion-dot ${row.tone}`}>{row.icon}</span>}{row.name}</th>
                <td>{row.trades}</td>
                <td>{row.winRate}</td>
                <td className={valueTone(row.expectancy)}>{row.expectancy}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="analytics-link">{footer} →</button>
    </Card>
  );
}

function Insights() {
  return (
    <Card className="insights-card">
      <div className="insights-heading">
        <div>
          <h2><span className="insights-icon">▥</span> Insights <span className="beta-chip">BETA</span></h2>
          <p>Based on your trading data from May 1 – May 18, 2024</p>
        </div>
      </div>
      <div className="insights-grid">
        {analyticsInsights.map((insight) => (
          <article className={`insight-item insight-${insight.tone}`} key={insight.title}>
            <span className="insight-item-icon">{insight.icon}</span>
            <div>
              <h3>{insight.title}</h3>
              <p>{insight.copy}</p>
              <button>View details →</button>
            </div>
          </article>
        ))}
        <article className="overall-score">
          <span>Overall Score</span>
          <strong>7.4 <small>/ 10</small></strong>
          <p>Good performance! Keep focusing on consistency and execution.</p>
          <Sparkline values={[10, 14, 12, 18, 15, 21, 18, 27, 24, 33]} />
        </article>
      </div>
    </Card>
  );
}

export default function Analytics() {
  return (
    <div className="analytics-page">
      <PageHeader title="▥ Analytics" sub="Discover insights, track performance, and improve your edge.">
        <Button>▣ May 1 – May 18, 2024⌄</Button>
        <Button>Compare</Button>
        <Button>☷ Filters</Button>
      </PageHeader>

      <AnalyticsKpis />

      <div className="analytics-chart-grid">
        <EquityCurve />
        <PnlDistribution />
      </div>

      <div className="analytics-summary-grid">
        <PerformanceOverview />
        <TradesBreakdown />
        <MonthlyPerformance />
      </div>

      <DetailedAnalytics />

      <div className="analytics-detail-grid">
        <CorrelationMatrix />
        <SmallAnalyticsTable emotion footer="View full emotions analytics" rows={emotionAnalytics} title="Emotions Impact" />
        <SmallAnalyticsTable footer="View full day analytics" rows={dayAnalytics} title="Best Performing Days" />
      </div>

      <Insights />
      <p className="analytics-footer-note">Analytics update in real-time as you add new trades.</p>
    </div>
  );
}
