import React, { useMemo, useState } from "react";
import Button from "../components/common/Button";
import Card from "../components/common/Card";
import PageHeader from "../components/common/PageHeader";
import Stat from "../components/common/Stat";
import { journalEntries } from "../data/mockData";
import { navigate } from "../lib/navigation";

const moodStyles = {
  positive: { icon: "☺", className: "mood-positive" },
  neutral: { icon: "☻", className: "mood-neutral" },
};

function JournalStats() {
  const stats = [
    ["Total Entries", "18", "vs last 7 days", "+4", "journal-blue", "▤"],
    ["Positive Entries", "10", "55.6%", "", "journal-green", "☺"],
    ["Neutral Entries", "5", "27.8%", "", "journal-orange", "☻"],
    ["Challenging Entries", "3", "16.6%", "", "journal-red", "☹"],
  ];
  return (
    <div className="journal-stats">
      {stats.map(([label, value, detail, change, tone, icon]) => (
        <div className="journal-stat" key={label}>
          <span className={`journal-stat-icon ${tone}`}>{icon}</span>
          <div>
            <label>{label}</label>
            <strong>{value}</strong>
            <small>
              {detail} {change && <b className="positive">{change}</b>}
            </small>
          </div>
        </div>
      ))}
    </div>
  );
}

function JournalFilters() {
  return (
    <Card className="journal-filters">
      <div className="journal-search">
        <input placeholder="Search journal entries..." />
        <span>⌕</span>
      </div>
      <select className="field">
        <option>All Types</option>
      </select>
      <select className="field">
        <option>All Moods</option>
      </select>
      <select className="field">
        <option>All Tags</option>
      </select>
      <Button>☷ More Filters</Button>
    </Card>
  );
}

function JournalEntryItem({ entry, selected, onSelect }) {
  const mood = moodStyles[entry.mood] || moodStyles.neutral;
  return (
    <button
      className={`journal-list-entry ${selected ? "selected" : ""}`}
      onClick={() => onSelect(entry.id)}
    >
      <div className="journal-list-date">
        <small>{entry.month}</small>
        <b>{entry.day}</b>
        <small>{entry.year}</small>
      </div>
      <div className="journal-list-copy">
        <strong>{entry.title}</strong>
        <p>{entry.summary}</p>
        <div className="chips">
          {entry.tags.map((tag) => (
            <span className="chip" key={tag}>
              #{tag}
            </span>
          ))}
        </div>
      </div>
      <div className="journal-list-meta">
        <span className={`mood-icon ${mood.className}`}>{mood.icon}</span>
        <small>{entry.time}</small>
      </div>
    </button>
  );
}

function Pagination() {
  return (
    <div className="journal-pagination">
      <span>Showing 1 to 7 of 18 entries</span>
      <div>
        <button>‹</button>
        <button className="active">1</button>
        <button>2</button>
        <button>3</button>
        <button>›</button>
      </div>
    </div>
  );
}

function JournalEntriesList({ selectedId, onSelect }) {
  return (
    <Card className="journal-entries-panel">
      <div className="journal-panel-header">
        <h2>
          Journal Entries <span>(18)</span>
        </h2>
        <select className="field">
          <option>Newest First</option>
        </select>
      </div>
      <div className="journal-list">
        {journalEntries.map((entry) => (
          <JournalEntryItem
            key={entry.id}
            entry={entry}
            selected={entry.id === selectedId}
            onSelect={onSelect}
          />
        ))}
      </div>
      <Pagination />
    </Card>
  );
}

function JournalAttachments() {
  return (
    <section className="journal-detail-section">
      <h3>
        ♧　Attachments <span>(2)</span>
      </h3>
      <div className="journal-attachments">
        <div>
          <div className="journal-attachment-thumb chart-placeholder" />
          <b>Trade Screenshot.png</b>
          <small>245 KB</small>
        </div>
        <div>
          <div className="journal-attachment-thumb notes-placeholder" />
          <b>Trade Plan Notes.png</b>
          <small>312 KB</small>
        </div>
        <button className="journal-upload-tile">
          <strong>＋</strong>
          <span>Upload</span>
        </button>
      </div>
    </section>
  );
}

function RelatedTrade() {
  return (
    <section className="journal-detail-section">
      <h3>Related Trade</h3>
      <button
        className="related-trade"
        onClick={() => navigate("/trade-details")}
      >
        <span className="related-pair-icon">🌐</span>
        <span>
          <b>
            EURUSD　<span className="pill green">Buy</span>
          </b>
          <small>May 18, 2024 10:20 AM</small>
        </span>
        <strong className="positive">+$120.50　•　1.50R</strong>
        <span className="related-open">↗</span>
      </button>
    </section>
  );
}

function JournalDetail({ entry }) {
  const fullEntry = entry.entry || entry.summary;
  const wentWell = entry.wentWell || [
    "Followed my plan",
    "Waited for confirmation",
    "Managed risk properly",
  ];
  const improvements = entry.improvements || ["Continue waiting for A+ setups"];
  const takeaway =
    entry.takeaway || "Keep learning from every trading session.";
  const mood = moodStyles[entry.mood] || moodStyles.neutral;
  return (
    <Card className="journal-detail">
      <div className="journal-detail-header">
        <h2>{entry.title}</h2>
        <div>
          <button>✎</button>
          <i />
          <button className="delete-action">▥</button>
        </div>
      </div>
      <div className="journal-detail-meta">
        <span>▣　{entry.date}</span>
        <span>{entry.time}</span>
        <i />
        <span className={mood.className}>
          {mood.icon}　{entry.mood === "positive" ? "Positive" : "Neutral"}
        </span>
        <b>⋯</b>
      </div>
      <section className="journal-detail-section">
        <h3>Entry</h3>
        <p>{fullEntry}</p>
      </section>
      <section className="journal-detail-section">
        <h3 className="positive">What went well?</h3>
        <div className="went-well">
          {wentWell.map((item) => (
            <p key={item}>
              <span>✓</span>
              {item}
            </p>
          ))}
        </div>
      </section>
      <section className="journal-detail-section">
        <h3 className="improvement-title">What could be improved?</h3>
        {improvements.map((item) => (
          <p className="improvement-item" key={item}>
            •　{item}
          </p>
        ))}
      </section>
      <section className="journal-detail-section">
        <h3 className="blue">Key Takeaway</h3>
        <div className="journal-takeaway">
          {takeaway.split("\n").map((line) => (
            <React.Fragment key={line}>
              {line}
              <br />
            </React.Fragment>
          ))}
        </div>
      </section>
      <section className="journal-detail-section">
        <h3>Tags</h3>
        <div className="chips">
          <span className="chip">#Discipline</span>
          <span className="chip">#Patience</span>
          <span className="chip">#Execution</span>
          <button className="small-add">＋</button>
        </div>
      </section>
      <JournalAttachments />
      <RelatedTrade />
    </Card>
  );
}

function JournalQuote() {
  return (
    <div className="journal-quote">
      <span>“</span>
      <p>
        The goal of a successful trader is to make the best trades.
        <br />
        Money is secondary.
      </p>
      <cite>– Alexander Elder</cite>
    </div>
  );
}

export default function Journal() {
  const [selectedId, setSelectedId] = useState(journalEntries[0].id);
  const selectedEntry = useMemo(
    () =>
      journalEntries.find((entry) => entry.id === selectedId) ||
      journalEntries[0],
    [selectedId],
  );
  return (
    <>
      <PageHeader
        title="▤ Journal"
        sub="Reflect, learn and grow. Write your thoughts and track your journey."
      >
        <Button primary>＋ New Journal Entry</Button>
        <Button>▣ May 12 – May 18, 2024⌄</Button>
      </PageHeader>
      <JournalStats />
      <JournalFilters />
      <div className="journal-content-grid">
        <JournalEntriesList selectedId={selectedId} onSelect={setSelectedId} />
        <JournalDetail entry={selectedEntry} />
      </div>
      <JournalQuote />
    </>
  );
}
