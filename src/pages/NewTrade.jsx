import React, { useEffect, useMemo, useRef, useState } from "react";
import Button from "../components/common/Button";
import Card from "../components/common/Card";
import PageHeader from "../components/common/PageHeader";
import { useApplication } from "../context/ApplicationContext";
import { categories } from "../data/mockData";
import { navigate } from "../lib/navigation";
import { tradeService } from "../services/tradeService";
import { formToTradePayload, tradeToForm, validateTradeForm } from "../utils/tradeData";
import { calculateRR } from "../utils/rr";

const initialTrade = {
  pair: "EURUSD",
  direction: "LONG",
  lots: "0.50",
  dateTime: "2024-05-18T10:20",
  session: "London",
  timeframe: "15m",
  account: "",
  status: "Win",
  setup: "Breakout",
  market: "Trending",
  tags: ["Breakout", "London", "High Probability"],
  bias: "Bullish　↗",
  entryType: "Market Order",
  entry: "1.08520",
  stopLoss: "1.08370",
  takeProfit: "1.08761",
  exitPrice: "1.08761",
  riskPips: "",
  rewardPips: "",
  positionSize: "0.50",
  riskPercent: "0.50",
  duration: "1h 15m",
  tradeReason: "",
  expected: "",
  invalidation: "",
  emotionBefore: "Confident",
  emotionDuring: "Patient",
  emotionAfter: "Happy",
  emotionBeforeNote: "Feeling prepared and confident in my analysis.",
  emotionDuringNote: "Waiting for price to reach take profit.",
  emotionAfterNote: "Great execution and perfect result.",
  notes: "",
  lessonsLearned: "",
  improvements: "",
  rating: 0,
  closedAt: "2024-05-18T11:35",
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

function DateField({ label, value, onChange }) {
  return (
    <div className="form-field">
      <label>{label}</label>
      <div className="icon-input">
        <span>▣</span>
        {onChange ? <input className="date-input" type="datetime-local" value={value} onChange={onChange} /> : value}
        <span>⌄</span>
      </div>
    </div>
  );
}

function TextAreaField({ label, placeholder, value, onChange, maxLength = 500 }) {
  return (
    <div className="form-field textarea-field">
      <label>{label}</label>
      <textarea
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
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
        <FormInput
          label="Lots"
          value={trade.lots}
          onChange={(event) => update("lots", event.target.value)}
        />
        <DateField label="Date & Time" value={trade.dateTime} onChange={(event) => update("dateTime", event.target.value)} />
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
            options={["Win", "Loss", "Breakeven", "Unresolved"]}
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

function TradePlan({ trade, setTrade }) {
  const update = (field, value) => setTrade((current) => ({ ...current, [field]: value }));
  return (
    <Card title="◎ Trade Plan">
      <div className="form-field">
        <label>Bias</label>
        <SegmentControl
          options={["Bullish　↗", "Bearish　↗", "Neutral"]}
          value={trade.bias}
          onChange={(value) => update("bias", value)}
        />
      </div>
      <TextAreaField
        label="Reason for the Trade"
        placeholder="Why did you take this trade?"
        value={trade.tradeReason}
        onChange={(value) => update("tradeReason", value)}
      />
      <TextAreaField
        label="What I Expected"
        placeholder="What was your expectation for this trade?"
        value={trade.expected}
        onChange={(value) => update("expected", value)}
      />
      <TextAreaField
        label="Invalidation / Stop Reason"
        placeholder="What would invalidate your idea?"
        value={trade.invalidation}
        onChange={(value) => update("invalidation", value)}
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
        <DateField label="Entry Time" value={trade.dateTime} onChange={(event) => update("dateTime", event.target.value)} />
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
        <FormInput label="Risk (pips)" value={trade.riskPips || "N/A"} readOnly />
        <FormInput label="Reward (pips)" value={trade.rewardPips || "N/A"} readOnly />
        <FormInput
          label="R:R"
          value={rr ? rr.ratio.toFixed(2) : "—"}
          readOnly
        />
        <FormInput
          label="Position Size (Lots)"
          value={trade.lots}
          readOnly
        />
        <FormInput
          label="Risk % of Account"
          value={trade.riskPercent}
          onChange={(event) => update("riskPercent", event.target.value)}
        />
        <FormInput label="Duration" value={trade.duration} readOnly />
      </div>
      <div className="calculation-strip">
        <span>
          Risk: <b className="negative">N/A</b>
          <small>Persisted after execution</small>
        </span>
        <span>
          Reward: <b className="positive">N/A</b>
          <small>Persisted after execution</small>
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

function Emotions({ trade }) {
  const emotions = [
    ["Before Trade", "emotionBefore", "emotionBeforeNote", "green"],
    ["During Trade", "emotionDuring", "emotionDuringNote", "orange"],
    ["After Trade", "emotionAfter", "emotionAfterNote", "green"],
  ];
  return (
    <Card title="☻ Emotions　ⓘ">
      <div className="emotion-grid">
        {emotions.map(([label, valueField, noteField, tone]) => (
          <div className="emotion-item" key={label}>
            <label>{label}</label>
            <div className={`emotion-select ${tone}`}>
              ☺　{trade[valueField]}
              <span>⌄</span>
            </div>
            <p>{trade[noteField]}</p>
            <small>{trade[noteField].length} / 200</small>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Notes({ trade, setTrade }) {
  return (
    <Card title="▤ Notes">
      <div className="large-textarea">
        <textarea value={trade.notes} onChange={(event) => setTrade((current) => ({ ...current, notes: event.target.value }))} placeholder="Additional notes about this trade..." />
        <small>{trade.notes.length} / 1000</small>
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

function ReviewText({ title, icon, placeholder, value, onChange }) {
  return (
    <Card title={`${icon} ${title}`}>
      <label className="review-helper">
        {title === "Lessons Learned"
          ? "What did you learn from this trade?"
          : "How will you improve for your next similar trade?"}
      </label>
      <div className="large-textarea">
        <textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
        <small>{value.length} / 1000</small>
      </div>
    </Card>
  );
}

function TradeRating({ trade, setTrade }) {
  const rating = trade.rating;
  return (
    <Card title="☆ Trade Rating">
      <p>How well did you execute your plan?</p>
      <div className="rating-stars">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            className={star <= rating ? "selected" : ""}
            onClick={() => setTrade((current) => ({ ...current, rating: star }))}
          >
            ☆
          </button>
        ))}
      </div>
      <small>Select rating (1-5)</small>
    </Card>
  );
}

function editTradeId() {
  return new URLSearchParams(window.location.search).get("edit");
}

function saveErrorMessage(error) {
  if (error?.status === 409) return "This trade was changed elsewhere. Reload it before saving your changes.";
  return error?.message || "The trade could not be saved. Please try again.";
}

export default function NewTrade() {
  const { accounts, selectedAccountId, setSelectedAccountId } = useApplication();
  const editId = useMemo(() => editTradeId(), []);
  const [trade, setTrade] = useState(initialTrade);
  const [loading, setLoading] = useState(Boolean(editId));
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [saveError, setSaveError] = useState(null);

  useEffect(() => {
    if (!editId) return undefined;
    let active = true;
    tradeService.get(editId)
      .then((result) => {
        if (!active) return;
        const persistedTrade = result?.trade;
        if (!persistedTrade) throw new Error("Trade not found.");
        setTrade(tradeToForm(persistedTrade));
        if (accounts.some((account) => account.id === persistedTrade.accountId)) {
          setSelectedAccountId(persistedTrade.accountId);
        }
        setLoading(false);
      })
      .catch((error) => {
        if (!active) return;
        setLoadError(error);
        setLoading(false);
      });
    return () => { active = false; };
  }, [accounts, editId, setSelectedAccountId]);

  const handleCancel = () => navigate(editId ? `/trade-details/${encodeURIComponent(editId)}` : "/trades");
  const handleSave = async (draft) => {
    const accountId = selectedAccountId || trade.account;
    const validationError = validateTradeForm(trade, accountId);
    if (validationError) {
      setSaveError(new Error(validationError));
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const payload = formToTradePayload(trade, accountId, { draft });
      if (editId) {
        await tradeService.update(editId, payload, trade.version);
      } else {
        await tradeService.create(payload);
      }
      navigate("/trades");
    } catch (error) {
      setSaveError(error);
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title={editId ? "Edit Trade" : "New Trade"}
        sub="Record a new trade to track your performance and improve."
      >
        <Button onClick={handleCancel} disabled={saving}>Cancel</Button>
        <Button onClick={() => handleSave(true)} disabled={saving || loading || !accounts.length}>▱ Save as Draft</Button>
        <Button primary onClick={() => handleSave(false)} disabled={saving || loading || !accounts.length}>✓ Save Trade</Button>
      </PageHeader>
      {loadError && (
        <div className="trade-form-message error" role="alert">
          {saveErrorMessage(loadError)} <Button onClick={() => window.location.reload()}>Retry</Button>
        </div>
      )}
      {saveError && <div className="trade-form-message error" role="alert">{saveErrorMessage(saveError)}</div>}
      {!accounts.length && <div className="trade-form-message">No active account is available. Create an account before saving a trade.</div>}
      {loading ? (
        <div className="trade-data-state"><h2>Loading trade</h2><p>Reading the persisted trade before editing.</p></div>
      ) : loadError ? null : (
        <>
          <TradeInfoPanel trade={trade} setTrade={setTrade} />
          <div className="new-trade-main-row">
            <TradePlan trade={trade} setTrade={setTrade} />
            <EntryExit trade={trade} setTrade={setTrade} />
            <ChartScreenshot />
          </div>
          <div className="new-trade-second-row">
            <Emotions trade={trade} />
            <Notes trade={trade} setTrade={setTrade} />
            <Attachments />
          </div>
          <div className="new-trade-review-row">
            <ReviewText
              title="Lessons Learned"
              icon="♧"
              placeholder="What went well? What could be improved?"
              value={trade.lessonsLearned}
              onChange={(value) => setTrade((current) => ({ ...current, lessonsLearned: value }))}
            />
            <ReviewText
              title="What I'll Do Differently Next Time"
              icon="◎"
              placeholder="What would you do differently?"
              value={trade.improvements}
              onChange={(value) => setTrade((current) => ({ ...current, improvements: value }))}
            />
            <TradeRating trade={trade} setTrade={setTrade} />
          </div>
        </>
      )}
    </>
  );
}
