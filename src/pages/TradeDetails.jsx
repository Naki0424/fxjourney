import React, { useCallback, useEffect, useMemo, useState } from "react";
import Button from "../components/common/Button";
import Card from "../components/common/Card";
import { useApplication } from "../context/ApplicationContext";
import { navigate } from "../lib/navigation";
import { tradeService } from "../services/tradeService";
import {
  plannedRiskReward,
  toTradeViewModel,
} from "../utils/tradeData";

function tradeIdFromLocation() {
  const segments = window.location.pathname.split("/").filter(Boolean);
  if (segments[0] !== "trade-details") return null;
  return decodeURIComponent(segments[1] || new URLSearchParams(window.location.search).get("id") || "");
}

function detailErrorMessage(error) {
  if (error?.status === 404) return "This trade no longer exists or is not available for this account.";
  if (error?.status === 409) return "This trade changed elsewhere. Reload it before making changes.";
  return error?.message || "The persisted trade could not be loaded.";
}

function TradeDetailsHeader({ trade, onDelete, deleting }) {
  return (
    <>
      <div className="back-link" onClick={() => navigate("/trades")}>← Back to Trades</div>
      <div className="detail-header">
        <div>
          <h1>Trade Details <span className="pill green">{trade.outcome}</span></h1>
          <p>Trade ID: {trade.id}　▣　{trade.openedLabel}　<span className="pill">{trade.session}</span></p>
        </div>
        <div className="actions">
          <Button onClick={() => navigate(`/new-trade?edit=${encodeURIComponent(trade.id)}`)}>✎ Edit Trade</Button>
          <Button>▣ Duplicate</Button>
          <Button danger onClick={onDelete} disabled={deleting}>▥ {deleting ? "Deleting..." : "Delete"}</Button>
          <button className="icon-btn">‹</button>
          <button className="icon-btn">›</button>
        </div>
      </div>
    </>
  );
}

function TradeSummaryStrip({ trade }) {
  const values = [
    ["Type", trade.type, "green"],
    ["Lots", trade.lots],
    ["Entry Price", trade.entry],
    ["Exit Price", trade.exit],
    ["P/L", trade.pnl, trade.pnl.startsWith("-") ? "negative" : "positive"],
    ["R:R", trade.rr],
    ["Duration", trade.duration],
    ["Status", trade.status, trade.status === "Closed" ? "green" : ""],
  ];
  return (
    <Card className="trade-summary-strip">
      <div className="detail-summary-grid">
        <div className="pair-summary"><small>Pair</small><strong>🌐　{trade.pair}</strong><span>{trade.pairName}</span></div>
        {values.map(([label, value, tone]) => (
          <div className="detail-summary-item" key={label}>
            <small>{label}</small>
            <b className={tone || ""}>{value}</b>
            {label === "P/L" && <span className="muted">{trade.pnlPercent}</span>}
          </div>
        ))}
      </div>
    </Card>
  );
}

function ChartScreenshot({ trade }) {
  return (
    <Card title={<><span>Chart Screenshot　ⓘ</span><span className="chart-tools"><button>⌕</button><button>⌕</button><button>⛶</button><button>⇩</button></span></>}>
      <div className="real-chart">
        <div className="chart-label">{trade.pair} · {trade.timeframe}<span>● Persisted trade data</span></div>
        <div className="chart-grid-lines" />
        <div className="candles">{Array.from({ length: 54 }, (_, index) => <i key={index} style={{ height: `${20 + ((index * 17) % 70)}%`, left: `${index * 1.75}%` }} className={index % 5 === 0 ? "red" : ""} />)}</div>
        <div className="trade-line entry-line">Entry</div>
        <div className="trade-line tp-line">Take Profit</div>
        <div className="trade-line sl-line">Stop Loss</div>
        <div className="price-label entry-price">{trade.entry}</div>
        <div className="price-label tp-price">{trade.takeProfit || "N/A"}</div>
        <div className="price-label sl-price">{trade.stopLoss || "N/A"}</div>
      </div>
    </Card>
  );
}

function TradePlanNarrative({ trade }) {
  return (
    <Card title={<><span>Trade Plan</span><span>✎</span></>}>
      <h3>Reason for the Trade</h3><p>{trade.planReason}</p>
      <h3>What I Expected</h3><p>{trade.expected}</p>
      <h3>Invalidation / Stop Reason</h3><p>{trade.invalidation}</p>
    </Card>
  );
}

function Execution({ trade }) {
  const rows = [
    ["Entry Type", "Market Order"],
    ["Entry Time", trade.openedLabel],
    ["Stop Loss", trade.stopLoss, "negative"],
    ["Take Profit", trade.takeProfit || "N/A", "positive"],
    ["Risk (pips)", "N/A"],
    ["Reward (pips)", "N/A"],
  ];
  return <Card title={<><span>Execution</span><span>✎</span></>}><div className="detail-rows">{rows.map(([label, value, tone]) => <div key={label}><span>{label}</span><b className={tone || ""}>{value}</b></div>)}</div></Card>;
}

function Emotions({ trade }) {
  return (
    <Card title={<><span>Emotions</span><span>✎</span></>}>
      <p><b>Before Trade</b><br /><span className="positive">☺　{trade.emotionBefore || "N/A"}</span></p>
      <p><b>During Trade</b><br />🟠　{trade.emotionDuring || "N/A"}</p>
      <p><b>After Trade</b><br /><span className="positive">☺　{trade.emotionAfter || "N/A"}</span></p>
      <p><b>Notes</b><br /><span className="muted">{trade.notes || "N/A"}</span></p>
    </Card>
  );
}

function TradeResult({ trade }) {
  const rr = plannedRiskReward(trade);
  return (
    <Card title="Trade Result">
      <div className="result-layout">
        <div className="detail-rows">
          {[["Result", trade.outcome, "positive"], ["P/L", trade.pnl, trade.pnl.startsWith("-") ? "negative" : "positive"], ["P/L (%)", trade.pnlPercent], ["R:R", trade.rr], ["Account Risk", trade.riskPercent ? `${trade.riskPercent}%` : "N/A"], ["Return on Risk", trade.rr]].map(([label, value, tone]) => <div key={label}><span>{label}</span><b className={tone || ""}>{value}</b></div>)}
        </div>
        <div className="risk-visual">
          <div className="risk-ring"><b>{rr === null ? "N/A" : `${rr.toFixed(2)}R`}</b><small>Return on Risk</small></div>
          <span className="positive">●　Reward <b>N/A</b></span>
          <span className="negative">●　Risk <b>{trade.riskAmount}</b></span>
        </div>
      </div>
    </Card>
  );
}

function TradeMetadata({ trade }) {
  const rows = [["Setup / Strategy", trade.setup], ["Bias", trade.bias], ["Timeframe", trade.timeframe], ["Session", trade.session], ["Market Condition", trade.market], ["Confluence", trade.confluence]];
  return (
    <Card title={<><span>Trade Plan</span><span>✎</span></>}>
      <div className="detail-rows">{rows.map(([label, value]) => <div key={label}><span>{label}</span><b>{value}</b></div>)}</div>
      <h3>Tags</h3>
      <div className="chips">{trade.tags.length ? trade.tags.map((tag) => <span className="chip" key={tag}>{tag}</span>) : <span className="muted">No persisted tags</span>}</div>
    </Card>
  );
}

function Attachments() {
  return <Card title="Attachments"><div className="attachment-grid"><p className="muted">No persisted attachments.</p></div></Card>;
}

function TradeReview({ trade }) {
  return (
    <div className="review-row">
      <Card className="review-card">
        <div><h2>Lessons Learned　ⓘ</h2><p>{trade.lessonsLearned}</p></div>
        <div className="review-divider" />
        <div><h2>What I’ll Do Differently Next Time　ⓘ</h2><p>{trade.improvements}</p></div>
      </Card>
      <Card className="rating-card"><h2>Rating</h2><div className="stars">{trade.rating ? "★★★★★" : "☆☆☆☆☆"}</div><b>{trade.rating ? `${trade.rating} / 5` : "Not rated"}</b></Card>
    </div>
  );
}

function DetailState({ title, message, action }) {
  return <div className="trade-data-state"><h2>{title}</h2><p>{message}</p>{action}</div>;
}

export default function TradeDetails() {
  const { accounts } = useApplication();
  const tradeId = useMemo(() => tradeIdFromLocation(), []);
  const [trade, setTrade] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const loadTrade = useCallback(async () => {
    if (!tradeId) {
      setStatus("error");
      setError({ status: 404, message: "A persisted trade ID is required." });
      return;
    }
    setStatus("loading");
    setError(null);
    try {
      const result = await tradeService.get(tradeId);
      setTrade(result?.trade || null);
      setStatus(result?.trade ? "ready" : "error");
      if (!result?.trade) setError({ status: 404, message: "Trade not found." });
    } catch (requestError) {
      setError(requestError);
      setStatus("error");
    }
  }, [tradeId]);

  useEffect(() => { loadTrade(); }, [loadTrade]);

  if (status === "loading") return <DetailState title="Loading trade" message="Reading the persisted trade details." />;
  if (status === "error" || !trade) return <><div className="back-link" onClick={() => navigate("/trades")}>← Back to Trades</div><DetailState title={error?.status === 404 ? "Trade not found" : "Unable to load trade"} message={detailErrorMessage(error)} action={<Button onClick={loadTrade}>Retry</Button>} /></>;

  const account = accounts.find((item) => item.id === trade.accountId);
  const view = toTradeViewModel(trade, account);
  const handleDelete = async () => {
    if (!window.confirm("Delete this trade? It will be archived from the active trade list.")) return;
    setDeleting(true);
    try {
      await tradeService.remove(trade.id, trade.version);
      navigate("/trades");
    } catch (requestError) {
      setError(requestError);
      setDeleting(false);
    }
  };

  return (
    <>
      <TradeDetailsHeader trade={view} onDelete={handleDelete} deleting={deleting} />
      <TradeSummaryStrip trade={view} />
      <div className="details-main-grid">
        <div className="details-left"><ChartScreenshot trade={view} /><div className="detail-trio"><TradePlanNarrative trade={view} /><Execution trade={view} /><Emotions trade={view} /></div></div>
        <div className="details-right"><TradeResult trade={view} /><TradeMetadata trade={view} /><Attachments /></div>
      </div>
      <TradeReview trade={view} />
      {error && <div className="trade-form-message error" role="alert">{detailErrorMessage(error)} <Button onClick={loadTrade}>Reload</Button></div>}
    </>
  );
}
