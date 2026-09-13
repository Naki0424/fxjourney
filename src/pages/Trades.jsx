import React, { useCallback, useEffect, useMemo, useState } from "react";
import Button from "../components/common/Button";
import Card from "../components/common/Card";
import PageHeader from "../components/common/PageHeader";
import { useApplication } from "../context/ApplicationContext";
import { navigate } from "../lib/navigation";
import { tradeService } from "../services/tradeService";
import {
  displayOutcome,
  formatDateTime,
  formatDuration,
  formatMoneyMinor,
  outcomeTone,
  plannedRiskReward,
} from "../utils/tradeData";

function tradeErrorMessage(error, fallback) {
  if (error?.status === 409) return "This trade changed elsewhere. Refresh and try again.";
  return error?.message || fallback;
}

function sumMoney(trades, field) {
  const values = trades.map((trade) => trade[field]).filter((value) => value !== null && value !== undefined);
  if (!values.length || values.length !== trades.length) return null;
  return values.reduce((total, value) => total + BigInt(value), 0n).toString();
}

function TradeSummaryPanel({ trades, account }) {
  const closedTrades = trades.filter((trade) => trade.status === "CLOSED");
  const wins = closedTrades.filter((trade) => trade.outcome === "WIN").length;
  const losses = closedTrades.filter((trade) => trade.outcome === "LOSS").length;
  const totalPnl = sumMoney(trades, "pnlAmountMinor");
  const winningPnl = closedTrades
    .filter((trade) => trade.pnlAmountMinor !== null && Number(trade.pnlAmountMinor) > 0)
    .reduce((total, trade) => total + BigInt(trade.pnlAmountMinor), 0n);
  const losingPnl = closedTrades
    .filter((trade) => trade.pnlAmountMinor !== null && Number(trade.pnlAmountMinor) < 0)
    .reduce((total, trade) => total + BigInt(trade.pnlAmountMinor), 0n);
  const hasCompletePnl = closedTrades.length > 0 && closedTrades.every((trade) => trade.pnlAmountMinor !== null);
  const profitFactor = hasCompletePnl
    ? losingPnl < 0n
      ? (Number(winningPnl) / Math.abs(Number(losingPnl))).toFixed(2)
      : winningPnl > 0n ? "∞" : "N/A"
    : "N/A";
  const expectancy = hasCompletePnl && closedTrades.length
    ? (winningPnl + losingPnl) / BigInt(closedTrades.length)
    : null;
  const currencyCode = account?.currencyCode || "USD";
  const minorDigits = account?.currencyMinorDigits ?? 2;
  const summary = [
    ["Total Trades", String(trades.length), ""],
    ["Win Rate", closedTrades.length ? `${((wins / closedTrades.length) * 100).toFixed(2)}%` : "N/A", `${wins}W / ${losses}L`],
    ["Total P/L", formatMoneyMinor(totalPnl, currencyCode, minorDigits, { signed: true }), ""],
    ["Profit Factor", profitFactor, ""],
    ["Expectancy", expectancy === null ? "N/A" : formatMoneyMinor(expectancy.toString(), currencyCode, minorDigits, { signed: true }), ""],
  ];

  return (
    <Card className="trade-summary-panel">
      <div className="trade-summary-items">
        {summary.map(([label, value, sub], index) => (
          <div className="trade-summary-item" key={label}>
            <span className={`summary-icon icon-${index}`}>{["↗", "⌁", "$", "♮", "↗"][index]}</span>
            <div>
              <small>{label}</small>
              <b className={index === 2 || index === 4 ? "positive" : ""}>{value}</b>
              <em>{sub}</em>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function TradeFilters({ filters, instruments, onChange, disabled }) {
  const update = (field, value) => onChange((current) => ({ ...current, [field]: value }));
  const instrumentOptions = Array.from(new Set([filters.instrument, ...instruments].filter(Boolean))).sort();

  return (
    <div className="trade-filter-panel card">
      <div className="trade-filter-row">
        <select className="field" value={filters.instrument} onChange={(event) => update("instrument", event.target.value)} disabled={disabled}>
          <option value="">All Pairs</option>
          {instrumentOptions.map((instrument) => <option key={instrument} value={instrument}>{instrument}</option>)}
        </select>
        <select className="field" value={filters.direction} onChange={(event) => update("direction", event.target.value)} disabled={disabled}>
          <option value="">All Types</option>
          <option value="BUY">Buy</option>
          <option value="SELL">Sell</option>
        </select>
        <select className="field" value={filters.outcome} onChange={(event) => update("outcome", event.target.value)} disabled={disabled}>
          <option value="">All Result</option>
          <option value="WIN">Win</option>
          <option value="LOSS">Loss</option>
          <option value="BREAKEVEN">Breakeven</option>
          <option value="UNRESOLVED">Unresolved</option>
        </select>
        <Button>☷ More Filters</Button>
      </div>
      <div className="trade-view-row">
        <div className="search-box">
          <input className="field" placeholder="Search trades..." value={filters.search} onChange={(event) => update("search", event.target.value)} />
          <span>⌕</span>
        </div>
        <Button primary>▦ Table View</Button>
        <Button>▣ Calendar View</Button>
      </div>
    </div>
  );
}

function TradesTable({ trades, account }) {
  const currencyCode = account?.currencyCode || "USD";
  const minorDigits = account?.currencyMinorDigits ?? 2;
  return (
    <div className="table-wrap">
      <table className="table trades-table">
        <thead>
          <tr>
            {["Date / Time", "Pair", "Type", "Lots", "Result", "P/L", "R:R", "Duration", "Setup / Strategy", "Tags", "Notes", "Actions"].map((column) => <th key={column}>{column}</th>)}
          </tr>
        </thead>
        <tbody>
          {trades.map((trade) => {
            const pnl = trade.pnlAmountMinor;
            const rr = plannedRiskReward(trade);
            const isNegative = pnl !== null && Number(pnl) < 0;
            return (
              <tr key={trade.id} onClick={() => navigate(`/trade-details/${encodeURIComponent(trade.id)}`)}>
                <td>{formatDateTime(trade.openedAt)}</td>
                <td><b>{trade.instrument}</b></td>
                <td><span className={`pill ${trade.direction === "BUY" ? "green" : "red"}`}>{trade.direction === "BUY" ? "Buy" : "Sell"}</span></td>
                <td>{trade.quantityLots || "N/A"}</td>
                <td><span className={`pill ${outcomeTone(trade.outcome)}`}>{displayOutcome(trade.outcome)}</span></td>
                <td className={isNegative ? "negative" : pnl === null ? "" : "positive"}><b>{formatMoneyMinor(pnl, currencyCode, minorDigits, { signed: true })}</b></td>
                <td>{rr === null ? "N/A" : `${rr.toFixed(2)}R`}</td>
                <td>{formatDuration(trade.openedAt, trade.closedAt)}</td>
                <td>{trade.setupType || "N/A"}</td>
                <td><span className="chip">—</span></td>
                <td className="notes-icon">{trade.notes ? "▱" : "—"}</td>
                <td><span className="action-box"><span>◉</span><span>⌁</span><span>⋮</span></span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TradesFooter({ trades, account }) {
  const currencyCode = account?.currencyCode || "USD";
  const minorDigits = account?.currencyMinorDigits ?? 2;
  const totalPnl = sumMoney(trades, "pnlAmountMinor");
  const totalWin = sumMoney(trades.filter((trade) => trade.outcome === "WIN"), "pnlAmountMinor");
  const totalLoss = sumMoney(trades.filter((trade) => trade.outcome === "LOSS"), "pnlAmountMinor");
  const breakeven = sumMoney(trades.filter((trade) => trade.outcome === "BREAKEVEN"), "pnlAmountMinor");
  return (
    <div className="trades-footer">
      <span>Showing {trades.length ? `1 to ${trades.length}` : "0"} of {trades.length} trades</span>
      <div className="footer-summary">
        <span>Total P/L <b className="positive">{formatMoneyMinor(totalPnl, currencyCode, minorDigits, { signed: true })}</b></span>
        <span>Total Win <b className="positive">{formatMoneyMinor(totalWin, currencyCode, minorDigits, { signed: true })}</b></span>
        <span>Total Loss <b className="negative">{formatMoneyMinor(totalLoss, currencyCode, minorDigits, { signed: true })}</b></span>
        <span>Breakeven <b>{formatMoneyMinor(breakeven, currencyCode, minorDigits, { signed: true })}</b></span>
      </div>
      <div className="pagination"><button disabled>‹</button><button className="active">1</button><button disabled>›</button></div>
    </div>
  );
}

function TradeState({ title, message, action }) {
  return <div className="trade-data-state"><h2>{title}</h2><p>{message}</p>{action}</div>;
}

export default function Trades() {
  const { selectedAccount, selectedAccountId } = useApplication();
  const [filters, setFilters] = useState({ instrument: "", direction: "", outcome: "", search: "" });
  const [trades, setTrades] = useState([]);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState(null);

  const loadTrades = useCallback(async () => {
    if (!selectedAccountId) {
      setTrades([]);
      setStatus("ready");
      setError(null);
      return;
    }
    setStatus("loading");
    setError(null);
    try {
      const result = await tradeService.list({
        accountId: selectedAccountId,
        instrument: filters.instrument,
        direction: filters.direction,
        outcome: filters.outcome,
      });
      setTrades(Array.isArray(result?.trades) ? result.trades : []);
      setStatus("ready");
    } catch (requestError) {
      setError(requestError);
      setStatus("error");
    }
  }, [filters.direction, filters.instrument, filters.outcome, selectedAccountId]);

  useEffect(() => {
    loadTrades();
  }, [loadTrades]);

  const visibleTrades = useMemo(() => {
    const query = filters.search.trim().toLowerCase();
    if (!query) return trades;
    return trades.filter((trade) => trade.instrument.toLowerCase().includes(query));
  }, [filters.search, trades]);
  const instruments = useMemo(() => trades.map((trade) => trade.instrument), [trades]);

  return (
    <>
      <PageHeader title="Trades" sub="Track every trade. Review. Learn. Improve.">
        <Button primary onClick={() => navigate("/new-trade")}>＋ New Trade</Button>
        <Button>▣ May 12 – May 18, 2024⌄</Button>
      </PageHeader>
      <div className="trades-control-row">
        <TradeSummaryPanel trades={visibleTrades} account={selectedAccount} />
        <TradeFilters filters={filters} instruments={instruments} onChange={setFilters} disabled={!selectedAccountId || status === "loading"} />
      </div>
      <Card className="trade-table-card">
        {status === "loading" && <TradeState title="Loading trades" message="Reading persisted trades for the selected account." />}
        {status === "error" && <TradeState title="Unable to load trades" message={tradeErrorMessage(error, "The persisted trades could not be loaded.")} action={<Button onClick={loadTrades}>Retry</Button>} />}
        {status === "ready" && !selectedAccountId && <TradeState title="No active account selected" message="Create an account before loading or saving trades." />}
        {status === "ready" && selectedAccountId && !visibleTrades.length && <TradeState title="No trades yet" message="Persisted trades for this account will appear here after you save one." />}
        {status === "ready" && selectedAccountId && visibleTrades.length > 0 && <TradesTable trades={visibleTrades} account={selectedAccount} />}
        {status === "ready" && selectedAccountId && <TradesFooter trades={visibleTrades} account={selectedAccount} />}
      </Card>
    </>
  );
}
