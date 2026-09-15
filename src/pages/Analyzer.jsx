import React, { useEffect, useRef, useState } from "react";
import Button from "../components/common/Button";
import Card from "../components/common/Card";
import {
  categoryDefinitions,
  screenshotFolders,
  tradeRows,
} from "../data/mockData";
import { navigate } from "../lib/navigation";
import { analyzeScreenshot } from "../services/analyzerService";
import { analysisPersistenceService } from "../services/analysisPersistenceService";
import { analysisSteps, createAnalysisProgress } from "../services/analyzerProgress";
import { screenshotService } from "../services/screenshotService";
import { normalizeAnalysisResult } from "../utils/normalizeAnalysisResult";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const TIMEFRAME_OPTIONS = ["1m", "3m", "5m", "15m", "30m", "1H", "2H", "4H", "Daily", "Weekly"];
const PRIMARY_RECOMMENDATION_STYLES = ["SCALP", "INTRADAY", "SWING"];
const DEFAULT_TIMEFRAME = "15m";

function initialProgress() {
  return analysisSteps.map((label) => ({ label, status: "pending" }));
}

function initialOrganization() {
  return {
    folderId: null,
    selectedCategoryIds: [],
    tags: [],
    linkedTradeId: null,
  };
}

function formatFileSize(sizeBytes) {
  if (sizeBytes < 1024 * 1024) return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatConfidence(value) {
  return `${Math.round((Number(value) || 0) * 100)}%`;
}

function getTradeId(trade, index) {
  return trade.id || `${trade.pair}-${trade.date}-${trade.time}-${index}`;
}

function makeScreenshotEntry(uploadedFile, timeframe, id = "primary") {
  return {
    id,
    timeframe,
    file: uploadedFile,
    addedAt: new Date().toISOString(),
  };
}

function makePersistedScreenshotEntry(membership, uploadedFile = null) {
  return {
    id: membership.mediaId,
    timeframe: membership.timeframe,
    file: uploadedFile,
    addedAt: membership.addedAt,
    unavailable: Boolean(membership.media?.unavailable) || !uploadedFile,
  };
}

function normalizePersistedReport(report, previousReport, screenshots) {
  const result = normalizeAnalysisResult(report.result || {});
  return {
    id: report.id,
    version: report.versionNumber,
    timeframes: Array.isArray(report.timeframesUsed) ? report.timeframesUsed : [],
    modelVersion: report.modelId,
    analyzedAt: report.analyzedAt,
    result,
    analysisChanges: buildAnalysisChanges(previousReport, result, screenshots),
  };
}

async function loadPersistedScreenshot(membership) {
  if (!membership?.media || membership.media.unavailable) return null;
  const response = await fetch(screenshotService.contentUrl(membership.mediaId));
  if (!response.ok) return null;
  const blob = await response.blob();
  const file = new File([blob], membership.media.originalFilename || "chart.png", { type: membership.media.mimeType || blob.type || "image/png" });
  return normalizeUploadedFile(file);
}

function getAvailableTimeframes(entries) {
  const used = new Set(entries.map((entry) => entry.timeframe));
  return TIMEFRAME_OPTIONS.filter((timeframe) => !used.has(timeframe));
}

function getRecommendation(recommendations, style) {
  return (recommendations || []).find((recommendation) => recommendation.style === style) || null;
}

function comparableRecommendation(recommendation) {
  if (!recommendation) return null;
  return {
    action: recommendation.action,
    confidence: Math.round((Number(recommendation.confidence) || 0) * 20) / 20,
    timeframeContext: recommendation.timeframeContext,
    setupType: recommendation.setupType,
    entry: recommendation.entry,
    stopLoss: recommendation.stopLoss,
    takeProfits: recommendation.takeProfits,
    riskReward: recommendation.riskReward,
    reasons: recommendation.reasons,
    invalidation: recommendation.invalidation,
    risks: recommendation.risks,
    summary: recommendation.summary,
  };
}

function recommendationChanged(previous, current) {
  return JSON.stringify(comparableRecommendation(previous)) !== JSON.stringify(comparableRecommendation(current));
}

function recommendationStatus(previous, current) {
  if (!previous && current) return "NEW";
  if (!current && previous) return "INVALIDATED";
  if (!previous || !current) return "UNCHANGED";
  if (["BUY", "SELL"].includes(previous.action) && ["BUY", "SELL"].includes(current.action) && previous.action !== current.action) {
    return "REVERSED";
  }
  if (["BUY", "SELL"].includes(previous.action) && ["WAIT", "NO_TRADE"].includes(current.action)) {
    return "INVALIDATED";
  }
  return recommendationChanged(previous, current) ? "UPDATED" : "UNCHANGED";
}

function buildRecommendationHistories(reports) {
  const histories = Object.fromEntries(PRIMARY_RECOMMENDATION_STYLES.map((style) => [style, []]));
  for (const report of reports) {
    for (const style of PRIMARY_RECOMMENDATION_STYLES) {
      const current = getRecommendation(report.result?.tradeRecommendations, style);
      const previousEntry = histories[style][histories[style].length - 1];
      const status = recommendationStatus(previousEntry?.recommendation || null, current);
      if (status !== "UNCHANGED") {
        histories[style].push({
          reportVersion: report.version,
          recommendation: current,
          status,
        });
      }
    }
  }
  return histories;
}

function getHistoryEntryForReport(history, reportVersion) {
  let selected = null;
  history.forEach((entry, index) => {
    if (entry.reportVersion <= reportVersion) selected = { ...entry, historyIndex: index };
  });
  return selected;
}

function buildAnalysisChanges(previousReport, currentResult, screenshots) {
  if (!previousReport) return null;
  const previousResult = previousReport.result || {};
  const previousTrend = previousResult.mainTrendAnalysis || {};
  const currentTrend = currentResult.mainTrendAnalysis || {};
  const items = [];

  if (previousTrend.trend !== currentTrend.trend) {
    items.push(`Main trend changed from ${previousTrend.trend || "not available"} to ${currentTrend.trend || "not available"}.`);
  }
  if (previousTrend.strength !== currentTrend.strength) {
    items.push(`Trend strength changed from ${previousTrend.strength || "not available"} to ${currentTrend.strength || "not available"}.`);
  }
  if (Math.abs((Number(previousTrend.confidence) || 0) - (Number(currentTrend.confidence) || 0)) >= 0.05) {
    items.push(`Trend confidence moved from ${formatConfidence(previousTrend.confidence)} to ${formatConfidence(currentTrend.confidence)}.`);
  }

  const previousTimeframes = new Set((previousReport.timeframes || []).map((timeframe) => timeframe));
  const addedTimeframes = screenshots.map((screenshot) => screenshot.timeframe).filter((timeframe) => !previousTimeframes.has(timeframe));
  if (addedTimeframes.length) items.push(`New timeframe evidence added: ${addedTimeframes.join(", ")}.`);

  const recommendationChanges = PRIMARY_RECOMMENDATION_STYLES
    .map((style) => {
      const previous = getRecommendation(previousResult.tradeRecommendations, style);
      const current = getRecommendation(currentResult.tradeRecommendations, style);
      const status = recommendationStatus(previous, current);
      return status === "UNCHANGED" ? null : { style, status };
    })
    .filter(Boolean);
  recommendationChanges.forEach(({ style, status }) => items.push(`${style} recommendation: ${status}.`));

  const conflicts = currentResult.timeframeEvidence?.conflicts || [];
  conflicts.forEach((conflict) => items.push(`Timeframe conflict: ${conflict}`));
  if (!items.length) items.push("No material changes detected; the current report remains aligned with the previous version.");

  return {
    items,
    addedTimeframes,
    recommendationChanges,
    conflicts,
    alignmentSummary: currentResult.timeframeEvidence?.alignmentSummary || "",
  };
}

function getImageDimensions(previewUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("The selected image could not be read."));
    image.src = previewUrl;
  });
}

async function normalizeUploadedFile(file) {
  if (!file) return null;
  const isSupportedType = ["image/png", "image/jpeg"].includes(file.type);
  const isSupportedExtension = /\.(png|jpe?g)$/i.test(file.name);
  if (!isSupportedType && !isSupportedExtension) {
    throw new Error("Please upload a PNG, JPG, or JPEG screenshot.");
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new Error("Screenshot must be 10 MB or smaller.");
  }

  const previewUrl = URL.createObjectURL(file);
  try {
    const dimensions = await getImageDimensions(previewUrl);
    return {
      file,
      filename: file.name,
      previewUrl,
      mimeType: file.type || (file.name.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg"),
      sizeBytes: file.size,
      width: dimensions.width,
      height: dimensions.height,
    };
  } catch (error) {
    URL.revokeObjectURL(previewUrl);
    throw error;
  }
}

function AnalyzerHeader({ onBack, onClose }) {
  return (
    <header className="analyzer-header">
      <div className="analyzer-title-wrap">
        <button className="analyzer-back" onClick={onBack} aria-label="Back to Screenshots">
          ←
        </button>
        <div>
          <h1>Upload &amp; Analyze Screenshot</h1>
          <p>Our AI will analyze your chart and help you organize it.</p>
        </div>
      </div>
      <div className="analyzer-header-actions">
        <button className="analyzer-close" onClick={onClose} aria-label="Close Analyzer">
          ×
        </button>
      </div>
    </header>
  );
}

function AnalyzerStepper({ analysisStatus }) {
  const currentStep = analysisStatus === "idle" || analysisStatus === "ready" ? 0 : analysisStatus === "analyzing" ? 1 : 2;
  const steps = [
    ["Upload", "Add your screenshot"],
    ["AI Analysis", analysisStatus === "analyzing" ? "Analyzing your chart" : "Analyze your chart"],
    ["Review", "Review and organize"],
  ];

  return (
    <div className="analyzer-stepper">
      {steps.map(([title, description], index) => (
        <React.Fragment key={title}>
          <div className={`analyzer-step ${index === currentStep ? "active" : ""} ${index < currentStep ? "complete" : ""}`}>
            <span>{index < currentStep ? "✓" : index + 1}</span>
            <div><strong>{title}</strong><small>{description}</small></div>
          </div>
          {index < steps.length - 1 && <span className="analyzer-step-arrow">→</span>}
        </React.Fragment>
      ))}
    </div>
  );
}

function ScreenshotUploader({ file, error, onFileSelected, zoom }) {
  const inputRef = useRef(null);
  const openPicker = () => inputRef.current?.click();

  const handleDrop = (event) => {
    event.preventDefault();
    onFileSelected(event.dataTransfer.files[0]);
  };

  if (!file) {
    return (
      <Card className="analyzer-upload-card">
        <h2>Upload Screenshot</h2>
        <div className="analyzer-empty-upload" onClick={openPicker} onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
          <span className="analyzer-upload-icon">▧</span>
          <strong>Drop chart screenshot here</strong>
          <span>or click to browse</span>
          <small>PNG, JPG/JPEG up to 10MB</small>
        </div>
        <input
          ref={inputRef}
          accept="image/png,image/jpeg,.png,.jpg,.jpeg"
          hidden
          onChange={(event) => {
            onFileSelected(event.target.files[0]);
            event.target.value = "";
          }}
          type="file"
        />
        {error && <div className="analyzer-upload-error">{error}</div>}
      </Card>
    );
  }

  return (
    <Card className="analyzer-upload-card analyzer-preview-card">
      <div className="analyzer-card-heading">
        <h2>Uploaded Screenshot</h2>
        <button className="analyzer-replace" onClick={openPicker}>▣ Replace Image</button>
      </div>
      <input
        ref={inputRef}
        accept="image/png,image/jpeg,.png,.jpg,.jpeg"
        hidden
        onChange={(event) => {
          onFileSelected(event.target.files[0]);
          event.target.value = "";
        }}
        type="file"
      />
      <div className="analyzer-file-summary">
        <img src={file.previewUrl} alt="Uploaded screenshot thumbnail" />
        <div>
          <strong>{file.filename}</strong>
          <span>{file.mimeType.replace("image/", "").toUpperCase()} · {formatFileSize(file.sizeBytes)} · {file.width} × {file.height}</span>
        </div>
      </div>
      <div className="analyzer-preview-frame">
        <img src={file.previewUrl} alt="Uploaded trading chart" style={{ "--analyzer-zoom": zoom }} />
      </div>
    </Card>
  );
}

function TimeframeSelector({ value, onChange, entries = [], disabled = false }) {
  const used = new Set(entries.map((entry) => entry.timeframe));
  return (
    <div className="analyzer-timeframe-selector">
      <div>
        <strong>Chart timeframe</strong>
        <span>Assign the exact timeframe shown in this screenshot.</span>
      </div>
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        {TIMEFRAME_OPTIONS.map((timeframe) => (
          <option key={timeframe} value={timeframe} disabled={used.has(timeframe) && timeframe !== value}>
            {timeframe}{used.has(timeframe) && timeframe !== value ? " (already added)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

function TimeframeContext({ screenshots, analysis, onAddChart }) {
  const evidence = analysis.timeframeEvidence || {};
  const provided = Array.isArray(evidence.provided) ? evidence.provided : [];
  const unavailable = Array.isArray(evidence.unavailable) ? evidence.unavailable : [];
  const conflicts = Array.isArray(evidence.conflicts) ? evidence.conflicts : [];
  const requested = Array.isArray(analysis.additionalContextRequested) ? analysis.additionalContextRequested : [];
  const available = getAvailableTimeframes(screenshots);

  return (
    <Card className="analyzer-timeframe-card">
      <div className="analyzer-timeframe-heading">
        <div>
          <h2>Timeframe Context</h2>
          <p>Evidence included in this report: {screenshots.length} timeframe{screenshots.length === 1 ? "" : "s"}.</p>
        </div>
        <button className="analyzer-add-chart-button" onClick={() => onAddChart(available[0] || "")} disabled={!available.length}>
          ＋ Add Chart
        </button>
      </div>
      <div className="analyzer-timeframe-chips">
        {screenshots.map((screenshot) => {
          const item = provided.find((entry) => entry.timeframe === screenshot.timeframe);
          return (
            <div className="analyzer-timeframe-chip" key={screenshot.id}>
              <strong>{screenshot.timeframe}</strong>
              <span className={screenshot.unavailable ? "unavailable" : ""}>{screenshot.unavailable ? "Source unavailable" : "✓ Analyzed"}</span>
              {item?.summary && <small>{item.summary}</small>}
            </div>
          );
        })}
      </div>
      {evidence.alignmentSummary && <p className="analyzer-timeframe-alignment">{evidence.alignmentSummary}</p>}
      {conflicts.length > 0 && (
        <div className="analyzer-timeframe-conflicts">
          <strong>Conflicts to review</strong>
          {conflicts.map((conflict, index) => <span key={`${conflict}-${index}`}>{conflict}</span>)}
        </div>
      )}
      {unavailable.length > 0 && (
        <div className="analyzer-timeframe-unavailable">
          <strong>Unavailable context</strong>
          <span>{unavailable.join(" · ")}</span>
        </div>
      )}
      {(requested.length > 0 || available.length > 0) && (
        <div className="analyzer-context-requests">
          <div>
            <strong>Improve confidence</strong>
            <span>Add another timeframe when useful.</span>
          </div>
          <div className="analyzer-context-request-list">
            {requested.map((request) => (
              <button key={`${request.timeframe}-${request.reason}`} onClick={() => onAddChart(request.timeframe)} disabled={screenshots.some((screenshot) => screenshot.timeframe === request.timeframe)}>
                <b>＋ Add {request.timeframe}</b><small>{request.reason}</small>
              </button>
            ))}
            {requested.length === 0 && available.slice(0, 3).map((timeframe) => (
              <button key={timeframe} onClick={() => onAddChart(timeframe)}>
                <b>＋ Add {timeframe}</b><small>Review this timeframe as additional context.</small>
              </button>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function AddChartPanel({ open, timeframe, availableTimeframes, file, error, analyzing, onTimeframeChange, onFileSelected, onCancel, onConfirm }) {
  const inputRef = useRef(null);
  if (!open) return null;
  const timeframeOptions = timeframe && !availableTimeframes.includes(timeframe)
    ? [timeframe, ...availableTimeframes]
    : availableTimeframes;
  return (
    <Card className="add-chart-panel">
      <div className="add-chart-heading">
        <div>
          <h2>Add timeframe evidence</h2>
          <p>Upload another chart to continue the current analysis session.</p>
        </div>
        <button className="analyzer-close-inline" onClick={onCancel} aria-label="Close add chart panel">×</button>
      </div>
      <div className="add-chart-fields">
        <label>
          <span>Timeframe</span>
          <select value={timeframe} onChange={(event) => onTimeframeChange(event.target.value)} disabled={analyzing}>
            <option value="">Choose timeframe</option>
            {timeframeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <div className="add-chart-file-picker">
          <span>Chart screenshot</span>
          <button onClick={() => inputRef.current?.click()} disabled={analyzing}>Choose PNG or JPG</button>
          <input
            ref={inputRef}
            hidden
            accept="image/png,image/jpeg,.png,.jpg,.jpeg"
            type="file"
            onChange={(event) => {
              onFileSelected(event.target.files[0]);
              event.target.value = "";
            }}
          />
          {file && (
            <div className="add-chart-file-preview">
              <img src={file.previewUrl} alt="Additional chart preview" />
              <span>{file.filename}</span>
            </div>
          )}
        </div>
      </div>
      {error && <div className="analyzer-upload-error">{error}</div>}
      <div className="add-chart-actions">
        <span>This chart will be analyzed together with the existing evidence.</span>
        <div>
          <button onClick={onCancel} disabled={analyzing}>Cancel</button>
          <Button primary disabled={!file || !timeframe || analyzing} onClick={onConfirm}>{analyzing ? "Analyzing…" : "Analyze & Update"}</Button>
        </div>
      </div>
    </Card>
  );
}

function ReportNavigator({ reports, currentIndex, onSelect, onLatest }) {
  if (reports.length === 0) return null;
  const current = reports[currentIndex] || reports[reports.length - 1];
  const isLatest = currentIndex === reports.length - 1;
  return (
    <div className="report-navigator">
      <div>
        <strong>Analysis report</strong>
        <span>Version {current.version} of {reports.length} · {current.timeframes.join(" + ")}</span>
      </div>
      <div className="report-navigator-actions">
        <button onClick={() => onSelect(currentIndex - 1)} disabled={currentIndex <= 0} aria-label="Previous analysis report">←</button>
        <span>{isLatest ? "Latest" : "Historical"}</span>
        <button onClick={() => onSelect(currentIndex + 1)} disabled={isLatest} aria-label="Next analysis report">→</button>
        {!isLatest && <button className="report-latest-button" onClick={onLatest}>View latest</button>}
      </div>
    </div>
  );
}

function AnalysisChanges({ changes }) {
  if (!changes) return null;
  return (
    <section className="analyzer-section analysis-changes-section">
      <div className="analysis-changes-heading">
        <div>
          <h3>What Changed</h3>
          <p>Deterministic comparison with the previous validated report.</p>
        </div>
        <span>{changes.addedTimeframes.length ? `+${changes.addedTimeframes.length} timeframe` : "Compared"}</span>
      </div>
      <ul>
        {changes.items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
      </ul>
    </section>
  );
}

function ViewerControls({ zoom, setZoom }) {
  return (
    <div className="analyzer-viewer-controls">
      <button onClick={() => setZoom((value) => Math.max(0.75, value - 0.25))} aria-label="Zoom out">−</button>
      <button onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
      <button onClick={() => setZoom((value) => Math.min(2, value + 0.25))} aria-label="Zoom in">＋</button>
    </div>
  );
}

function AnalysisProgress({ status, progress, error }) {
  const processingIndex = progress.findIndex((step) => step.status === "processing");
  const completedCount = progress.filter((step) => step.status === "complete").length;
  const percent = status === "completed" ? 100 : status === "analyzing" ? Math.max(8, Math.round(((completedCount + (processingIndex >= 0 ? 0.65 : 0)) / progress.length) * 100)) : 0;
  const title = status === "analyzing" ? "AI Analysis in Progress..." : status === "error" ? "AI Analysis Error" : status === "completed" ? "AI Analysis Complete" : "Ready to Analyze";

  return (
    <Card className={`analyzer-progress-card analyzer-progress-${status}`}>
      <div className="analyzer-progress-heading">
        <div><h2><span className="analyzer-spinner">◌</span> {title}</h2><p>{status === "error" ? error : "Analyzing chart patterns, structure, levels and context."}</p></div>
        <span className="analyzer-status-pill">{status === "analyzing" ? `${percent}%` : status === "error" ? "Failed" : status === "completed" ? "Complete" : "Waiting"}</span>
      </div>
      <div className="analyzer-progress-list">
        {progress.map((step) => (
          <div className="analyzer-progress-row" key={step.label}>
            <span className={`progress-status progress-${step.status}`}>{step.status === "complete" ? "✓" : step.status === "processing" ? "◌" : step.status === "error" ? "×" : "○"}</span>
            <span>{step.label}</span>
            <small>{step.status === "complete" ? "Done" : step.status === "processing" ? `${percent}%` : step.status === "error" ? "Error" : "Waiting"}</small>
          </div>
        ))}
      </div>
      <div className="analyzer-progress-track"><i style={{ width: `${percent}%` }} /></div>
    </Card>
  );
}

function AnalyzerNotice({ status, onAnalyze }) {
  if (status === "analyzing") {
    return (
      <div className="analyzer-notice">
        <span>✦</span>
        <p>
          Our AI is analyzing your chart. This may take a few seconds.
          <br />
          You can review and edit the results before continuing.
        </p>
      </div>
    );
  }
  if (status === "completed") {
    return (
      <div className="analyzer-notice analyzer-notice-success">
        <span>✓</span>
        <p>Analysis is ready for review. Check the detected information and organize your screenshot before continuing.</p>
      </div>
    );
  }
  return (
    <div className="analyzer-action-panel">
      <div>
        <strong>{status === "ready" ? "Screenshot ready" : "Start with a chart screenshot"}</strong>
        <p>{status === "ready" ? "Run the analyzer to detect patterns, levels and context." : "Upload a PNG or JPG chart to begin your analysis."}</p>
      </div>
      <Button primary disabled={status !== "ready"} onClick={onAnalyze}>
        ✦ Analyze Screenshot
      </Button>
    </div>
  );
}

function EmptyResults({ hasFile, status }) {
  const message = hasFile
    ? status === "analyzing"
      ? "Your chart is being analyzed. Results will appear here when complete."
      : "Click Analyze Screenshot to generate structured chart observations."
    : "Upload a screenshot to see structured AI observations here.";

  return (
    <Card className="analyzer-results-placeholder">
      <div className="analyzer-placeholder-icon">✦</div>
      <h2>AI Analysis Results</h2>
      <p>{message}</p>
    </Card>
  );
}

function SessionDiscoveryPanel({ sessions, status, error, resumingSessionId, onResume, onStartNew }) {
  if (status === "loading") {
    return <Card className="analyzer-session-discovery"><strong>Loading saved analyses…</strong><span>Checking for resumable Analyzer sessions.</span></Card>;
  }
  if (status === "error") {
    return <Card className="analyzer-session-discovery analyzer-session-discovery-error"><strong>Saved analyses unavailable</strong><span>{error || "Start a new analysis or try again later."}</span><button onClick={onStartNew}>Start New Analysis</button></Card>;
  }
  if (!sessions.length) return null;
  return (
    <Card className="analyzer-session-discovery">
      <div className="analyzer-session-discovery-heading">
        <div>
          <h2>Continue an Analysis</h2>
          <p>Resume a saved session or start a separate analysis with a new chart.</p>
        </div>
        <button onClick={onStartNew}>Start New</button>
      </div>
      <div className="analyzer-session-list">
        {sessions.slice(0, 5).map((session) => (
          <button key={session.id} onClick={() => onResume(session.id)} disabled={Boolean(resumingSessionId)}>
            <span><strong>{session.instrument || "Chart Analysis"}</strong><small>{session.primaryTimeframe || "Timeframe pending"} · {session.status}</small></span>
            <b>{resumingSessionId === session.id ? "Loading…" : "Resume →"}</b>
          </button>
        ))}
      </div>
      {error && <span className="analyzer-session-inline-error">{error}</span>}
    </Card>
  );
}

function CategoryToken({ category, onRemove }) {
  return (
    <span className="analyzer-token">
      {category.name}
      <button onClick={onRemove} aria-label={`Remove ${category.name}`}>
        ×
      </button>
    </span>
  );
}

function DetectedCategories({ analysis, organization, setOrganization }) {
  const toggleCategory = (categoryId) => {
    setOrganization((current) => ({
      ...current,
      selectedCategoryIds: current.selectedCategoryIds.includes(categoryId)
        ? current.selectedCategoryIds.filter((id) => id !== categoryId)
        : [...current.selectedCategoryIds, categoryId],
    }));
  };

  return (
    <section className="analyzer-section detected-categories">
      <h3>Detected Categories ({analysis.detectedCategories.length})</h3>
      <div className="detected-category-grid">
        {analysis.detectedCategories.map((category) => {
          const selected = organization.selectedCategoryIds.includes(category.categoryId);
          return (
            <button
              className={`detected-category ${selected ? "selected" : ""}`}
              key={category.categoryId || category.name}
              onClick={() => toggleCategory(category.categoryId)}
            >
              <span className="detected-category-icon">{category.name.slice(0, 1)}</span>
              <strong>{category.name}</strong>
              <em>{formatConfidence(category.confidence)}</em>
              <small>{selected ? "Selected" : "Add"}</small>
            </button>
          );
        })}
      </div>
      <h3 className="suggested-title">All Suggested Categories</h3>
      <div className="suggested-category-list">
        {analysis.suggestedCategories.map((category) => {
          const selected = organization.selectedCategoryIds.includes(category.categoryId);
          return (
            <button
              className={selected ? "selected" : ""}
              disabled={selected}
              key={category.categoryId || category.name}
              onClick={() => toggleCategory(category.categoryId)}
            >
              {category.name}
              {selected ? " ✓" : " +"}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function PatternAnalysis({ analysis }) {
  const { patternAnalysis } = analysis;
  if (!patternAnalysis.primaryPattern && !patternAnalysis.summary) return null;
  return (
    <section className="analyzer-section pattern-analysis-section">
      <h3>✦ Pattern Analysis</h3>
      <div className="pattern-title">
        <span>⌁</span>
        <strong>{patternAnalysis.primaryPattern || "Pattern not detected"}</strong>
        <em>{formatConfidence(patternAnalysis.confidence)} Confidence</em>
      </div>
      {patternAnalysis.summary && <p>{patternAnalysis.summary}</p>}
      {patternAnalysis.observations.length > 0 && (
        <ul>
          {patternAnalysis.observations.map((observation) => (
            <li key={observation}>{observation}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function KeyLevels({ analysis }) {
  if (!analysis.keyLevels.length) return null;
  return (
    <section className="analyzer-section key-levels-section">
      <h3>Key Levels</h3>
      <div className="key-level-list">
        {analysis.keyLevels.map((level) => (
          <div className="key-level-row" key={level.id}>
            <span className={`level-dot ${level.type}`} />
            <span>{level.label}</span>
            <strong>{level.priceLow && level.priceHigh ? `${level.priceLow} – ${level.priceHigh}` : level.price || "Not available"}</strong>
          </div>
        ))}
      </div>
      <button className="analyzer-inline-link">◉ Show on Chart</button>
    </section>
  );
}

function MarketContext({ analysis }) {
  const context = [
    ["Trend", analysis.marketContext.trend || analysis.marketStructure.trend, "↗"],
    ["Timeframe", analysis.marketContext.timeframe, "◷"],
    ["Instrument", analysis.marketContext.instrument, "◎"],
    ["Session", analysis.marketContext.session, "▥"],
  ].filter((item) => item[1]);
  if (!context.length) return null;
  return (
    <section className="analyzer-section market-context-section">
      <h3>Market Context</h3>
      <div className="market-context-grid">
        {context.map(([label, value, icon]) => (
          <div className="market-context-item" key={label}>
            <span>{icon}</span>
            <div>
              <small>{label}</small>
              <strong>{value}</strong>
            </div>
          </div>
        ))}
      </div>
      {(analysis.marketStructure.bias || analysis.marketStructure.structure) && (
        <div className="structure-summary">
          <span>Bias: <b>{analysis.marketStructure.bias || "Not available"}</b></span>
          <span>Structure: <b>{analysis.marketStructure.structure || "Not available"}</b></span>
        </div>
      )}
    </section>
  );
}

function MainTrendAnalysis({ analysis }) {
  const trendAnalysis = analysis.mainTrendAnalysis || {};
  const metrics = [
    ["Strength", trendAnalysis.strength],
    ["Structure", trendAnalysis.structure],
    ["Momentum", trendAnalysis.momentum],
    ["Market Phase", trendAnalysis.phase],
  ].filter(([, value]) => value);

  return (
    <section className="analyzer-section main-trend-analysis">
      <div className="main-trend-heading">
        <div>
          <h3>⌁ Main Trend Analysis</h3>
          <p>High-level technical read from the visible chart structure.</p>
        </div>
        <div className="main-trend-badges">
          {trendAnalysis.trend && (
            <span className={`trend-badge trend-${trendAnalysis.trend.toLowerCase()}`}>
              {trendAnalysis.trend}
            </span>
          )}
          <span className="trend-confidence">{formatConfidence(trendAnalysis.confidence)} confidence</span>
        </div>
      </div>

      {metrics.length > 0 && (
        <div className="main-trend-metrics">
          {metrics.map(([label, value]) => (
            <div key={label}>
              <small>{label}</small>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      )}

      {(trendAnalysis.keySupport.length > 0 || trendAnalysis.keyResistance.length > 0) && (
        <div className="trend-level-groups">
          {trendAnalysis.keySupport.length > 0 && (
            <div className="trend-level-group support-level-group">
              <small>Key Support</small>
              <div>{trendAnalysis.keySupport.map((level, index) => <span key={`${level}-${index}`}>{level}</span>)}</div>
            </div>
          )}
          {trendAnalysis.keyResistance.length > 0 && (
            <div className="trend-level-group resistance-level-group">
              <small>Key Resistance</small>
              <div>{trendAnalysis.keyResistance.map((level, index) => <span key={`${level}-${index}`}>{level}</span>)}</div>
            </div>
          )}
        </div>
      )}

      {trendAnalysis.reasoning.length > 0 && (
        <div className="trend-reasoning">
          <h4>Trend Reasoning</h4>
          <ul>
            {trendAnalysis.reasoning.map((reason, index) => <li key={`${reason}-${index}`}>{reason}</li>)}
          </ul>
        </div>
      )}

      {trendAnalysis.invalidation && (
        <div className="trend-invalidation">
          <small>Trend Invalidation</small>
          <p>{trendAnalysis.invalidation}</p>
        </div>
      )}
      {trendAnalysis.summary && <p className="main-trend-summary">{trendAnalysis.summary}</p>}
    </section>
  );
}

function formatAction(action) {
  return String(action || "").replaceAll("_", " ");
}

function formatEntryZone(entry) {
  if (entry.low && entry.high) return `${entry.low} – ${entry.high}`;
  return entry.low || entry.high || "";
}

function RecommendationDetail({ label, value, note, className = "" }) {
  if (!value && !note) return null;
  return (
    <div className={`recommendation-detail ${className}`}>
      <small>{label}</small>
      {value && <strong>{value}</strong>}
      {note && <p>{note}</p>}
    </div>
  );
}

function TradeRecommendationCard({ recommendation, history, historyIndex, onHistoryChange, status }) {
  const entry = recommendation.entry || {};
  const stopLoss = recommendation.stopLoss || {};
  const entryZone = formatEntryZone(entry);
  const targets = (recommendation.takeProfits || []).filter((takeProfit) => takeProfit.price || takeProfit.reason);
  const actionClass = String(recommendation.action || "no_trade").toLowerCase();

  return (
    <article className={`trade-recommendation-card recommendation-${actionClass}`}>
      <div className="recommendation-card-heading">
        <div>
          <span className="recommendation-style">{recommendation.style}</span>
          <h4>{recommendation.title}</h4>
        </div>
        <span className="recommendation-action">{formatAction(recommendation.action)}</span>
      </div>
      {history?.length > 0 && (
        <div className="recommendation-history-row">
          <span className={`recommendation-status recommendation-status-${String(status || "UNCHANGED").toLowerCase()}`}>{status || "UNCHANGED"}</span>
          <div className="recommendation-history-controls">
            <button onClick={() => onHistoryChange(historyIndex - 1)} disabled={historyIndex <= 0} aria-label={`Previous ${recommendation.style} recommendation version`}>←</button>
            <span>Revision {historyIndex + 1} of {history.length}</span>
            <button onClick={() => onHistoryChange(historyIndex + 1)} disabled={historyIndex >= history.length - 1} aria-label={`Next ${recommendation.style} recommendation version`}>→</button>
          </div>
        </div>
      )}
      <div className="recommendation-meta">
        <span>Confidence <b>{formatConfidence(recommendation.confidence)}</b></span>
        {recommendation.timeframeContext && <span>{recommendation.timeframeContext}</span>}
        {recommendation.setupType && <span>{recommendation.setupType}</span>}
      </div>

      {(entryZone || entry.type || entry.trigger) && (
        <div className="recommendation-detail-group">
          <RecommendationDetail label="Entry zone" value={entryZone || entry.type} />
          <RecommendationDetail label="Confirmation trigger" value={entry.trigger} />
        </div>
      )}

      <div className="recommendation-detail-group">
        <RecommendationDetail label="Stop loss" value={stopLoss.price} note={stopLoss.reason} />
        {targets.map((takeProfit, index) => (
          <RecommendationDetail
            className="take-profit-detail"
            key={`${takeProfit.label}-${index}`}
            label={takeProfit.label || `TP${index + 1}`}
            value={takeProfit.price}
            note={takeProfit.reason}
          />
        ))}
        <RecommendationDetail label="Risk / Reward" value={recommendation.riskReward} />
      </div>

      {recommendation.reasons.length > 0 && (
        <div className="recommendation-list-block">
          <h5>Why this setup?</h5>
          <ul>{recommendation.reasons.map((reason, index) => <li key={`${reason}-${index}`}>{reason}</li>)}</ul>
        </div>
      )}
      {recommendation.invalidation.length > 0 && (
        <div className="recommendation-list-block recommendation-invalidation-block">
          <h5>Invalidation</h5>
          <ul>{recommendation.invalidation.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>
        </div>
      )}
      {recommendation.risks.length > 0 && (
        <div className="recommendation-list-block recommendation-risks-block">
          <h5>Risks</h5>
          <ul>{recommendation.risks.map((risk, index) => <li key={`${risk}-${index}`}>{risk}</li>)}</ul>
        </div>
      )}
      {recommendation.summary && <p className="recommendation-summary">{recommendation.summary}</p>}
    </article>
  );
}

function TradeRecommendations({ analysis, currentReportVersion, recommendationHistories, recommendationSelections, onRecommendationHistoryChange }) {
  const recommendations = Array.isArray(analysis.tradeRecommendations) ? analysis.tradeRecommendations : [];
  if (recommendations.length === 0) return null;
  const primaryRecommendations = recommendations.filter((recommendation) => ["SCALP", "INTRADAY", "SWING"].includes(recommendation.style));
  const opportunities = recommendations.filter((recommendation) => recommendation.style === "AI_OPPORTUNITY");

  return (
    <section className="analyzer-section analyzer-recommendations-section">
      <div className="recommendations-heading">
        <div>
          <h3>✦ AI Trade Recommendations</h3>
          <p>Scenario-based chart decisions, not guaranteed outcomes or financial advice.</p>
        </div>
      </div>
      <div className="trade-recommendations-grid">
        {primaryRecommendations.map((currentRecommendation) => {
          const history = recommendationHistories?.[currentRecommendation.style] || [];
          const currentEntry = getHistoryEntryForReport(history, currentReportVersion || 1);
          const selectedIndex = recommendationSelections?.[currentRecommendation.style] ?? currentEntry?.historyIndex ?? Math.max(0, history.length - 1);
          const selectedEntry = history[selectedIndex] || currentEntry;
          const recommendation = selectedEntry?.recommendation || currentRecommendation;
          const status = selectedEntry?.reportVersion === currentReportVersion ? selectedEntry.status : selectedEntry ? "UNCHANGED" : "NEW";
          return (
            <TradeRecommendationCard
              key={currentRecommendation.style}
              recommendation={recommendation}
              history={history}
              historyIndex={selectedEntry?.historyIndex ?? Math.max(0, history.length - 1)}
              status={status}
              onHistoryChange={(index) => onRecommendationHistoryChange(currentRecommendation.style, index)}
            />
          );
        })}
      </div>
      {opportunities.length > 0 && (
        <div className="ai-opportunities">
          <h4>Additional AI Opportunities</h4>
          <div className="trade-recommendations-grid">
            {opportunities.map((recommendation) => (
              <TradeRecommendationCard key={recommendation.id} recommendation={recommendation} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function hasTradeIdea(analysis) {
  return Object.values(analysis.tradeIdea || {}).some(Boolean);
}

function TradeIdea({ analysis }) {
  const { tradeIdea } = analysis;
  if (!hasTradeIdea(analysis)) return null;
  return (
    <section className="analyzer-section trade-idea-section">
      <h3>Trade Idea <small>AI extracted</small></h3>
      <div className="trade-idea-grid">
        {[
          ["Direction", tradeIdea.direction],
          ["Entry", tradeIdea.entry],
          ["Stop Loss", tradeIdea.stopLoss],
          ["Take Profit", tradeIdea.takeProfit],
          ["Risk / Reward", tradeIdea.riskReward],
        ]
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label}>
              <small>{label}</small>
              <strong>{value}</strong>
            </div>
          ))}
      </div>
    </section>
  );
}

function AIInsight({ analysis, onReanalyze }) {
  return (
    <section className="analyzer-insight">
      <h3>✦ AI Insight</h3>
      <p>{analysis.insight || "No additional insight was returned."}</p>
      {analysis.warnings.length > 0 && (
        <div className="analyzer-warnings">
          {analysis.warnings.map((warning) => (
            <span key={warning}>! {warning}</span>
          ))}
        </div>
      )}
      {onReanalyze && (
        <div className="analyzer-insight-actions">
          <button onClick={onReanalyze}>↻ Re-analyze</button>
          <span>{analysis.modelVersion} · v{analysis.analysisVersion}</span>
        </div>
      )}
    </section>
  );
}

function OrganizationPanel({
  analysis,
  organization,
  setOrganization,
  onReset,
  analysisFeedback,
  setAnalysisFeedback,
}) {
  const [tagDraft, setTagDraft] = useState("");
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const addTag = () => {
    const tag = tagDraft.trim();
    if (!tag || organization.tags.includes(tag)) return;
    setOrganization((current) => ({ ...current, tags: [...current.tags, tag] }));
    setTagDraft("");
  };
  const addSuggestedTag = (tag) => {
    if (organization.tags.includes(tag)) return;
    setOrganization((current) => ({ ...current, tags: [...current.tags, tag] }));
  };
  const removeCategory = (categoryId) => {
    setOrganization((current) => ({
      ...current,
      selectedCategoryIds: current.selectedCategoryIds.filter((id) => id !== categoryId),
    }));
  };
  const handleCategorySelect = (event) => {
    const categoryId = event.target.value;
    if (!categoryId) return;
    setOrganization((current) => ({
      ...current,
      selectedCategoryIds: [...current.selectedCategoryIds, categoryId],
    }));
    setCategoryPickerOpen(false);
  };
  const removeTag = (tag) => {
    setOrganization((current) => ({
      ...current,
      tags: current.tags.filter((item) => item !== tag),
    }));
  };
  const manualCategories = categoryDefinitions.map((category) => ({
    categoryId: category.id,
    name: category.name,
    source: "user",
    confidence: 0,
  }));
  const selectedCategories = [
    ...analysis.detectedCategories,
    ...analysis.suggestedCategories,
    ...manualCategories,
  ].filter(
    (category, index, list) =>
      organization.selectedCategoryIds.includes(category.categoryId) &&
      list.findIndex((item) => item.categoryId === category.categoryId) === index,
  );
  const availableCategories = categoryDefinitions.filter(
    (category) => !organization.selectedCategoryIds.includes(category.id),
  );

  return (
    <Card className="analyzer-organization">
      <div className="organization-heading">
        <h2>Organize Screenshot</h2>
        <span>Review &amp; Organize</span>
      </div>
      <div className="analyzer-organization-top-grid">
        <div>
          <label className="analyzer-field-label" htmlFor="analyzer-folder">Folder</label>
          <select
            id="analyzer-folder"
            className="field analyzer-select"
            value={organization.folderId || ""}
            onChange={(event) =>
              setOrganization((current) => ({
                ...current,
                folderId: event.target.value || null,
              }))
            }
          >
            <option value="">No Folder</option>
            {screenshotFolders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="analyzer-field-label" htmlFor="analyzer-trade">Linked Trade</label>
          <select
            id="analyzer-trade"
            className="field analyzer-select"
            value={organization.linkedTradeId || ""}
            onChange={(event) =>
              setOrganization((current) => ({
                ...current,
                linkedTradeId: event.target.value || null,
              }))
            }
          >
            <option value="">No linked trade</option>
            {tradeRows.map((trade, index) => (
              <option key={getTradeId(trade, index)} value={getTradeId(trade, index)}>
                {trade.pair} — {trade.date} — {trade.pnl}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="analyzer-organization-section">
        <div className="analyzer-field-label">Categories</div>
        <div className="analyzer-token-list">
          {selectedCategories.map((category) => (
            <CategoryToken
              category={category}
              key={category.categoryId}
              onRemove={() => removeCategory(category.categoryId)}
            />
          ))}
          {categoryPickerOpen && (
            <select
              className="analyzer-add-select"
              autoFocus
              defaultValue=""
              onChange={handleCategorySelect}
            >
              <option value="">Choose category</option>
              {availableCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          )}
          {!categoryPickerOpen && (
            <button className="analyzer-add-button" onClick={() => setCategoryPickerOpen(true)}>
              ＋ Add Category
            </button>
          )}
        </div>
      </div>

      <div className="analyzer-organization-section">
        <div className="analyzer-field-label">Tags</div>
        <div className="analyzer-token-list">
          {organization.tags.map((tag) => (
            <span className="analyzer-token tag-token" key={tag}>
              {tag}
              <button onClick={() => removeTag(tag)} aria-label={`Remove ${tag}`}>
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="analyzer-tag-entry">
          <input
            value={tagDraft}
            onChange={(event) => setTagDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addTag();
              }
            }}
            placeholder="Add a tag"
          />
          <button onClick={addTag}>＋</button>
        </div>
        <div className="analyzer-suggested-tags">
          <small>Suggested</small>
          {analysis.suggestedTags
            .filter((tag) => !organization.tags.includes(tag))
            .map((tag) => (
              <button key={tag} onClick={() => addSuggestedTag(tag)}>
                ＋ {tag}
              </button>
            ))}
        </div>
      </div>

      <div className="analyzer-feedback">
        <span>Are these results accurate?</span>
        <button
          className={analysisFeedback === "positive" ? "active" : ""}
          onClick={() => setAnalysisFeedback("positive")}
          aria-label="Results are accurate"
        >
          ♧
        </button>
        <button
          className={analysisFeedback === "negative" ? "active negative" : ""}
          onClick={() => setAnalysisFeedback("negative")}
          aria-label="Results are not accurate"
        >
          ♤
        </button>
      </div>
      <div className="analyzer-session-note">
        Organization changes last for this session only.
      </div>
      <button className="analyzer-another-button" onClick={onReset}>
        Analyze Another Screenshot
      </button>
    </Card>
  );
}

function AnalysisResultsSummary({ analysis, organization, setOrganization }) {
  return (
    <Card className="analyzer-results-card">
      <div className="results-heading">
        <h2>
          AI Analysis Results <span className="analyzer-beta">Beta</span>
        </h2>
        <strong>Confidence: {formatConfidence(analysis.confidence)}</strong>
      </div>
      <DetectedCategories
        analysis={analysis}
        organization={organization}
        setOrganization={setOrganization}
      />
    </Card>
  );
}

function AnalyzerSectionCard({ children }) {
  return <Card className="analyzer-row-card">{children}</Card>;
}

function CompletedAnalysisLayout({
  file,
  analysisStatus,
  zoom,
  setZoom,
  analysis,
  progress,
  analysisError,
  uploadError,
  organization,
  setOrganization,
  onFileSelected,
  onAnalyze,
  onReanalyze,
  onReset,
  analysisFeedback,
  setAnalysisFeedback,
  sessionScreenshots,
  reportVersions,
  currentVersionIndex,
  onSelectReport,
  onLatestReport,
  analysisChanges,
  onAddChart,
  addChartOpen,
  addTimeframe,
  availableTimeframes,
  additionalFile,
  additionalUploadError,
  onAddTimeframeChange,
  onAdditionalFileSelected,
  onCancelAddChart,
  onConfirmAddChart,
  recommendationHistories,
  recommendationSelections,
  onRecommendationHistoryChange,
}) {
  return (
    <div className="analyzer-completed-layout">
      <ReportNavigator
        reports={reportVersions}
        currentIndex={currentVersionIndex}
        onSelect={onSelectReport}
        onLatest={onLatestReport}
      />
      <TimeframeContext screenshots={sessionScreenshots} analysis={analysis} onAddChart={onAddChart} />
      <AddChartPanel
        open={addChartOpen}
        timeframe={addTimeframe}
        availableTimeframes={availableTimeframes}
        file={additionalFile}
        error={additionalUploadError}
        analyzing={analysisStatus === "analyzing"}
        onTimeframeChange={onAddTimeframeChange}
        onFileSelected={onAdditionalFileSelected}
        onCancel={onCancelAddChart}
        onConfirm={onConfirmAddChart}
      />
      <div className="analyzer-completed-grid">
        <div className="analyzer-column analyzer-completed-left-column">
          <div className="analyzer-completed-item analyzer-item-screenshot">
            <ScreenshotUploader file={file} error={uploadError} onFileSelected={onFileSelected} zoom={zoom} />
            <div className="analyzer-viewer-control-wrap">
              <ViewerControls zoom={zoom} setZoom={setZoom} />
              <div className="analyzer-zoom-hint">Use + and − to inspect the uploaded chart</div>
            </div>
          </div>
          <div className="analyzer-completed-item analyzer-item-progress">
            <AnalysisProgress status={analysisStatus} progress={progress} error={analysisError} />
            <AnalyzerNotice status={analysisStatus} onAnalyze={onAnalyze} />
          </div>
          <div className="analyzer-completed-item analyzer-item-levels">
            <AnalyzerSectionCard>
              <KeyLevels analysis={analysis} />
            </AnalyzerSectionCard>
          </div>
          {hasTradeIdea(analysis) && (
            <div className="analyzer-completed-item analyzer-item-trade">
              <AnalyzerSectionCard>
                <TradeIdea analysis={analysis} />
              </AnalyzerSectionCard>
            </div>
          )}
        </div>

        <div className="analyzer-column analyzer-completed-right-column">
          <div className="analyzer-completed-item analyzer-item-results">
            <AnalysisResultsSummary
              analysis={analysis}
              organization={organization}
              setOrganization={setOrganization}
            />
          </div>
          <div className="analyzer-completed-item analyzer-item-pattern">
            <AnalyzerSectionCard>
              <PatternAnalysis analysis={analysis} />
            </AnalyzerSectionCard>
          </div>
          <div className="analyzer-completed-item analyzer-item-context">
            <AnalyzerSectionCard>
              <MarketContext analysis={analysis} />
            </AnalyzerSectionCard>
          </div>
          {hasTradeIdea(analysis) && (
            <div className="analyzer-completed-item analyzer-item-insight">
              <AnalyzerSectionCard>
                <AIInsight analysis={analysis} onReanalyze={onReanalyze} />
              </AnalyzerSectionCard>
            </div>
          )}
        </div>
        {!hasTradeIdea(analysis) && (
          <div className="analyzer-completed-item analyzer-item-insight analyzer-completed-full-item">
            <AnalyzerSectionCard>
              <AIInsight analysis={analysis} onReanalyze={onReanalyze} />
            </AnalyzerSectionCard>
          </div>
        )}
      </div>

      <div className="analyzer-completed-item analyzer-item-trend analyzer-completed-full-item">
        <AnalyzerSectionCard>
          <AnalysisChanges changes={analysisChanges} />
          <MainTrendAnalysis analysis={analysis} />
        </AnalyzerSectionCard>
      </div>
      <div className="analyzer-completed-item analyzer-item-recommendations analyzer-completed-full-item">
        <AnalyzerSectionCard>
          <TradeRecommendations
            analysis={analysis}
            currentReportVersion={reportVersions[currentVersionIndex]?.version}
            recommendationHistories={recommendationHistories}
            recommendationSelections={recommendationSelections}
            onRecommendationHistoryChange={onRecommendationHistoryChange}
          />
        </AnalyzerSectionCard>
      </div>

      <OrganizationPanel
        analysis={analysis}
        organization={organization}
        setOrganization={setOrganization}
        onReset={onReset}
        analysisFeedback={analysisFeedback}
        setAnalysisFeedback={setAnalysisFeedback}
      />
    </div>
  );
}

function AnalyzerError({ error, onRetry, onReplace }) {
  return (
    <Card className="analyzer-error-card">
      <span className="analyzer-error-icon">×</span>
      <h2>Analysis couldn't be completed.</h2>
      <p>{error}</p>
      <div>
        <Button primary onClick={onRetry}>Retry Analysis</Button>
        <Button onClick={onReplace}>Replace Image</Button>
      </div>
    </Card>
  );
}

export default function Analyzer() {
  const [file, setFile] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [availableSessions, setAvailableSessions] = useState([]);
  const [sessionDiscoveryStatus, setSessionDiscoveryStatus] = useState("loading");
  const [sessionDiscoveryError, setSessionDiscoveryError] = useState(null);
  const [sessionResumeError, setSessionResumeError] = useState(null);
  const [resumingSessionId, setResumingSessionId] = useState(null);
  const [selectedTimeframe, setSelectedTimeframe] = useState(DEFAULT_TIMEFRAME);
  const [sessionScreenshots, setSessionScreenshots] = useState([]);
  const [analysisStatus, setAnalysisStatus] = useState("idle");
  const [analysis, setAnalysis] = useState(null);
  const [reportVersions, setReportVersions] = useState([]);
  const [currentVersionIndex, setCurrentVersionIndex] = useState(-1);
  const [analysisError, setAnalysisError] = useState(null);
  const [progress, setProgress] = useState(initialProgress);
  const [organization, setOrganization] = useState(initialOrganization);
  const [analysisFeedback, setAnalysisFeedback] = useState(null);
  const [uploadError, setUploadError] = useState(null);
  const [addChartOpen, setAddChartOpen] = useState(false);
  const [addTimeframe, setAddTimeframe] = useState("");
  const [additionalFile, setAdditionalFile] = useState(null);
  const [additionalUploadError, setAdditionalUploadError] = useState(null);
  const [recommendationSelections, setRecommendationSelections] = useState({});
  const [zoom, setZoom] = useState(1);
  const progressCleanupRef = useRef(null);
  const analysisInFlightRef = useRef(false);
  const replaceInputRef = useRef(null);
  const requestedEntriesRef = useRef([]);
  const previewStateRef = useRef({ file: null, additionalFile: null, sessionScreenshots: [] });

  useEffect(() => {
    let cancelled = false;
    analysisPersistenceService.listSessions()
      .then((payload) => {
        if (cancelled) return;
        setAvailableSessions(Array.isArray(payload?.sessions) ? payload.sessions : []);
        setSessionDiscoveryStatus("ready");
      })
      .catch((error) => {
        if (cancelled) return;
        setSessionDiscoveryError(error.message);
        setSessionDiscoveryStatus("error");
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    previewStateRef.current = { file, additionalFile, sessionScreenshots };
  }, [file, additionalFile, sessionScreenshots]);

  useEffect(() => () => {
    progressCleanupRef.current?.();
    const { file: currentFile, additionalFile: currentAdditionalFile, sessionScreenshots: currentScreenshots } = previewStateRef.current;
    const previewUrls = new Set([
      currentFile?.previewUrl,
      currentAdditionalFile?.previewUrl,
      ...currentScreenshots.map((entry) => entry.file?.previewUrl),
    ].filter(Boolean));
    previewUrls.forEach((previewUrl) => URL.revokeObjectURL(previewUrl));
  }, []);

  useEffect(() => {
    const currentReport = reportVersions[currentVersionIndex];
    if (!currentReport) {
      setRecommendationSelections({});
      return;
    }
    const histories = buildRecommendationHistories(reportVersions);
    setRecommendationSelections(Object.fromEntries(PRIMARY_RECOMMENDATION_STYLES.map((style) => {
      const entry = getHistoryEntryForReport(histories[style], currentReport.version);
      return [style, entry?.historyIndex ?? 0];
    })));
  }, [reportVersions, currentVersionIndex]);

  const selectFile = async (selectedFile) => {
    if (!selectedFile) return;
    setUploadError(null);
    try {
      const normalizedFile = await normalizeUploadedFile(selectedFile);
      setFile(normalizedFile);
      setSessionId(null);
      setSelectedTimeframe(DEFAULT_TIMEFRAME);
      setSessionScreenshots([]);
      requestedEntriesRef.current = [];
      setAnalysisStatus("ready");
      setAnalysis(null);
      setReportVersions([]);
      setCurrentVersionIndex(-1);
      setAnalysisError(null);
      setProgress(initialProgress());
      setOrganization(initialOrganization());
      setAnalysisFeedback(null);
      setZoom(1);
      setAddChartOpen(false);
      setAddTimeframe("");
      setAdditionalFile(null);
      setAdditionalUploadError(null);
      setRecommendationSelections({});
    } catch (error) {
      setUploadError(error.message);
    }
  };

  const runAnalysis = async ({ screenshotsToAnalyze, continuation = false } = {}) => {
    if (!file || analysisStatus === "analyzing" || analysisInFlightRef.current) return;
    analysisInFlightRef.current = true;
    const entries = screenshotsToAnalyze?.length
      ? screenshotsToAnalyze
      : sessionScreenshots.length
        ? sessionScreenshots
        : requestedEntriesRef.current.length
          ? requestedEntriesRef.current
          : [makeScreenshotEntry(file, selectedTimeframe, "primary")];
    requestedEntriesRef.current = entries;
    const previousReport = reportVersions[reportVersions.length - 1] || null;
    const isFirstAnalysis = reportVersions.length === 0;
    progressCleanupRef.current?.();
    setAnalysisStatus("analyzing");
    setAnalysisError(null);
    setProgress(initialProgress());
    progressCleanupRef.current = createAnalysisProgress(setProgress);
    try {
      const analysisResponse = await analyzeScreenshot({
        file,
        screenshots: entries,
        sessionId,
        context: {
          knownPair: null,
          knownTimeframe: entries.length === 1 ? entries[0].timeframe : null,
          knownSession: null,
          linkedTradeId: null,
          providedTimeframes: entries.map((entry) => entry.timeframe),
          continuation: continuation || Boolean(previousReport),
          previousAnalysis: previousReport?.result || null,
        },
      });
      const result = analysisResponse.result;
      progressCleanupRef.current?.();
      setProgress((current) => current.map((step) => ({ ...step, status: "complete" })));
      const persistedReport = analysisResponse.report;
      const nextReport = {
        id: persistedReport?.id,
        version: persistedReport?.versionNumber || reportVersions.length + 1,
        timeframes: persistedReport?.timeframesUsed || entries.map((entry) => entry.timeframe),
        modelVersion: persistedReport?.modelId || result.modelVersion,
        analyzedAt: persistedReport?.analyzedAt || result.analyzedAt,
        result,
        analysisChanges: buildAnalysisChanges(previousReport, result, entries),
      };
      const persistedScreenshots = analysisResponse.screenshots.length
        ? analysisResponse.screenshots.map((membership, index) => makePersistedScreenshotEntry(membership, entries[index]?.file || null))
        : entries;
      setSessionId(analysisResponse.session?.id || sessionId);
      setSessionScreenshots(persistedScreenshots);
      setReportVersions((current) => [...current, nextReport]);
      setCurrentVersionIndex(nextReport.version - 1);
      setAnalysis(result);
      if (analysisResponse.session) {
        setAvailableSessions((current) => [
          analysisResponse.session,
          ...current.filter((item) => item.id !== analysisResponse.session.id),
        ]);
      }
      if (isFirstAnalysis) {
        setOrganization((current) => ({
          ...current,
          selectedCategoryIds: result.detectedCategories.map((category) => category.categoryId).filter(Boolean),
          tags: [...result.suggestedTags],
        }));
      }
      setAnalysisStatus("completed");
      setAddChartOpen(false);
      setAdditionalUploadError(null);
    } catch (error) {
      progressCleanupRef.current?.();
      setProgress((current) => current.map((step) => step.status === "processing" ? { ...step, status: "error" } : step));
      setAnalysisError(error.message || "The analyzer returned an unexpected error.");
      setAnalysisStatus("error");
    } finally {
      analysisInFlightRef.current = false;
    }
  };

  const openAddChart = (requestedTimeframe = "") => {
    const available = getAvailableTimeframes(sessionScreenshots);
    const requestedIsNew = requestedTimeframe && !sessionScreenshots.some((entry) => entry.timeframe === requestedTimeframe);
    setAddTimeframe(requestedIsNew ? requestedTimeframe : available[0] || "");
    setAdditionalFile(null);
    setAdditionalUploadError(null);
    setAddChartOpen(true);
  };

  const selectAdditionalFile = async (selectedFile) => {
    if (!selectedFile) return;
    setAdditionalUploadError(null);
    setAdditionalFile(null);
    try {
      const normalizedFile = await normalizeUploadedFile(selectedFile);
      setAdditionalFile(normalizedFile);
    } catch (error) {
      setAdditionalUploadError(error.message);
    }
  };

  const confirmAddChart = () => {
    if (!additionalFile || !addTimeframe || analysisStatus === "analyzing") return;
    if (sessionScreenshots.some((entry) => entry.timeframe === addTimeframe)) {
      setAdditionalUploadError("That timeframe has already been added to this session.");
      return;
    }
    const nextEntries = [
      ...sessionScreenshots,
      makeScreenshotEntry(additionalFile, addTimeframe, `${addTimeframe}-${Date.now()}`),
    ];
    runAnalysis({ screenshotsToAnalyze: nextEntries, continuation: true });
  };

  const selectReport = (index) => {
    if (index < 0 || index >= reportVersions.length) return;
    setCurrentVersionIndex(index);
    setAnalysis(reportVersions[index].result);
    setAnalysisStatus("completed");
  };

  const selectLatestReport = () => {
    if (!reportVersions.length) return;
    selectReport(reportVersions.length - 1);
  };

  const handleRecommendationHistoryChange = (style, index) => {
    const history = buildRecommendationHistories(reportVersions)[style] || [];
    if (index < 0 || index >= history.length) return;
    setRecommendationSelections((current) => ({ ...current, [style]: index }));
  };

  const resumeSession = async (requestedSessionId) => {
    if (analysisStatus === "analyzing") return;
    setResumingSessionId(requestedSessionId);
    setSessionResumeError(null);
    setAnalysisError(null);
    setUploadError(null);
    setSessionDiscoveryError(null);
    try {
      const state = await analysisPersistenceService.getState(requestedSessionId);
      const loadedFiles = await Promise.all(state.screenshots.map((membership) => loadPersistedScreenshot(membership)));
      const entries = state.screenshots.map((membership, index) => makePersistedScreenshotEntry(membership, loadedFiles[index]));
      const loadedReports = [];
      state.reports.forEach((report) => {
        loadedReports.push(normalizePersistedReport(report, loadedReports.at(-1) || null, entries));
      });
      setSessionId(state.session.id);
      setSessionScreenshots(entries);
      requestedEntriesRef.current = entries;
      setFile(entries[0]?.file || null);
      setSelectedTimeframe(entries[0]?.timeframe || DEFAULT_TIMEFRAME);
      setReportVersions(loadedReports);
      setCurrentVersionIndex(loadedReports.length ? loadedReports.length - 1 : -1);
      setAnalysis(loadedReports.at(-1)?.result || null);
      setAnalysisStatus(loadedReports.length ? "completed" : entries.length ? "ready" : "idle");
      setProgress(loadedReports.length ? analysisSteps.map((label) => ({ label, status: "complete" })) : initialProgress());
      setOrganization(initialOrganization());
      setAnalysisFeedback(null);
      setAddChartOpen(false);
      setAdditionalFile(null);
      setAdditionalUploadError(null);
      setRecommendationSelections({});
      setZoom(1);
    } catch (error) {
      setSessionResumeError(error.message || "The saved analysis could not be resumed.");
    } finally {
      setResumingSessionId(null);
    }
  };

  const resetAnalyzer = () => {
    progressCleanupRef.current?.();
    setFile(null);
    setSessionId(null);
    setSelectedTimeframe(DEFAULT_TIMEFRAME);
    setSessionScreenshots([]);
    requestedEntriesRef.current = [];
    setAnalysisStatus("idle");
    setAnalysis(null);
    setReportVersions([]);
    setCurrentVersionIndex(-1);
    setAnalysisError(null);
    setProgress(initialProgress());
    setOrganization(initialOrganization());
    setSessionResumeError(null);
    setAnalysisFeedback(null);
    setUploadError(null);
    setAddChartOpen(false);
    setAddTimeframe("");
    setAdditionalFile(null);
    setAdditionalUploadError(null);
    setRecommendationSelections({});
    setZoom(1);
  };

  const replaceImage = () => replaceInputRef.current?.click();
  const stageHasResult = analysisStatus === "completed" && Boolean(analysis);

  return (
    <div className="analyzer-page">
      <AnalyzerHeader
        onBack={() => navigate("/screenshots")}
        onClose={() => navigate("/screenshots")}
      />
      <AnalyzerStepper analysisStatus={analysisStatus} />
      {stageHasResult ? (
        <CompletedAnalysisLayout
          file={file}
          analysisStatus={analysisStatus}
          zoom={zoom}
          setZoom={setZoom}
          analysis={analysis}
          progress={progress}
          analysisError={analysisError}
          uploadError={uploadError}
          organization={organization}
          setOrganization={setOrganization}
          onFileSelected={selectFile}
          onAnalyze={runAnalysis}
          onReanalyze={runAnalysis}
          onReset={resetAnalyzer}
          analysisFeedback={analysisFeedback}
          setAnalysisFeedback={setAnalysisFeedback}
          sessionScreenshots={sessionScreenshots}
          reportVersions={reportVersions}
          currentVersionIndex={currentVersionIndex}
          onSelectReport={selectReport}
          onLatestReport={selectLatestReport}
          analysisChanges={reportVersions[currentVersionIndex]?.analysisChanges || null}
          onAddChart={openAddChart}
          addChartOpen={addChartOpen}
          addTimeframe={addTimeframe}
          availableTimeframes={getAvailableTimeframes(sessionScreenshots)}
          additionalFile={additionalFile}
          additionalUploadError={additionalUploadError}
          onAddTimeframeChange={setAddTimeframe}
          onAdditionalFileSelected={selectAdditionalFile}
          onCancelAddChart={() => setAddChartOpen(false)}
          onConfirmAddChart={confirmAddChart}
          recommendationHistories={buildRecommendationHistories(reportVersions)}
          recommendationSelections={recommendationSelections}
          onRecommendationHistoryChange={handleRecommendationHistoryChange}
        />
      ) : (
        <div className="analyzer-workspace">
          <div className="analyzer-left-column">
            <ScreenshotUploader file={file} error={uploadError} onFileSelected={selectFile} zoom={zoom} />
            {file && !analysis && (
              <Card className="analyzer-timeframe-card analyzer-initial-timeframe-card">
                <TimeframeSelector value={selectedTimeframe} onChange={setSelectedTimeframe} />
              </Card>
            )}
            {file && (
              <div className="analyzer-viewer-control-wrap">
                <ViewerControls zoom={zoom} setZoom={setZoom} />
                <div className="analyzer-zoom-hint">Use + and − to inspect the uploaded chart</div>
              </div>
            )}
            {file && <AnalysisProgress status={analysisStatus} progress={progress} error={analysisError} />}
            <AnalyzerNotice status={analysisStatus} onAnalyze={runAnalysis} />
          </div>
          <div className="analyzer-right-column">
            {!file && <EmptyResults hasFile={false} status={analysisStatus} />}
            {!file && analysisStatus === "idle" && (
              <SessionDiscoveryPanel
                sessions={availableSessions}
                status={sessionDiscoveryStatus}
                error={sessionDiscoveryError || sessionResumeError}
                resumingSessionId={resumingSessionId}
                onResume={resumeSession}
                onStartNew={resetAnalyzer}
              />
            )}
            {file && analysisStatus === "ready" && <EmptyResults hasFile status={analysisStatus} />}
            {file && analysisStatus === "analyzing" && <EmptyResults hasFile status={analysisStatus} />}
            {file && analysisStatus === "error" && <AnalyzerError error={analysisError} onRetry={runAnalysis} onReplace={replaceImage} />}
          </div>
        </div>
      )}
      <input
        ref={replaceInputRef}
        accept="image/png,image/jpeg,.png,.jpg,.jpeg"
        hidden
        onChange={(event) => {
          selectFile(event.target.files[0]);
          event.target.value = "";
        }}
        type="file"
      />
    </div>
  );
}
