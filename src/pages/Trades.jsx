import React from "react";
import Button from "../components/common/Button";
import Card from "../components/common/Card";
import PageHeader from "../components/common/PageHeader";
import { navigate } from "../lib/navigation";
import { tradeRows } from "../data/mockData";

function TradeSummaryPanel() {
  const summary = [
    ["Total Trades", "24", ""],
    ["Win Rate", "62.50%", "15W / 9L"],
    ["Total P/L", "+$1,250.75", "+12.45%"],
    ["Profit Factor", "2.18", "vs last 7 days +0.35"],
    ["Expectancy", "+$52.11", "vs last 7 days +8.11"],
  ];

  return (
    <Card className="trade-summary-panel">
      <div className="trade-summary-items">
        {summary.map(([label, value, sub], index) => (
          <div className="trade-summary-item" key={label}>
            <span className={`summary-icon icon-${index}`}>
              {["↗", "⌁", "$", "♮", "↗"][index]}
            </span>
            <div>
              <small>{label}</small>
              <b className={index === 2 || index === 4 ? "positive" : ""}>
                {value}
              </b>
              <em>{sub}</em>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function TradeFilters() {
  return (
    <div className="trade-filter-panel card">
      <div className="trade-filter-row">
        <select className="field">
          <option>All Pairs</option>
        </select>
        <select className="field">
          <option>All Types</option>
        </select>
        <select className="field">
          <option>All Result</option>
        </select>
        <Button>☷ More Filters</Button>
      </div>
      <div className="trade-view-row">
        <div className="search-box">
          <input className="field" placeholder="Search trades..." />
          <span>⌕</span>
        </div>
        <Button primary>▦ Table View</Button>
        <Button>▣ Calendar View</Button>
      </div>
    </div>
  );
}

function TradesTable() {
  return (
    <div className="table-wrap">
      <table className="table trades-table">
        <thead>
          <tr>
            {[
              "Date / Time",
              "Pair",
              "Type",
              "Lots",
              "Result",
              "P/L",
              "R:R",
              "Duration",
              "Setup / Strategy",
              "Tags",
              "Notes",
              "Actions",
            ].map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tradeRows.map((trade) => (
            <tr
              key={`${trade.date}-${trade.pair}`}
              onClick={() => navigate("/trade-details")}
            >
              <td>
                {trade.date}
                <br />
                <small className="muted">{trade.time}</small>
              </td>
              <td>
                <b>{trade.pair}</b>
              </td>
              <td>
                <span
                  className={`pill ${trade.type === "Buy" ? "green" : "red"}`}
                >
                  {trade.type}
                </span>
              </td>
              <td>{trade.lots}</td>
              <td>
                <span
                  className={`pill ${trade.result === "Win" ? "green" : trade.result === "Loss" ? "red" : "gray"}`}
                >
                  {trade.result}
                </span>
              </td>
              <td
                className={trade.pnl.startsWith("-") ? "negative" : "positive"}
              >
                <b>{trade.pnl}</b>
              </td>
              <td>{trade.rr}</td>
              <td>{trade.duration}</td>
              <td>{trade.setup}</td>
              <td>
                <span className="chip">{trade.tags[0]}</span>
              </td>
              <td className="notes-icon">▱</td>
              <td>
                <span className="action-box">
                  <span>◉</span>
                  <span>⌁</span>
                  <span>⋮</span>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TradesFooter() {
  return (
    <div className="trades-footer">
      <span>Showing 1 to 8 of 24 trades</span>
      <div className="footer-summary">
        <span>
          Total P/L <b className="positive">+$1,250.75</b>
        </span>
        <span>
          Total Win <b className="positive">+$1,879.30</b>
        </span>
        <span>
          Total Loss <b className="negative">-$628.55</b>
        </span>
        <span>
          Breakeven <b>$0.00</b>
        </span>
      </div>
      <div className="pagination">
        <button>‹</button>
        <button className="active">1</button>
        <button>2</button>
        <button>3</button>
        <button>›</button>
      </div>
    </div>
  );
}

export default function Trades() {
  return (
    <>
      <PageHeader
        title="Trades"
        sub="Track every trade. Review. Learn. Improve."
      >
        <Button primary onClick={() => navigate("/new-trade")}>
          ＋ New Trade
        </Button>
        <Button>▣ May 12 – May 18, 2024⌄</Button>
      </PageHeader>
      <div className="trades-control-row">
        <TradeSummaryPanel />
        <TradeFilters />
      </div>
      <Card className="trade-table-card">
        <TradesTable />
        <TradesFooter />
      </Card>
    </>
  );
}
