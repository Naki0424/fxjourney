-- FXJourney Schema v1
-- Intentionally logical references (no SQL FK) to avoid circular migration ordering:
-- user_profiles.avatarMediaId -> media_assets.id
-- media_assets.journalEntryId -> journal_entries.id
-- journal_entries.analysisSessionId -> analysis_sessions.id
-- user_profiles origin/lastModified device metadata also remains logical because
-- devices requires user_profiles first and those values may identify the creating device.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  appliedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_profiles (
  id TEXT PRIMARY KEY,
  displayName TEXT NOT NULL,
  avatarMediaId TEXT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  originDeviceId TEXT NOT NULL,
  lastModifiedByDeviceId TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  appVersion TEXT NULL,
  createdAt TEXT NOT NULL,
  lastSeenAt TEXT NULL,
  retiredAt TEXT NULL,
  FOREIGN KEY (userId) REFERENCES user_profiles(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  name TEXT NOT NULL,
  brokerName TEXT NULL,
  accountType TEXT NULL,
  currencyCode TEXT NOT NULL,
  currencyMinorDigits INTEGER NOT NULL,
  initialBalanceMinor INTEGER NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  originDeviceId TEXT NOT NULL,
  lastModifiedByDeviceId TEXT NOT NULL,
  FOREIGN KEY (userId) REFERENCES user_profiles(id) ON DELETE RESTRICT,
  FOREIGN KEY (originDeviceId) REFERENCES devices(id) ON DELETE RESTRICT,
  FOREIGN KEY (lastModifiedByDeviceId) REFERENCES devices(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS app_settings (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  deviceId TEXT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('USER', 'DEVICE')),
  key TEXT NOT NULL,
  valueJson TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  originDeviceId TEXT NOT NULL,
  lastModifiedByDeviceId TEXT NOT NULL,
  CHECK (
    (scope = 'USER' AND deviceId IS NULL)
    OR (scope = 'DEVICE' AND deviceId IS NOT NULL)
  ),
  FOREIGN KEY (userId) REFERENCES user_profiles(id) ON DELETE RESTRICT,
  FOREIGN KEY (deviceId) REFERENCES devices(id) ON DELETE SET NULL,
  FOREIGN KEY (originDeviceId) REFERENCES devices(id) ON DELETE RESTRICT,
  FOREIGN KEY (lastModifiedByDeviceId) REFERENCES devices(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  accountId TEXT NOT NULL,
  instrument TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('BUY', 'SELL')),
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'OPEN', 'CLOSED', 'CANCELLED')),
  outcome TEXT NOT NULL DEFAULT 'UNRESOLVED'
    CHECK (outcome IN ('WIN', 'LOSS', 'BREAKEVEN', 'UNRESOLVED')),
  openedAt TEXT NULL,
  closedAt TEXT NULL,
  entryPrice TEXT NULL,
  exitPrice TEXT NULL,
  stopLossPrice TEXT NULL,
  takeProfitTargetsJson TEXT NULL,
  quantityLots TEXT NULL,
  accountEquityAtEntryMinor INTEGER NULL,
  riskAmountMinor INTEGER NULL,
  riskPercent TEXT NULL,
  pnlAmountMinor INTEGER NULL,
  setupType TEXT NULL,
  confluenceJson TEXT NULL,
  tradePlanJson TEXT NULL,
  emotionBefore TEXT NULL,
  emotionDuring TEXT NULL,
  emotionAfter TEXT NULL,
  emotionsJson TEXT NULL,
  reviewJson TEXT NULL,
  notes TEXT NULL,
  rating INTEGER NULL CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  planAdherence TEXT NOT NULL DEFAULT 'NOT_RATED'
    CHECK (planAdherence IN ('FOLLOWED', 'PARTIAL', 'BROKE_PLAN', 'NOT_RATED')),
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  originDeviceId TEXT NOT NULL,
  lastModifiedByDeviceId TEXT NOT NULL,
  FOREIGN KEY (userId) REFERENCES user_profiles(id) ON DELETE RESTRICT,
  FOREIGN KEY (accountId) REFERENCES accounts(id) ON DELETE RESTRICT,
  FOREIGN KEY (originDeviceId) REFERENCES devices(id) ON DELETE RESTRICT,
  FOREIGN KEY (lastModifiedByDeviceId) REFERENCES devices(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS screenshot_folders (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  name TEXT NOT NULL,
  sortOrder INTEGER NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  originDeviceId TEXT NOT NULL,
  lastModifiedByDeviceId TEXT NOT NULL,
  FOREIGN KEY (userId) REFERENCES user_profiles(id) ON DELETE RESTRICT,
  FOREIGN KEY (originDeviceId) REFERENCES devices(id) ON DELETE RESTRICT,
  FOREIGN KEY (lastModifiedByDeviceId) REFERENCES devices(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  tradeId TEXT NULL,
  journalEntryId TEXT NULL,
  folderId TEXT NULL,
  originalFilename TEXT NOT NULL,
  mimeType TEXT NOT NULL,
  byteSize INTEGER NOT NULL,
  width INTEGER NULL,
  height INTEGER NULL,
  capturedAt TEXT NULL,
  uploadedAt TEXT NOT NULL,
  storageKey TEXT NOT NULL,
  thumbnailKey TEXT NULL,
  checksumSha256 TEXT NOT NULL,
  source TEXT NOT NULL,
  favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
  availabilityStatus TEXT NOT NULL
    CHECK (availabilityStatus IN ('AVAILABLE', 'PENDING', 'MISSING')),
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  originDeviceId TEXT NOT NULL,
  lastModifiedByDeviceId TEXT NOT NULL,
  FOREIGN KEY (userId) REFERENCES user_profiles(id) ON DELETE RESTRICT,
  FOREIGN KEY (tradeId) REFERENCES trades(id) ON DELETE SET NULL,
  FOREIGN KEY (folderId) REFERENCES screenshot_folders(id) ON DELETE SET NULL,
  FOREIGN KEY (originDeviceId) REFERENCES devices(id) ON DELETE RESTRICT,
  FOREIGN KEY (lastModifiedByDeviceId) REFERENCES devices(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  userId TEXT NULL,
  name TEXT NOT NULL,
  normalizedName TEXT NOT NULL,
  groupName TEXT NULL,
  description TEXT NULL,
  source TEXT NOT NULL CHECK (source IN ('SYSTEM', 'USER')),
  icon TEXT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  originDeviceId TEXT NOT NULL,
  lastModifiedByDeviceId TEXT NOT NULL,
  FOREIGN KEY (userId) REFERENCES user_profiles(id) ON DELETE SET NULL,
  FOREIGN KEY (originDeviceId) REFERENCES devices(id) ON DELETE RESTRICT,
  FOREIGN KEY (lastModifiedByDeviceId) REFERENCES devices(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  name TEXT NOT NULL,
  normalizedName TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  originDeviceId TEXT NOT NULL,
  lastModifiedByDeviceId TEXT NOT NULL,
  FOREIGN KEY (userId) REFERENCES user_profiles(id) ON DELETE RESTRICT,
  FOREIGN KEY (originDeviceId) REFERENCES devices(id) ON DELETE RESTRICT,
  FOREIGN KEY (lastModifiedByDeviceId) REFERENCES devices(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS trade_tags (
  id TEXT PRIMARY KEY,
  tradeId TEXT NOT NULL,
  tagId TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  originDeviceId TEXT NOT NULL,
  lastModifiedByDeviceId TEXT NOT NULL,
  FOREIGN KEY (tradeId) REFERENCES trades(id) ON DELETE RESTRICT,
  FOREIGN KEY (tagId) REFERENCES tags(id) ON DELETE RESTRICT,
  FOREIGN KEY (originDeviceId) REFERENCES devices(id) ON DELETE RESTRICT,
  FOREIGN KEY (lastModifiedByDeviceId) REFERENCES devices(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS media_tags (
  id TEXT PRIMARY KEY,
  mediaId TEXT NOT NULL,
  tagId TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  originDeviceId TEXT NOT NULL,
  lastModifiedByDeviceId TEXT NOT NULL,
  FOREIGN KEY (mediaId) REFERENCES media_assets(id) ON DELETE RESTRICT,
  FOREIGN KEY (tagId) REFERENCES tags(id) ON DELETE RESTRICT,
  FOREIGN KEY (originDeviceId) REFERENCES devices(id) ON DELETE RESTRICT,
  FOREIGN KEY (lastModifiedByDeviceId) REFERENCES devices(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS media_categories (
  id TEXT PRIMARY KEY,
  mediaId TEXT NOT NULL,
  categoryId TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('AI', 'USER')),
  confidence TEXT NULL,
  confirmed INTEGER NOT NULL DEFAULT 0 CHECK (confirmed IN (0, 1)),
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  originDeviceId TEXT NOT NULL,
  lastModifiedByDeviceId TEXT NOT NULL,
  FOREIGN KEY (mediaId) REFERENCES media_assets(id) ON DELETE RESTRICT,
  FOREIGN KEY (categoryId) REFERENCES categories(id) ON DELETE RESTRICT,
  FOREIGN KEY (originDeviceId) REFERENCES devices(id) ON DELETE RESTRICT,
  FOREIGN KEY (lastModifiedByDeviceId) REFERENCES devices(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  tradeId TEXT NULL,
  analysisSessionId TEXT NULL,
  title TEXT NULL,
  body TEXT NOT NULL,
  mood TEXT NOT NULL CHECK (mood IN ('POSITIVE', 'NEUTRAL', 'CHALLENGING')),
  wentWellJson TEXT NULL,
  improvementsJson TEXT NULL,
  takeaway TEXT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  originDeviceId TEXT NOT NULL,
  lastModifiedByDeviceId TEXT NOT NULL,
  FOREIGN KEY (userId) REFERENCES user_profiles(id) ON DELETE RESTRICT,
  FOREIGN KEY (tradeId) REFERENCES trades(id) ON DELETE SET NULL,
  FOREIGN KEY (originDeviceId) REFERENCES devices(id) ON DELETE RESTRICT,
  FOREIGN KEY (lastModifiedByDeviceId) REFERENCES devices(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS journal_tags (
  id TEXT PRIMARY KEY,
  journalEntryId TEXT NOT NULL,
  tagId TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  originDeviceId TEXT NOT NULL,
  lastModifiedByDeviceId TEXT NOT NULL,
  FOREIGN KEY (journalEntryId) REFERENCES journal_entries(id) ON DELETE RESTRICT,
  FOREIGN KEY (tagId) REFERENCES tags(id) ON DELETE RESTRICT,
  FOREIGN KEY (originDeviceId) REFERENCES devices(id) ON DELETE RESTRICT,
  FOREIGN KEY (lastModifiedByDeviceId) REFERENCES devices(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  accountId TEXT NULL,
  title TEXT NOT NULL,
  description TEXT NULL,
  progressMode TEXT NOT NULL CHECK (progressMode IN ('AUTOMATIC', 'MANUAL')),
  metricType TEXT NOT NULL CHECK (metricType IN (
    'PROFIT_AMOUNT', 'WIN_RATE', 'MAX_RISK_PERCENT',
    'TRADE_FREQUENCY', 'PLAN_ADHERENCE', 'TRADING_DAYS', 'CUSTOM'
  )),
  targetValue TEXT NULL,
  targetUnit TEXT NULL,
  targetOperator TEXT NULL,
  periodStart TEXT NULL,
  periodEnd TEXT NULL,
  dueDate TEXT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'COMPLETED', 'ARCHIVED')),
  completedAt TEXT NULL,
  manualCurrentValue TEXT NULL,
  ruleJson TEXT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  originDeviceId TEXT NOT NULL,
  lastModifiedByDeviceId TEXT NOT NULL,
  FOREIGN KEY (userId) REFERENCES user_profiles(id) ON DELETE RESTRICT,
  FOREIGN KEY (accountId) REFERENCES accounts(id) ON DELETE SET NULL,
  FOREIGN KEY (originDeviceId) REFERENCES devices(id) ON DELETE RESTRICT,
  FOREIGN KEY (lastModifiedByDeviceId) REFERENCES devices(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS goal_milestones (
  id TEXT PRIMARY KEY,
  goalId TEXT NOT NULL,
  title TEXT NOT NULL,
  targetDate TEXT NULL,
  achievedAt TEXT NULL,
  sortOrder INTEGER NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  originDeviceId TEXT NOT NULL,
  lastModifiedByDeviceId TEXT NOT NULL,
  FOREIGN KEY (goalId) REFERENCES goals(id) ON DELETE RESTRICT,
  FOREIGN KEY (originDeviceId) REFERENCES devices(id) ON DELETE RESTRICT,
  FOREIGN KEY (lastModifiedByDeviceId) REFERENCES devices(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS habits (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NULL,
  frequency TEXT NOT NULL CHECK (frequency IN ('DAILY', 'WEEKLY', 'CUSTOM')),
  expectedWeekdaysJson TEXT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sortOrder INTEGER NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  originDeviceId TEXT NOT NULL,
  lastModifiedByDeviceId TEXT NOT NULL,
  FOREIGN KEY (userId) REFERENCES user_profiles(id) ON DELETE RESTRICT,
  FOREIGN KEY (originDeviceId) REFERENCES devices(id) ON DELETE RESTRICT,
  FOREIGN KEY (lastModifiedByDeviceId) REFERENCES devices(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS habit_entries (
  id TEXT PRIMARY KEY,
  habitId TEXT NOT NULL,
  entryDate TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'COMPLETED', 'MISSED', 'SKIPPED', 'NOT_APPLICABLE'
  )),
  note TEXT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  originDeviceId TEXT NOT NULL,
  lastModifiedByDeviceId TEXT NOT NULL,
  FOREIGN KEY (habitId) REFERENCES habits(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS weekly_reflections (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  weekStart TEXT NOT NULL,
  body TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  originDeviceId TEXT NOT NULL,
  lastModifiedByDeviceId TEXT NOT NULL,
  FOREIGN KEY (userId) REFERENCES user_profiles(id) ON DELETE RESTRICT,
  FOREIGN KEY (originDeviceId) REFERENCES devices(id) ON DELETE RESTRICT,
  FOREIGN KEY (lastModifiedByDeviceId) REFERENCES devices(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS analysis_sessions (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  linkedTradeId TEXT NULL,
  instrument TEXT NULL,
  primaryTimeframe TEXT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'COMPLETE', 'ARCHIVED')),
  contextJson TEXT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  originDeviceId TEXT NOT NULL,
  lastModifiedByDeviceId TEXT NOT NULL,
  FOREIGN KEY (userId) REFERENCES user_profiles(id) ON DELETE RESTRICT,
  FOREIGN KEY (linkedTradeId) REFERENCES trades(id) ON DELETE SET NULL,
  FOREIGN KEY (originDeviceId) REFERENCES devices(id) ON DELETE RESTRICT,
  FOREIGN KEY (lastModifiedByDeviceId) REFERENCES devices(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS analysis_session_media (
  id TEXT PRIMARY KEY,
  sessionId TEXT NOT NULL,
  mediaId TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  isPrimary INTEGER NOT NULL DEFAULT 0 CHECK (isPrimary IN (0, 1)),
  addedAt TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  originDeviceId TEXT NOT NULL,
  lastModifiedByDeviceId TEXT NOT NULL,
  FOREIGN KEY (sessionId) REFERENCES analysis_sessions(id) ON DELETE RESTRICT,
  FOREIGN KEY (mediaId) REFERENCES media_assets(id) ON DELETE RESTRICT,
  FOREIGN KEY (originDeviceId) REFERENCES devices(id) ON DELETE RESTRICT,
  FOREIGN KEY (lastModifiedByDeviceId) REFERENCES devices(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS analysis_report_versions (
  id TEXT PRIMARY KEY,
  sessionId TEXT NOT NULL,
  previousReportId TEXT NULL,
  modelId TEXT NOT NULL,
  analysisSchemaVersion TEXT NOT NULL,
  timeframesUsedJson TEXT NOT NULL,
  resultJson TEXT NOT NULL,
  contentHash TEXT NOT NULL,
  analyzedAt TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  originDeviceId TEXT NOT NULL,
  FOREIGN KEY (sessionId) REFERENCES analysis_sessions(id) ON DELETE RESTRICT,
  FOREIGN KEY (previousReportId) REFERENCES analysis_report_versions(id) ON DELETE RESTRICT,
  FOREIGN KEY (originDeviceId) REFERENCES devices(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS analysis_report_feedback (
  id TEXT PRIMARY KEY,
  reportId TEXT NOT NULL,
  rating TEXT NOT NULL CHECK (rating IN ('HELPFUL', 'NOT_HELPFUL')),
  note TEXT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  originDeviceId TEXT NOT NULL,
  lastModifiedByDeviceId TEXT NOT NULL,
  FOREIGN KEY (reportId) REFERENCES analysis_report_versions(id) ON DELETE RESTRICT,
  FOREIGN KEY (originDeviceId) REFERENCES devices(id) ON DELETE RESTRICT,
  FOREIGN KEY (lastModifiedByDeviceId) REFERENCES devices(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS sync_changes (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  changeId TEXT NOT NULL UNIQUE,
  originDeviceId TEXT NOT NULL,
  originSeq INTEGER NOT NULL,
  receivedFromDeviceId TEXT NULL,
  entityType TEXT NOT NULL,
  entityId TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('CREATE', 'UPDATE', 'DELETE')),
  baseVersion INTEGER NULL,
  newVersion INTEGER NOT NULL,
  changedFieldsJson TEXT NULL,
  payloadJson TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  FOREIGN KEY (originDeviceId) REFERENCES devices(id) ON DELETE RESTRICT,
  FOREIGN KEY (receivedFromDeviceId) REFERENCES devices(id) ON DELETE RESTRICT,
  UNIQUE (originDeviceId, originSeq)
);

CREATE TABLE IF NOT EXISTS sync_state (
  id TEXT PRIMARY KEY,
  localDeviceId TEXT NOT NULL,
  remoteDeviceId TEXT NOT NULL,
  lastReceivedRemoteSeq INTEGER NULL,
  lastSentLocalSeq INTEGER NULL,
  lastSyncStartedAt TEXT NULL,
  lastSyncCompletedAt TEXT NULL,
  status TEXT NOT NULL CHECK (status IN ('IDLE', 'SYNCING', 'ERROR')),
  lastError TEXT NULL,
  FOREIGN KEY (localDeviceId) REFERENCES devices(id) ON DELETE RESTRICT,
  FOREIGN KEY (remoteDeviceId) REFERENCES devices(id) ON DELETE RESTRICT,
  UNIQUE (localDeviceId, remoteDeviceId)
);

CREATE TABLE IF NOT EXISTS sync_conflicts (
  id TEXT PRIMARY KEY,
  entityType TEXT NOT NULL,
  entityId TEXT NOT NULL,
  conflictType TEXT NOT NULL CHECK (conflictType IN (
    'FIELD_CONFLICT', 'DELETE_EDIT_CONFLICT',
    'HABIT_STATUS_CONFLICT', 'TEXT_EDIT_CONFLICT'
  )),
  fieldName TEXT NULL,
  localDeviceId TEXT NOT NULL,
  remoteDeviceId TEXT NOT NULL,
  baseVersion INTEGER NULL,
  localPayloadJson TEXT NOT NULL,
  remotePayloadJson TEXT NOT NULL,
  detectedAt TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('UNRESOLVED', 'RESOLVED')),
  resolution TEXT NULL,
  resolvedAt TEXT NULL,
  FOREIGN KEY (localDeviceId) REFERENCES devices(id) ON DELETE RESTRICT,
  FOREIGN KEY (remoteDeviceId) REFERENCES devices(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_app_settings_user_key_active
  ON app_settings (userId, key) WHERE scope = 'USER' AND deletedAt IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_settings_device_key_active
  ON app_settings (deviceId, key) WHERE scope = 'DEVICE' AND deletedAt IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_tags_user_normalized_active
  ON tags (userId, normalizedName) WHERE deletedAt IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_trade_tags_active
  ON trade_tags (tradeId, tagId) WHERE deletedAt IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_media_tags_active
  ON media_tags (mediaId, tagId) WHERE deletedAt IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_media_categories_active
  ON media_categories (mediaId, categoryId) WHERE deletedAt IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_journal_tags_active
  ON journal_tags (journalEntryId, tagId) WHERE deletedAt IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_habit_entries_active
  ON habit_entries (habitId, entryDate) WHERE deletedAt IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_weekly_reflections_active
  ON weekly_reflections (userId, weekStart) WHERE deletedAt IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_analysis_session_media_active
  ON analysis_session_media (sessionId, mediaId) WHERE deletedAt IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_analysis_session_media_ordinal_active
  ON analysis_session_media (sessionId, ordinal) WHERE deletedAt IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_analysis_report_feedback_active
  ON analysis_report_feedback (reportId) WHERE deletedAt IS NULL;

CREATE INDEX IF NOT EXISTS idx_trades_account_id ON trades (accountId);
CREATE INDEX IF NOT EXISTS idx_trades_instrument ON trades (instrument);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades (status);
CREATE INDEX IF NOT EXISTS idx_trades_outcome ON trades (outcome);
CREATE INDEX IF NOT EXISTS idx_trades_opened_at ON trades (openedAt);
CREATE INDEX IF NOT EXISTS idx_trades_closed_at ON trades (closedAt);
CREATE INDEX IF NOT EXISTS idx_trades_deleted_at ON trades (deletedAt);

CREATE INDEX IF NOT EXISTS idx_journal_entries_created_at ON journal_entries (createdAt);
CREATE INDEX IF NOT EXISTS idx_journal_entries_trade_id ON journal_entries (tradeId);

CREATE INDEX IF NOT EXISTS idx_media_assets_trade_id ON media_assets (tradeId);
CREATE INDEX IF NOT EXISTS idx_media_assets_journal_entry_id ON media_assets (journalEntryId);
CREATE INDEX IF NOT EXISTS idx_media_assets_folder_id ON media_assets (folderId);
CREATE INDEX IF NOT EXISTS idx_media_assets_checksum ON media_assets (checksumSha256);

CREATE INDEX IF NOT EXISTS idx_goals_status ON goals (status);
CREATE INDEX IF NOT EXISTS idx_goals_due_date ON goals (dueDate);

CREATE INDEX IF NOT EXISTS idx_habit_entries_habit_date
  ON habit_entries (habitId, entryDate);

CREATE INDEX IF NOT EXISTS idx_analysis_sessions_linked_trade_id
  ON analysis_sessions (linkedTradeId);

CREATE INDEX IF NOT EXISTS idx_analysis_session_media_session_ordinal
  ON analysis_session_media (sessionId, ordinal);

CREATE INDEX IF NOT EXISTS idx_analysis_report_versions_session_analyzed_at
  ON analysis_report_versions (sessionId, analyzedAt);

CREATE INDEX IF NOT EXISTS idx_sync_changes_entity
  ON sync_changes (entityType, entityId);

CREATE INDEX IF NOT EXISTS idx_sync_conflicts_status
  ON sync_conflicts (status);
CREATE INDEX IF NOT EXISTS idx_sync_conflicts_entity
  ON sync_conflicts (entityType, entityId);
