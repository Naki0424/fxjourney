import React, { useState } from "react";
import Button from "../components/common/Button";
import Card from "../components/common/Card";
import PageHeader from "../components/common/PageHeader";
import { settingsData } from "../data/mockData";

const settingsTabs = [
  { label: "Profile", icon: "♙" },
  { label: "Preferences", icon: "⚙" },
  { label: "Trading", icon: "▥" },
  { label: "AI & Analysis", icon: "✦" },
  { label: "Notifications", icon: "♧" },
  { label: "Security", icon: "◎" },
  { label: "Billing", icon: "▣" },
  { label: "Data & Privacy", icon: "♙" },
  { label: "Integrations", icon: "⌘" },
];

function SettingsCard({ title, children, className = "" }) {
  return (
    <Card className={`settings-card ${className}`}>
      <h2>{title}</h2>
      {children}
    </Card>
  );
}

function ProfileCard() {
  const [profile, setProfile] = useState(settingsData.profile);
  const [saved, setSaved] = useState(false);
  const updateField = (field, value) => {
    setProfile((current) => ({ ...current, [field]: value }));
    setSaved(false);
  };

  return (
    <SettingsCard title="Profile Information" className="profile-settings-card">
      <div className="settings-profile-identity">
        <div className="settings-profile-avatar">
          <span>♙</span>
          <i>▣</i>
        </div>
        <strong>{profile.fullName}</strong>
        <small>Pro Account</small>
      </div>
      <div className="settings-profile-form">
        <label>
          Full Name
          <input value={profile.fullName} onChange={(event) => updateField("fullName", event.target.value)} />
        </label>
        <label>
          Email
          <input value={profile.email} onChange={(event) => updateField("email", event.target.value)} />
        </label>
        <div className="settings-form-split">
          <label>
            Time Zone
            <select value={profile.timeZone} onChange={(event) => updateField("timeZone", event.target.value)}>
              <option>(GMT+1) London</option>
              <option>(GMT+8) Manila</option>
              <option>(GMT-5) New York</option>
            </select>
          </label>
          <label>
            Language
            <select value={profile.language} onChange={(event) => updateField("language", event.target.value)}>
              <option>English</option>
              <option>Spanish</option>
              <option>French</option>
            </select>
          </label>
        </div>
        <label>
          Bio
          <textarea value={profile.bio} onChange={(event) => updateField("bio", event.target.value)} />
        </label>
      </div>
      <Button primary onClick={() => setSaved(true)}>{saved ? "Changes Saved" : "Save Changes"}</Button>
    </SettingsCard>
  );
}

function AccountSummaryCard() {
  return (
    <SettingsCard title="Account Summary" className="account-summary-card">
      <div className="settings-summary-rows">
        {settingsData.accountSummary.map((item) => (
          <div className="settings-summary-row" key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            {item.action && <button className="upgrade-button">{item.action}</button>}
          </div>
        ))}
        <div className="settings-summary-row storage-row">
          <span>Storage Used</span>
          <strong>2.48 GB / 50 GB</strong>
          <small>5%</small>
          <div className="settings-storage-track"><i /></div>
        </div>
      </div>
      <Button>Manage Subscription</Button>
    </SettingsCard>
  );
}

function PreferencesCard() {
  return (
    <SettingsCard title="Preferences" className="preferences-settings-card">
      <div className="preference-list">
        {settingsData.preferences.map((item) => (
          <button className="preference-row" key={item.label}>
            <span className="preference-icon">{item.icon}</span>
            <b>{item.label}</b>
            <span>{item.value}</span>
            <em>›</em>
          </button>
        ))}
      </div>
      <button className="settings-link">View All Preferences →</button>
    </SettingsCard>
  );
}

function TradingPreferencesCard() {
  return (
    <SettingsCard title="Trading Preferences" className="trading-preferences-card">
      <div className="settings-simple-list">
        {settingsData.tradingPreferences.map((item) => (
          <div className="settings-simple-row" key={item.label}>
            <span>{item.label}</span>
            <b>{item.value}</b>
          </div>
        ))}
      </div>
      <button className="settings-link">Manage Trading Settings →</button>
    </SettingsCard>
  );
}

function Toggle({ enabled, onChange }) {
  return (
    <button className={`settings-toggle ${enabled ? "enabled" : ""}`} onClick={onChange} aria-label="Toggle setting">
      <i />
    </button>
  );
}

function AiSettingsCard() {
  const [enabled, setEnabled] = useState(() =>
    Object.fromEntries(settingsData.aiSettings.map((item) => [item.label, item.enabled])),
  );

  return (
    <SettingsCard title="AI & Analysis Settings" className="ai-settings-card">
      <span className="settings-beta">BETA</span>
      <div className="ai-settings-list">
        {settingsData.aiSettings.map((item) => (
          <div className="ai-settings-row" key={item.label}>
            <span className="settings-row-icon">{item.icon}</span>
            <div>
              <b>{item.label}</b>
              <p>{item.description}</p>
            </div>
            <Toggle
              enabled={enabled[item.label]}
              onChange={() => setEnabled((current) => ({ ...current, [item.label]: !current[item.label] }))}
            />
          </div>
        ))}
      </div>
      <button className="settings-link">Configure AI Settings →</button>
    </SettingsCard>
  );
}

function NotificationsCard() {
  return (
    <SettingsCard title="Notification Settings" className="notification-settings-card">
      <div className="notification-list">
        {settingsData.notifications.map((item) => (
          <button className="notification-row" key={item.label}>
            <span className="settings-row-icon">{item.icon}</span>
            <b>{item.label}</b>
            <span>{item.value}</span>
            <em>›</em>
          </button>
        ))}
      </div>
      <button className="settings-link">Manage Notifications →</button>
    </SettingsCard>
  );
}

function SecurityCard() {
  return (
    <SettingsCard title="Security" className="security-settings-card">
      <div className="security-list">
        {settingsData.security.map((item) => (
          <div className="security-row" key={item.label}>
            <span className="settings-row-icon">{item.icon}</span>
            <div><b>{item.label}</b><small>{item.value}</small></div>
            <button>{item.action}</button>
          </div>
        ))}
      </div>
    </SettingsCard>
  );
}

function DataPrivacyCard() {
  return (
    <SettingsCard title="Data & Privacy" className="data-privacy-card">
      <div className="privacy-list">
        {settingsData.dataPrivacy.map((item) => (
          <div className="privacy-row" key={item.label}>
            <span className={`settings-row-icon ${item.danger ? "danger-icon" : ""}`}>{item.icon}</span>
            <div><b>{item.label}</b><small>{item.description}</small></div>
            <button className={item.danger ? "danger-action" : ""}>{item.action}</button>
          </div>
        ))}
      </div>
    </SettingsCard>
  );
}

function IntegrationsCard() {
  const [connected, setConnected] = useState({});
  return (
    <SettingsCard title="Integrations" className="integrations-card">
      <div className="integration-list">
        {settingsData.integrations.map((item) => (
          <div className="integration-row" key={item.label}>
            <span className="integration-logo">{item.icon}</span>
            <div><b>{item.label}</b><small>{item.description}</small></div>
            <button onClick={() => setConnected((current) => ({ ...current, [item.label]: !current[item.label] }))}>
              {connected[item.label] ? "Connected" : "Connect"}
            </button>
          </div>
        ))}
      </div>
      <button className="settings-link">View All Integrations →</button>
    </SettingsCard>
  );
}

function SupportBanner() {
  return (
    <section className="settings-support-banner">
      <div className="support-message">
        <span className="support-icon">◎</span>
        <div>
          <h2>Your Security Matters</h2>
          <p>We use industry-standard encryption to keep your data safe and secure.</p>
          <p>Your trading journey is private and only yours.</p>
        </div>
      </div>
      <div className="support-divider" />
      <div className="support-help">
        <div><h2>Need Help?</h2><p>If you have any questions or need assistance, we're here to help.</p></div>
        <Button>♧ Contact Support</Button>
      </div>
    </section>
  );
}

export default function Settings() {
  const [activeTab, setActiveTab] = useState("Profile");
  const [search, setSearch] = useState("");
  const [reset, setReset] = useState(false);

  return (
    <div className="settings-page">
      <PageHeader title="Settings" sub="Customize your experience and manage your account preferences.">
        <input className="field settings-search" onChange={(event) => setSearch(event.target.value)} placeholder="⌕ Search settings..." value={search} />
        <Button onClick={() => setReset(true)}>{reset ? "Defaults Restored" : "⟳ Reset to Default"}</Button>
      </PageHeader>

      <div className="settings-tabs" role="tablist">
        {settingsTabs.map((tab) => (
          <button className={activeTab === tab.label ? "active" : ""} key={tab.label} onClick={() => setActiveTab(tab.label)} role="tab">
            <span>{tab.icon}</span>{tab.label}
          </button>
        ))}
      </div>

      <div className="settings-top-grid">
        <ProfileCard />
        <AccountSummaryCard />
        <PreferencesCard />
      </div>
      <div className="settings-middle-grid">
        <TradingPreferencesCard />
        <AiSettingsCard />
        <NotificationsCard />
      </div>
      <div className="settings-bottom-grid">
        <SecurityCard />
        <DataPrivacyCard />
        <IntegrationsCard />
      </div>
      <SupportBanner />
    </div>
  );
}
