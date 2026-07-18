'use client';

import { Activity, Bot, MessageSquare, ShieldAlert, KeyRound, CheckCircle2 } from 'lucide-react';

export default function HelpPage() {
  return (
    <div style={{ padding: '32px', maxWidth: '1000px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '28px', fontWeight: 'bold', marginBottom: '8px' }}>Help & Documentation</h1>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '40px' }}>
        Learn how to configure your vault, connect your broker, and set up real-time alerts.
      </p>

      {/* Telegram Setup Guide */}
      <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '32px', marginBottom: '32px' }}>
        <h2 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Bot size={24} color="#3b82f6" />
          How to Set Up Telegram Alerts
        </h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '32px', lineHeight: '1.6' }}>
          Raine can instantly broadcast new AI trade signals and institutional rationale directly to your phone. 
          Setting up your personal Telegram bot is 100% free and takes less than two minutes.
        </p>

        {/* Step 1 */}
        <div style={{ display: 'flex', gap: '20px', marginBottom: '32px' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--accent-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontWeight: 'bold', color: 'white' }}>1</div>
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '12px' }}>Create your Bot Token</h3>
            <ul style={{ color: 'var(--text-secondary)', lineHeight: '1.8', listStyleType: 'disc', paddingLeft: '20px' }}>
              <li>Open the Telegram app and search for <strong style={{ color: 'var(--text-primary)' }}>@BotFather</strong> (look for the official blue verified checkmark) and click <strong>Start</strong>.</li>
              <li>Send the message <code style={{ background: 'var(--input-bg)', padding: '2px 6px', borderRadius: '4px', color: 'var(--text-primary)' }}>/newbot</code> to him.</li>
              <li>He will ask you for a <strong>Name</strong> for your bot (e.g., <em>Raine Alerts</em>).</li>
              <li>He will then ask you for a unique <strong>Username</strong> that must end in "bot" (e.g., <em>RaineTradingAlerts_bot</em>).</li>
              <li>BotFather will reply with a success message containing your <strong>HTTP API Token</strong> (it looks like a long string of numbers and letters, e.g., <code>123456789:ABCdef...</code>).</li>
              <li>Copy that entire token and paste it into the <strong>Telegram Bot Token</strong> field on your Raine Settings page.</li>
            </ul>
          </div>
        </div>

        {/* Step 2 */}
        <div style={{ display: 'flex', gap: '20px', marginBottom: '32px' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--accent-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontWeight: 'bold', color: 'white' }}>2</div>
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '12px' }}>Initialize the Bot</h3>
            <p style={{ color: 'var(--text-secondary)', lineHeight: '1.6', marginBottom: '12px' }}>
              Before a bot is allowed to message you, you must grant it permission by starting a conversation with it.
            </p>
            <ul style={{ color: 'var(--text-secondary)', lineHeight: '1.8', listStyleType: 'disc', paddingLeft: '20px' }}>
              <li>Search for your newly created bot's username in Telegram (e.g., <strong style={{ color: 'var(--text-primary)' }}>@RaineTradingAlerts_bot</strong>).</li>
              <li>Open the chat and click <strong style={{ color: 'var(--text-primary)' }}>Start</strong> at the bottom of the screen.</li>
            </ul>
          </div>
        </div>

        {/* Step 3 */}
        <div style={{ display: 'flex', gap: '20px', marginBottom: '32px' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--accent-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontWeight: 'bold', color: 'white' }}>3</div>
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '12px' }}>Get your Personal Chat ID</h3>
            <ol style={{ lineHeight: '1.8', color: 'var(--text-secondary)' }}>
              <li>Navigate to your Raine <strong>Settings</strong> page.</li>
              <li>Scroll down to the <strong>Telegram Alerts</strong> section.</li>
              <li>Click the <strong>Connect Telegram</strong> button. This will automatically open the official Raine Bank Bot in your Telegram app.</li>
              <li>Once Telegram opens, simply tap <strong>Start</strong> at the bottom of the screen. The bot will instantly link to your account and send you a confirmation message!</li>
            </ol>
            <div style={{ marginTop: '16px', padding: '12px 16px', background: 'rgba(239, 68, 68, 0.1)', borderLeft: '4px solid #ef4444', borderRadius: '4px', display: 'flex', gap: '12px' }}>
              <ShieldAlert color="#ef4444" size={20} style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                <h4 style={{ color: '#ef4444', fontWeight: '600', fontSize: '14px', marginBottom: '4px' }}>Anti-Piracy Lock</h4>
                <p style={{ color: 'var(--text-secondary)', fontSize: '13px', lineHeight: '1.5' }}>
                  Group chats and Channels are strictly prohibited by the system architecture. You must use a personal Direct Message Chat ID (positive numbers only). If your Chat ID contains a minus sign (-) or an @ symbol, the system will reject it.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Step 4 */}
        <div style={{ display: 'flex', gap: '20px' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontWeight: 'bold', color: 'white' }}>
            <CheckCircle2 size={18} />
          </div>
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '12px' }}>Save & Test</h3>
            <p style={{ color: 'var(--text-secondary)', lineHeight: '1.6' }}>
              Hit the <strong>Save Settings</strong> button in your Settings dashboard. The next time the AI generates a valid trade setup, your new bot will instantly buzz your phone with the alert!
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
