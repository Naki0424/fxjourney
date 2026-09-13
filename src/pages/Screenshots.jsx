import React, { useState } from "react";
import Button from "../components/common/Button";
import Card from "../components/common/Card";
import PageHeader from "../components/common/PageHeader";
import { screenshotFolders, screenshotItems } from "../data/mockData";
import { navigate } from "../lib/navigation";

function ScreenshotStats() {
  const stats = [
    ["Total Images", "128", "vs last 7 days", "+18", "image-stat"],
    ["This Month", "42", "vs last month", "+12", "image-stat"],
    ["Folders", "12", "Total folders", "", "folder-stat"],
    ["Linked to Trades", "96", "75.0% of images", "", "link-stat"],
    ["Storage Used", "248 MB", "of 2 GB (12%)", "", "storage-stat"],
  ];
  return <div className="screenshot-stats">{stats.map(([label, value, detail, change, tone], index) => <div className="screenshot-stat" key={label}><span className={`screenshot-stat-icon ${tone}`}>{["▧", "▧", "□", "⌁", "▣"][index]}</span><div><label>{label}</label><strong>{value}</strong><small>{detail} {change && <b className="positive">{change}</b>}</small>{label === "Storage Used" && <div className="storage-progress"><i /></div>}</div></div>)}</div>;
}

function ScreenshotFilters({ view, setView }) {
  return <Card className="screenshot-filters"><div className="screenshot-search"><input placeholder="Search screenshots..." /><span>⌕</span></div><select className="field"><option>All Folders</option></select><select className="field"><option>All Tags</option></select><select className="field"><option>All Time</option></select><select className="field"><option>Linked to Trades</option></select><div className="view-toggle"><button className={view === "grid" ? "active" : ""} onClick={() => setView("grid")}>▦ Grid</button><button className={view === "list" ? "active" : ""} onClick={() => setView("list")}>▤ List</button></div><Button>☷ More Filters</Button></Card>;
}

function FolderSection() {
  return <><div className="section-title folder-section-title"><h2>Folders</h2><a className="blue">View All Folders →</a></div><div className="screenshot-folder-grid">{screenshotFolders.map((folder) => <button className="screenshot-folder" key={folder.id}><span className="folder-icon" /><strong>{folder.name}</strong><small>{folder.count} images</small></button>)}<button className="screenshot-folder new-folder"><span>＋</span><strong>New Folder</strong></button></div></>;
}

function ScreenshotThumbnail({ visual, title }) {
  return <div className={`screenshot-thumbnail visual-${visual}`} aria-label={`${title} preview`}><span className="thumbnail-label">{visual === "range" ? "London Session Range" : visual === "notebook" || visual === "weekend-plan" ? "Trading notes" : "EURUSD · 15 · OANDA"}</span><span className="thumbnail-lines" /></div>;
}

function ScreenshotCard({ screenshot }) {
  return <Card className="screenshot-card"><div className="screenshot-card-top"><ScreenshotThumbnail visual={screenshot.visual} title={screenshot.title} />{screenshot.hasLink && <span className="thumbnail-link">⌁</span>}</div><div className="screenshot-card-body"><div className="screenshot-card-title"><b>{screenshot.title}</b>{screenshot.hasMenu && <button>⋮</button>}</div><span className="chip">{screenshot.category}</span><div className="screenshot-date">{screenshot.date}<span>{screenshot.time}</span></div><div className="screenshot-card-status"><small className={screenshot.linkedToTrade ? "linked" : "not-linked"}>{screenshot.linkedToTrade && "● "}{screenshot.linkedToTrade ? "Linked to Trade" : "Not linked"}</small><span>{screenshot.rr && <b className={screenshot.rr.startsWith("-") ? "negative" : "positive"}>{screenshot.rr}</b>}<button className="favorite">☆</button></span></div></div></Card>;
}

function ScreenshotPagination() {
  return <div className="screenshot-pagination"><div><button>‹</button><button className="active">1</button><button>2</button><button>3</button><span>…</span><button>8</button><button>›</button></div><small>Showing 1 to 12 of 128 images</small></div>;
}

function ScreenshotTips() {
  return <div className="screenshot-tips"><div className="tips-intro"><span className="tips-icon">♧</span><div><b>Organize. Review. Improve.</b><p>Use folders and tags to keep your screenshots organized.<br />Revisit your analysis and track your growth over time.</p></div></div><div className="tips-list"><b>Tips:</b><span>✓　Link screenshots to trades for better context</span><span>✓　Review old analysis and compare with results</span><span>✓　Delete unnecessary images to keep it clean</span></div><div className="tips-illustration"><span>▰</span><b>▧</b></div></div>;
}

export default function Screenshots() {
  const [view, setView] = useState("grid");
  return <><PageHeader title="▧ Screenshots" sub="Store and organize your trading charts, analysis and notes."><Button onClick={() => navigate("/analyzer")}>♧ Upload Screenshot</Button><Button primary>＋ New Folder</Button></PageHeader><ScreenshotStats /><ScreenshotFilters view={view} setView={setView} /><FolderSection /><div className="section-title all-screenshots-title"><h2>All Screenshots <span className="muted">(128)</span></h2><span className="sort-control">Sort by:　<b>Newest First⌄</b></span></div><div className={view === "grid" ? "screenshot-gallery" : "screenshot-gallery list-view"}>{screenshotItems.map((screenshot) => <ScreenshotCard key={screenshot.id} screenshot={screenshot} />)}</div><ScreenshotPagination /><ScreenshotTips /></>;
}
