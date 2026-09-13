import React, { useMemo, useRef, useState } from "react";
import Button from "../components/common/Button";
import Card from "../components/common/Card";
import PageHeader from "../components/common/PageHeader";
import { useApplication } from "../context/ApplicationContext";
import { categories } from "../data/mockData";
import { navigate } from "../lib/navigation";
import { calculateRR } from "../utils/rr";

const initialTrade = {
  pair: "EURUSD",
  direction: "LONG",
  lots: "0.50",
  dateTime: "May 18, 2024 10:20 AM",
  session: "London",
  timeframe: "15m",
  account: "",
  status: "Win",
  setup: "Breakout",
  market: "Trending",
  tags: ["Breakout", "London", "High Probability"],
  bias: "Bullish",
  entryType: "Market Order",
  entry: "1.08520",
  stopLoss: "1.08370",
  takeProfit: "1.08761",
  exitPrice: "1.08761",
  riskPips: "15",
  rewardPips: "24.1",
  positionSize: "0.50",
  riskPercent: "0.50",
  duration: "1h 15m",
};

function FormInput({ label, ...props }) {
  return (
    <div className="form-field">
      <label>{label}</label>
      <input {...props} />
    </div>
  );
}

function SelectField({ label, value, options, onChange, disabled = false }) {
  return (
    <div className="form-field">
      <label>{label}</label>
      <select value={value} onChange={onChange} disabled={disabled}>
        {options.map((option) => {
          const normalized = typeof option === "string"
            ? { value: option, label: option }
            : option;
          return (
            <option key={normalized.value} value={normalized.value}>
              {normalized.label}
            </option>
          );
        })}
      </select>
    </div>
  );
}

function DateField({ label, value }) {
  return (
    <div className="form-field">
      <label>{label}</label>
      <div className="icon-input"><span>▣</span>{value}<span>⌄</span></div>
    </div>
  );
}

function TextAreaField({ label, placeholder, maxLength = 500 }) {
  const [value, setValue] = useState("");
  return (
    <div className="form-field textarea-field">
      <label>{label}</label>
      <textarea
        value={value}
        maxLength={maxLength}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
      />
      <small>
        {value.length} / {maxLength}
      </small>
    </div>
  );
}

function SegmentControl({ options, value, onChange, tone = "green" }) {
  return (
    <div className="segment-control">
      {options.map((option) => (
        <button
          key={option}
          className={value === option ? `selected ${tone}` : ""}
          onClick={() => onChange(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function TradeInfoPanel({ trade, setTrade }) {
  const { accounts, selectedAccountId, setSelectedAccountId } = useApplication();
  const update = (field, value) =>
    setTrade((current) => ({ ...current, [field]: value }));
  const accountOptions = accounts.length
    ? accounts.map((account) => ({ value: account.id, label: account.name }))
    : [{ value: "", label: "No accounts available" }];
  const accountValue = selectedAccountId || trade.account || "";

  return (
    <Card className="trade-info-panel">
      <div className="trade-info-row top">
        <div className="pair-control">
          <label>Currency Pair</label>
          <div className="pair-select">
            <span className="pair-flag">🌐</span>
            <span>
              <b>{trade.pair}</b>
              <small>Euro / U.S. Dollar</small>
            </span>
            <span>⌄</span>
          </div>
        </div>
        <div className="direction-control">
          <label>Direction</label>
          <div className="direction-buttons">
            <button
              className={trade.direction === "LONG" ? "active-buy" : ""}
              onClick={() => update("direction", "LONG")}
            >
              ↗　Buy
            </button>
            <button
              className={trade.direction === "SHORT" ? "active-sell" : ""}
              onClick={() => update("direction", "SHORT")}
            >
              ↘　Sell
            </button>
          </div>
        </div>
        <FormInput label="Lots" value={trade.lots} readOnly />
        <DateField label="Date & Time" value={trade.dateTime} />
        <SelectField
          label="Session"
          value={trade.session}
          options={["London", "New York", "Asia"]}
          onChange={(event) => update("session", event.target.value)}
        />
        <SelectField
          label="Timeframe"
          value={trade.timeframe}
          options={["15m", "1H", "4H"]}
          onChange={(event) => update("timeframe", event.target.value)}
        />
      </div>
      <div className="trade-info-row bottom">
        <SelectField
          label="Account"
          value={accountValue}
          options={accountOptions}
          disabled={!accounts.length}
          onChange={(event) => {
            setSelectedAccountId(event.target.value || null);
            update("account", event.target.value);
          }}
        />
        <div className="form-field">
          <label>Status (Auto)</label>
          <SegmentControl
            options={["Win", "Loss", "Breakeven"]}
            value={trade.status}
            onChange={(value) => update("status", value)}
          />
        </div>
        <SelectField
          label="Strategy / Setup"
          value={trade.setup}
          options={["Breakout", "Trend Following", "Reversal"]}
          onChange={(event) => update("setup", event.target.value)}
        />
        <SelectField
          label="Market Condition"
          value={trade.market}
          options={["Trending", "Ranging", "Volatile"]}
          onChange={(event) => update("market", event.target.value)}
        />
        <div className="form-field tags-field">
          <label>Tags</label>
          <div className="tag-select">
            <div className="chips">
              {trade.tags.map((tag) => (
                <span className="chip" key={tag}>
                  {tag}{" "}
                  <button
                    onClick={() =>
                      update(
                        "tags",
                        trade.tags.filter((item) => item !== tag),
                      )
                    }
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <span>⌄</span>
          </div>
        </div>
        <button
          className="add-tag"
          onClick={() =>
            update("tags", [
              ...trade.tags,
              categories.find((tag) => !trade.tags.includes(tag)) || "Setup A",
            ])
          }
        >
          ＋
        </button>
      </div>
    </Card>
  );
}

function TradePlan() {
  const [bias, setBias] = useState("Bullish　↗");
  return (
    <Card title="◎ Trade Plan">
      <div className="form-field">
        <label>Bias</label>
        <SegmentControl
          options={["Bullish　↗", "Bearish　↗", "Neutral"]}
          value={bias}
          onChange={setBias}
        />
      </div>
      <TextAreaField
        label="Reason for the Trade"
        placeholder="Why did you take this trade?"
      />
      <TextAreaField
        label="What I Expected"
        placeholder="What was your expectation for this trade?"
      />
      <TextAreaField
        label="Invalidation / Stop Reason"
        placeholder="What would invalidate your idea?"
      />
    </Card>
  );
}

function EntryExit({ trade, setTrade }) {
  const update = (field, value) =>
    setTrade((current) => ({ ...current, [field]: value }));
  const rr = useMemo(
    () =>
      calculateRR(
        trade.direction,
        trade.entry,
        trade.stopLoss,
        trade.takeProfit,
      ),
    [trade.direction, trade.entry, trade.stopLoss, trade.takeProfit],
  );
  return (
    <Card title="▧ Entry & Exit">
      <div className="entry-grid">
        <SelectField
          label="Entry Type"
          value={trade.entryType}
          options={["Market Order", "Limit Order"]}
          onChange={(event) => update("entryType", event.target.value)}
        />
        <FormInput
          label="Entry Price"
          value={trade.entry}
          onChange={(event) => update("entry", event.target.value)}
        />
        <DateField label="Entry Time" value={trade.dateTime} />
        <FormInput
          label="Stop Loss"
          value={trade.stopLoss}
          className="negative-input"
          onChange={(event) => update("stopLoss", event.target.value)}
        />
        <FormInput
          label="Take Profit"
          value={trade.takeProfit}
          className="positive-input"
          onChange={(event) => update("takeProfit", event.target.value)}
        />
        <FormInput
          label="Exit Price"
          value={trade.exitPrice}
          onChange={(event) => update("exitPrice", event.target.value)}
        />
        <FormInput label="Risk (pips)" value={trade.riskPips} readOnly />
        <FormInput label="Reward (pips)" value={trade.rewardPips} readOnly />
        <FormInput
          label="R:R"
          value={rr ? rr.ratio.toFixed(2) : "—"}
          readOnly
        />
        <FormInput
          label="Position Size (Lots)"
          value={trade.positionSize}
          readOnly
        />
        <FormInput
          label="Risk % of Account"
          value={`${trade.riskPercent} %`}
          readOnly
        />
        <FormInput label="Duration" value={trade.duration} readOnly />
      </div>
      <div className="calculation-strip">
        <span>
          Risk: <b className="negative">$100.00</b>
          <small>0.50%</small>
        </span>
        <span>
          Reward: <b className="positive">$160.00</b>
          <small>0.80%</small>
        </span>
        <span>
          R:R: <b>{rr ? rr.ratio.toFixed(2) : "—"}</b>
        </span>
      </div>
    </Card>
  );
}

function ChartScreenshot() {
  const [preview, setPreview] = useState(null);
  const inputRef = useRef(null);
  const selectFile = (file) => {
    if (file?.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = () => setPreview(reader.result);
      reader.readAsDataURL(file);
    }
  };
  return (
    <Card title="▣ Chart Screenshot　ⓘ">
      <div
        className={`trade-upload ${preview ? "has-preview" : ""}`}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          selectFile(event.dataTransfer.files[0]);
        }}
        onClick={() => inputRef.current?.click()}
      >
        {preview ? (
          <img src={preview} alt="Selected chart preview" />
        ) : (
          <div>
            <div className="upload-icon">♧</div>
            <strong>Upload chart screenshot</strong>
            <span>Drag and drop your image here, or click to browse</span>
            <small>PNG, JPG up to 10MB</small>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => selectFile(event.target.files[0])}
        />
      </div>
      <div className="quick-tools-label">
        Quick Draw Tools <small>(optional)</small>
      </div>
      <div className="quick-tools">
        {[
          ["↗", "Arrow"],
          ["⌁", "Trendline"],
          ["□", "Rectangle"],
          ["T", "Text"],
          ["⇆", "Fibonacci"],
        ].map(([icon, label]) => (
          <button key={label}>
            <b>{icon}</b>
            <span>{label}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}

function Emotions() {
  const emotions = [
    [
      "Before Trade",
      "Confident",
      "Feeling prepared and confident in my analysis.",
      "green",
    ],
    [
      "During Trade",
      "Patient",
      "Waiting for price to reach take profit.",
      "orange",
    ],
    ["After Trade", "Happy", "Great execution and perfect result.", "green"],
  ];
  return (
    <Card title="☻ Emotions　ⓘ">
      <div className="emotion-grid">
        {emotions.map(([label, value, helper, tone]) => (
          <div className="emotion-item" key={label}>
            <label>{label}</label>
            <div className={`emotion-select ${tone}`}>
              ☺　{value}
              <span>⌄</span>
            </div>
            <p>{helper}</p>
            <small>0 / 200</small>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Notes() {
  return (
    <Card title="▤ Notes">
      <div className="large-textarea">
        <textarea placeholder="Additional notes about this trade..." />
        <small>0 / 1000</small>
      </div>
    </Card>
  );
}

function Attachments() {
  return (
    <Card title="♧ Attachments">
      <div className="attachment-form-grid">
        {[
          ["RR Plan.png", "245 KB"],
          ["Analysis Notes.png", "312 KB"],
        ].map(([name, size]) => (
          <div className="attachment-form-item" key={name}>
            <div className="attachment-form-thumb">▧</div>
            <button>×</button>
            <b>{name}</b>
            <small>{size}</small>
          </div>
        ))}
        <div className="attachment-form-item">
          <div className="attachment-form-thumb upload-tile">＋</div>
          <b>Upload More</b>
        </div>
      </div>
      <p className="supported-formats">
        Supported formats: PNG, JPG, PDF (Max 10MB each)
      </p>
    </Card>
  );
}

function ReviewText({ title, icon, placeholder }) {
  return (
    <Card title={`${icon} ${title}`}>
      <label className="review-helper">
        {title === "Lessons Learned"
          ? "What did you learn from this trade?"
          : "How will you improve for your next similar trade?"}
      </label>
      <div className="large-textarea">
        <textarea placeholder={placeholder} />
        <small>0 / 1000</small>
      </div>
    </Card>
  );
}

function TradeRating() {
  const [rating, setRating] = useState(0);
  return (
    <Card title="☆ Trade Rating">
      <p>How well did you execute your plan?</p>
      <div className="rating-stars">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            className={star <= rating ? "selected" : ""}
            onClick={() => setRating(star)}
          >
            ☆
          </button>
        ))}
      </div>
      <small>Select rating (1-5)</small>
    </Card>
  );
}

export default function NewTrade() {
  const [trade, setTrade] = useState(initialTrade);
  const handleCancel = () => navigate("/trades");
  return (
    <>
      <PageHeader
        title="New Trade"
        sub="Record a new trade to track your performance and improve."
      >
        <Button onClick={handleCancel}>Cancel</Button>
        <Button>▱ Save as Draft</Button>
        <Button primary>✓ Save Trade</Button>
      </PageHeader>
      <TradeInfoPanel trade={trade} setTrade={setTrade} />
      <div className="new-trade-main-row">
        <TradePlan />
        <EntryExit trade={trade} setTrade={setTrade} />
        <ChartScreenshot />
      </div>
      <div className="new-trade-second-row">
        <Emotions />
        <Notes />
        <Attachments />
      </div>
      <div className="new-trade-review-row">
        <ReviewText
          title="Lessons Learned"
          icon="♧"
          placeholder="What went well? What could be improved?"
        />
        <ReviewText
          title="What I'll Do Differently Next Time"
          icon="◎"
          placeholder="What would you do differently?"
        />
        <TradeRating />
      </div>
    </>
  );
}
