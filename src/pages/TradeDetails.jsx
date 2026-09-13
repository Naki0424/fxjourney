import React from "react";
import Button from "../components/common/Button";
import Card from "../components/common/Card";
import { tradeDetails } from "../data/mockData";
import { navigate } from "../lib/navigation";

function TradeDetailsHeader({ trade }) {
  return (
    <>
      <div className="back-link" onClick={() => navigate("/trades")}>
        ← Back to Trades
      </div>
      <div className="detail-header">
        <div>
          <h1>
            Trade Details <span className="pill green">Win</span>
          </h1>
          <p>
            Trade ID: {trade.id}　▣　May 18, 2024 at 10:20 AM　{" "}
            <span className="pill">{trade.session}</span>
          </p>
        </div>
        <div className="actions">
          <Button>✎ Edit Trade</Button>
          <Button>▣ Duplicate</Button>
          <Button danger>▥ Delete</Button>
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
    ["P/L", trade.pnl, "positive"],
    ["R:R", trade.rr],
    ["Duration", trade.duration],
    ["Status", trade.status, "green"],
  ];
  return (
    <Card className="trade-summary-strip">
      <div className="detail-summary-grid">
        <div className="pair-summary">
          <small>Pair</small>
          <strong>🌐　{trade.pair}</strong>
          <span>{trade.pairName}</span>
        </div>
        {values.map(([label, value, tone]) => (
          <div className="detail-summary-item" key={label}>
            <small>{label}</small>
            <b className={tone || ""}>{value}</b>
            {label === "P/L" && (
              <span className="positive">{trade.pnlPercent}</span>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

function ChartScreenshot() {
  return (
    <Card
      title={
        <>
          <span>Chart Screenshot　ⓘ</span>
          <span className="chart-tools">
            <button>⌕</button>
            <button>⌕</button>
            <button>⛶</button>
            <button>⇩</button>
          </span>
        </>
      }
    >
      <div className="real-chart">
        <div className="chart-label">
          EURUSD · 15 · OANDA　
          <span>● 01.08490 H1.08530 L1.08480 C1.08524</span>
        </div>
        <div className="chart-grid-lines" />
        <div className="candles">
          {Array.from({ length: 54 }, (_, index) => (
            <i
              key={index}
              style={{
                height: `${20 + ((index * 17) % 70)}%`,
                left: `${index * 1.75}%`,
              }}
              className={index % 5 === 0 ? "red" : ""}
            />
          ))}
        </div>
        <div className="trade-line entry-line">Entry</div>
        <div className="trade-line tp-line">Take Profit</div>
        <div className="trade-line sl-line">Stop Loss</div>
        <div className="price-label entry-price">1.08520</div>
        <div className="price-label tp-price">1.08761</div>
        <div className="price-label sl-price">1.08370</div>
      </div>
    </Card>
  );
}

function TradePlanNarrative() {
  return (
    <Card
      title={
        <>
          <span>Trade Plan</span>
          <span>✎</span>
        </>
      }
    >
      <h3>Reason for the Trade</h3>
      <p>
        Price broke the key resistance with strong bullish candle and high
        volume. Retest confirmed.
      </p>
      <h3>What I Expected</h3>
      <p>Continuation to the upside targeting the next resistance level.</p>
      <h3>Invalidation / Stop Reason</h3>
      <p>Price closes back below the previous swing low.</p>
    </Card>
  );
}

function Execution() {
  const rows = [
    ["Entry Type", "Market Order"],
    ["Entry Time", "May 18, 2024 10:20 AM"],
    ["Stop Loss", "1.08370 (15 pips)", "negative"],
    ["Take Profit", "1.08761 (24.1 pips)", "positive"],
    ["Risk (pips)", "15"],
    ["Reward (pips)", "24.1"],
  ];
  return (
    <Card
      title={
        <>
          <span>Execution</span>
          <span>✎</span>
        </>
      }
    >
      <div className="detail-rows">
        {rows.map(([label, value, tone]) => (
          <div key={label}>
            <span>{label}</span>
            <b className={tone || ""}>{value}</b>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Emotions() {
  return (
    <Card
      title={
        <>
          <span>Emotions</span>
          <span>✎</span>
        </>
      }
    >
      <p>
        <b>Before Trade</b>
        <br />
        <span className="positive">☺　Confident</span>
      </p>
      <p>
        <b>During Trade</b>
        <br />
        🟠　Patient
      </p>
      <p>
        <b>After Trade</b>
        <br />
        <span className="positive">☺　Happy</span>
      </p>
      <p>
        <b>Notes</b>
        <br />
        <span className="muted">
          Followed my plan perfectly. Great patience!
        </span>
      </p>
    </Card>
  );
}

function TradeResult() {
  const rows = [
    ["Result", "Win", "positive"],
    ["P/L", "+$120.50", "positive"],
    ["P/L (%)", "+1.21%", "positive"],
    ["R:R", "1.50R"],
    ["Account Risk", "0.50%"],
    ["Return on Risk", "1.50R"],
  ];
  return (
    <Card title="Trade Result">
      <div className="result-layout">
        <div className="detail-rows">
          {rows.map(([label, value, tone]) => (
            <div key={label}>
              <span>{label}</span>
              <b className={tone || ""}>{value}</b>
            </div>
          ))}
        </div>
        <div className="risk-visual">
          <div className="risk-ring">
            <b>1.50R</b>
            <small>Return on Risk</small>
          </div>
          <span className="positive">
            ●　Reward <b>$150.00</b>
          </span>
          <span className="negative">
            ●　Risk <b>$100.00</b>
          </span>
        </div>
      </div>
    </Card>
  );
}

function TradeMetadata({ trade }) {
  const rows = [
    ["Setup / Strategy", trade.setup],
    ["Bias", trade.bias],
    ["Timeframe", trade.timeframe],
    ["Session", "London"],
    ["Market Condition", trade.market],
    ["Confluence", trade.confluence],
  ];
  return (
    <Card
      title={
        <>
          <span>Trade Plan</span>
          <span>✎</span>
        </>
      }
    >
      <div className="detail-rows">
        {rows.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <b>{value}</b>
          </div>
        ))}
      </div>
      <h3>Tags</h3>
      <div className="chips">
        {trade.tags.map((tag) => (
          <span className="chip" key={tag}>
            {tag}
          </span>
        ))}
      </div>
    </Card>
  );
}

function Attachments({ items }) {
  return (
    <Card title="Attachments">
      <div className="attachment-grid">
        {items.map((item) => (
          <div key={item}>
            <div className="attachment-thumb">▧</div>
            <b>{item}</b>
            <small>May 18, 10:18 AM</small>
          </div>
        ))}
        <div>
          <div className="attachment-thumb upload-tile">＋</div>
          <b>Upload</b>
        </div>
      </div>
    </Card>
  );
}

function TradeReview() {
  return (
    <div className="review-row">
      <Card className="review-card">
        <div>
          <h2>Lessons Learned　ⓘ</h2>
          <p>
            Patience paid off. Waiting for the retest gave me a better entry
            with smaller stop and better R:R. Will continue to trust the
            process.
          </p>
        </div>
        <div className="review-divider" />
        <div>
          <h2>What I’ll Do Differently Next Time　ⓘ</h2>
          <p>Nothing major. Maybe take partial profits at 1R next time.</p>
        </div>
      </Card>
      <Card className="rating-card">
        <h2>Rating</h2>
        <div className="stars">★★★★★</div>
        <b>5 / 5</b>
      </Card>
    </div>
  );
}

export default function TradeDetails() {
  return (
    <>
      <TradeDetailsHeader trade={tradeDetails} />
      <TradeSummaryStrip trade={tradeDetails} />
      <div className="details-main-grid">
        <div className="details-left">
          <ChartScreenshot />
          <div className="detail-trio">
            <TradePlanNarrative />
            <Execution />
            <Emotions />
          </div>
        </div>
        <div className="details-right">
          <TradeResult />
          <TradeMetadata trade={tradeDetails} />
          <Attachments items={tradeDetails.attachments} />
        </div>
      </div>
      <TradeReview />
    </>
  );
}
