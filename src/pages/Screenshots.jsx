import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Button from "../components/common/Button";
import Card from "../components/common/Card";
import PageHeader from "../components/common/PageHeader";
import { useApplication } from "../context/ApplicationContext";
import { screenshotService } from "../services/screenshotService";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

function formatFileSize(sizeBytes) {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) return "N/A";
  if (sizeBytes < 1024 * 1024) return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateParts(value) {
  if (!value) return { date: "—", time: "" };
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return { date: "—", time: "" };
  return {
    date: new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(parsed),
    time: new Intl.DateTimeFormat("en-US", { timeStyle: "short" }).format(parsed),
  };
}

function isThisMonth(value) {
  const parsed = new Date(value);
  const now = new Date();
  return !Number.isNaN(parsed.getTime())
    && parsed.getFullYear() === now.getFullYear()
    && parsed.getMonth() === now.getMonth();
}

function ScreenshotStats({ screenshots, folders }) {
  const totalBytes = screenshots.reduce((total, screenshot) => total + (Number(screenshot.byteSize) || 0), 0);
  const storagePercentage = Math.min(100, (totalBytes / (2 * 1024 * 1024 * 1024)) * 100);
  const linkedCount = screenshots.filter((screenshot) => screenshot.linkedToTrade).length;
  const linkedPercentage = screenshots.length ? `${((linkedCount / screenshots.length) * 100).toFixed(1)}% of images` : "No linked images";
  const stats = [
    ["Total Images", String(screenshots.length), "Persisted screenshots", "", "image-stat"],
    ["This Month", String(screenshots.filter((screenshot) => isThisMonth(screenshot.uploadedAt)).length), "Uploaded this month", "", "image-stat"],
    ["Folders", String(folders.length), "Active folders", "", "folder-stat"],
    ["Linked to Trades", String(linkedCount), linkedPercentage, "", "link-stat"],
    ["Storage Used", formatFileSize(totalBytes), "Stored media", "", "storage-stat"],
  ];
  return <div className="screenshot-stats">{stats.map(([label, value, detail, change, tone], index) => <div className="screenshot-stat" key={label}><span className={`screenshot-stat-icon ${tone}`}>{["▧", "▧", "□", "⌁", "▣"][index]}</span><div><label>{label}</label><strong>{value}</strong><small>{detail} {change && <b className="positive">{change}</b>}</small>{label === "Storage Used" && <div className="storage-progress"><i style={{ width: `${storagePercentage}%` }} /></div>}</div></div>)}</div>;
}

function ScreenshotFilters({ filters, setFilters, view, setView, folders, tags, disabled }) {
  const update = (field, value) => setFilters((current) => ({ ...current, [field]: value }));
  return <Card className="screenshot-filters"><div className="screenshot-search"><input placeholder="Search screenshots..." value={filters.search} onChange={(event) => update("search", event.target.value)} disabled={disabled} /><span>⌕</span></div><select className="field" value={filters.folderId} onChange={(event) => update("folderId", event.target.value)} disabled={disabled}><option value="">All Folders</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select><select className="field" value={filters.tagId} onChange={(event) => update("tagId", event.target.value)} disabled={disabled}><option value="">All Tags</option>{tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select><select className="field" value={filters.timeRange} onChange={(event) => update("timeRange", event.target.value)} disabled={disabled}><option value="">All Time</option><option value="month">This Month</option><option value="week">Last 7 Days</option></select><select className="field" value={filters.linked} onChange={(event) => update("linked", event.target.value)} disabled={disabled}><option value="">All Trade Links</option><option value="linked">Linked to Trades</option><option value="unlinked">Not linked</option></select><div className="view-toggle"><button className={view === "grid" ? "active" : ""} onClick={() => setView("grid")}>▦ Grid</button><button className={view === "list" ? "active" : ""} onClick={() => setView("list")}>▤ List</button></div><Button>☷ More Filters</Button></Card>;
}

function FolderSection({ folders, screenshots, selectedFolderId, onSelect, onCreate }) {
  const countForFolder = (folderId) => screenshots.filter((screenshot) => screenshot.folderId === folderId).length;
  return <><div className="section-title folder-section-title"><h2>Folders</h2><button className="blue" onClick={() => onSelect("")}>View All Folders →</button></div><div className="screenshot-folder-grid">{folders.map((folder) => <button className={`screenshot-folder ${selectedFolderId === folder.id ? "selected" : ""}`} key={folder.id} onClick={() => onSelect(folder.id)}><span className="folder-icon" /><strong>{folder.name}</strong><small>{countForFolder(folder.id)} images</small></button>)}<button className="screenshot-folder new-folder" onClick={onCreate}><span>＋</span><strong>New Folder</strong></button></div></>;
}

function ScreenshotThumbnail({ screenshot }) {
  const [broken, setBroken] = useState(false);
  return <div className={`screenshot-thumbnail ${broken ? "thumbnail-missing" : ""}`} aria-label={`${screenshot.originalFilename} preview`}>{!broken && <img src={screenshotService.contentUrl(screenshot.id)} alt="" onError={() => setBroken(true)} />}{broken && <span>Image unavailable</span>}<span className="thumbnail-label">{screenshot.originalFilename}</span></div>;
}

function ScreenshotCard({ screenshot, onFavorite, disabled }) {
  const { date, time } = formatDateParts(screenshot.capturedAt || screenshot.uploadedAt);
  const category = screenshot.categories?.[0]?.name || screenshot.tags?.[0]?.name || "Uncategorized";
  return <Card className="screenshot-card"><div className="screenshot-card-top"><ScreenshotThumbnail screenshot={screenshot} />{screenshot.linkedToTrade && <span className="thumbnail-link">⌁</span>}</div><div className="screenshot-card-body"><div className="screenshot-card-title"><b title={screenshot.originalFilename}>{screenshot.originalFilename}</b><button aria-label="Screenshot actions">⋮</button></div><span className="chip">{category}</span><div className="screenshot-date">{date}<span>{time}</span></div><div className="screenshot-card-status"><small className={screenshot.linkedToTrade ? "linked" : "not-linked"}>{screenshot.linkedToTrade && "● "}{screenshot.linkedToTrade ? "Linked to Trade" : "Not linked"}</small><span><small>{formatFileSize(screenshot.byteSize)}</small><button className={`favorite ${screenshot.favorite ? "selected" : ""}`} disabled={disabled} onClick={(event) => { event.stopPropagation(); onFavorite(screenshot); }} aria-label={screenshot.favorite ? "Remove from favorites" : "Add to favorites"}>{screenshot.favorite ? "★" : "☆"}</button></span></div></div></Card>;
}

function ScreenshotPagination({ count }) {
  return <div className="screenshot-pagination"><div><button disabled>‹</button><button className="active">1</button><button disabled>›</button></div><small>Showing {count} persisted image{count === 1 ? "" : "s"}</small></div>;
}

function ScreenshotTips() {
  return <div className="screenshot-tips"><div className="tips-intro"><span className="tips-icon">♧</span><div><b>Organize. Review. Improve.</b><p>Use folders and tags to keep your screenshots organized.<br />Revisit your analysis and track your growth over time.</p></div></div><div className="tips-list"><b>Tips:</b><span>✓　Link screenshots to trades for better context</span><span>✓　Review old analysis and compare with results</span><span>✓　Delete unnecessary images to keep it clean</span></div><div className="tips-illustration"><span>▰</span><b>▧</b></div></div>;
}

function DataState({ title, message, action }) {
  return <Card className="trade-data-state"><h2>{title}</h2><p>{message}</p>{action}</Card>;
}

function validateSelectedFile(file) {
  if (!file) return "Choose an image first.";
  if (file.size > MAX_FILE_SIZE) return "Screenshot must be 10 MB or smaller.";
  const supportedType = ["image/png", "image/jpeg", "image/jpg"].includes(String(file.type || "").toLowerCase());
  const supportedExtension = /\.(png|jpe?g)$/i.test(file.name);
  if (!supportedType && !supportedExtension) return "Please upload a PNG, JPG, or JPEG screenshot.";
  return null;
}

export default function Screenshots() {
  const { selectedAccountId } = useApplication();
  const fileInputRef = useRef(null);
  const [view, setView] = useState("grid");
  const [filters, setFilters] = useState({ folderId: "", tagId: "", timeRange: "", linked: "", search: "" });
  const [screenshots, setScreenshots] = useState([]);
  const [folders, setFolders] = useState([]);
  const [tags, setTags] = useState([]);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [mutatingId, setMutatingId] = useState(null);

  const loadData = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const [screenshotResult, folderResult, tagResult] = await Promise.all([
        screenshotService.list(),
        screenshotService.listFolders(),
        screenshotService.listTags(),
      ]);
      setScreenshots(Array.isArray(screenshotResult?.screenshots) ? screenshotResult.screenshots : []);
      setFolders(Array.isArray(folderResult?.folders) ? folderResult.folders : []);
      setTags(Array.isArray(tagResult?.tags) ? tagResult.tags : []);
      setStatus("ready");
    } catch (requestError) {
      setError(requestError);
      setStatus("error");
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const visibleScreenshots = useMemo(() => {
    const query = filters.search.trim().toLowerCase();
    const now = Date.now();
    return screenshots.filter((screenshot) => {
      const searchable = [screenshot.originalFilename, ...(screenshot.tags || []).map((tag) => tag.name), ...(screenshot.categories || []).map((category) => category.name)].join(" ").toLowerCase();
      const parsedTime = Date.parse(screenshot.uploadedAt);
      const matchesSearch = !query || searchable.includes(query);
      const matchesFolder = !filters.folderId || screenshot.folderId === filters.folderId;
      const matchesTag = !filters.tagId || screenshot.tags?.some((tag) => tag.id === filters.tagId);
      const matchesLink = !filters.linked || (filters.linked === "linked" ? screenshot.linkedToTrade : !screenshot.linkedToTrade);
      const matchesTime = !filters.timeRange || (filters.timeRange === "month" ? isThisMonth(screenshot.uploadedAt) : Number.isFinite(parsedTime) && now - parsedTime <= 7 * 24 * 60 * 60 * 1000);
      return matchesSearch && matchesFolder && matchesTag && matchesLink && matchesTime;
    });
  }, [filters.folderId, filters.linked, filters.search, filters.tagId, filters.timeRange, screenshots]);

  const createFolder = async () => {
    const name = window.prompt("Folder name");
    if (!name?.trim()) return;
    setError(null);
    try {
      await screenshotService.createFolder({ name: name.trim() });
      await loadData();
    } catch (requestError) {
      setError(requestError);
    }
  };

  const uploadScreenshot = async (file) => {
    const validationError = validateSelectedFile(file);
    if (validationError) {
      setError(new Error(validationError));
      return;
    }
    setUploading(true);
    setError(null);
    try {
      await screenshotService.upload(file, { folderId: filters.folderId || null });
      await loadData();
    } catch (requestError) {
      setError(requestError);
    } finally {
      setUploading(false);
    }
  };

  const toggleFavorite = async (screenshot) => {
    setMutatingId(screenshot.id);
    setError(null);
    try {
      await screenshotService.update(screenshot.id, { favorite: !screenshot.favorite }, screenshot.version);
      await loadData();
    } catch (requestError) {
      setError(requestError);
    } finally {
      setMutatingId(null);
    }
  };

  return <><PageHeader title="▧ Screenshots" sub="Store and organize your trading charts, analysis and notes."><Button onClick={() => fileInputRef.current?.click()} disabled={uploading}>{uploading ? "Uploading..." : "♧ Upload Screenshot"}</Button><Button primary onClick={createFolder}>＋ New Folder</Button></PageHeader><input ref={fileInputRef} hidden type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" onChange={(event) => { uploadScreenshot(event.target.files[0]); event.target.value = ""; }} />{!selectedAccountId && <div className="trade-form-message">No active account is selected. Screenshots remain available; trade linking is unavailable until an account is selected.</div>}{error && <div className="trade-form-message error" role="alert">{error.message || "The screenshot request failed."} <Button onClick={loadData}>Retry</Button></div>}{status === "loading" && <DataState title="Loading screenshots" message="Reading persisted media from the local workspace." />}{status === "error" && <DataState title="Unable to load screenshots" message="The persisted screenshot library could not be loaded." action={<Button onClick={loadData}>Retry</Button>} />}{status === "ready" && <><ScreenshotStats screenshots={screenshots} folders={folders} /><ScreenshotFilters filters={filters} setFilters={setFilters} view={view} setView={setView} folders={folders} tags={tags} disabled={uploading || Boolean(mutatingId)} /><FolderSection folders={folders} screenshots={screenshots} selectedFolderId={filters.folderId} onSelect={(folderId) => setFilters((current) => ({ ...current, folderId }))} onCreate={createFolder} /><div className="section-title all-screenshots-title"><h2>All Screenshots <span className="muted">({visibleScreenshots.length})</span></h2><span className="sort-control">Sort by:　<b>Newest First⌄</b></span></div>{visibleScreenshots.length ? <div className={view === "grid" ? "screenshot-gallery" : "screenshot-gallery list-view"}>{visibleScreenshots.map((screenshot) => <ScreenshotCard key={screenshot.id} screenshot={screenshot} onFavorite={toggleFavorite} disabled={mutatingId === screenshot.id} />)}</div> : <DataState title="No screenshots yet" message="Upload a PNG or JPG screenshot to start your persisted library." action={<Button onClick={() => fileInputRef.current?.click()}>Upload Screenshot</Button>} />}<ScreenshotPagination count={visibleScreenshots.length} /><ScreenshotTips /></>}</>;
}
