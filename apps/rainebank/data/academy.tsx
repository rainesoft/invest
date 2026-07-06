import React from 'react';

export type Category = 'Setup Guides' | 'Trading Alpha' | 'Platform Updates';

export interface Post {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  category: Category;
  isPremium: boolean;
  date: string;
  readTime: string;
  content: React.ReactNode;
}

export const ACADEMY_POSTS: Post[] = [
  {
    id: '1',
    slug: 'connect-exness-broker',
    title: 'How to Connect Your Exness Account to Rainebank',
    excerpt: 'A complete step-by-step guide to setting up your Exness broker account and linking it to the Rainebank execution engine using MetaAPI.',
    category: 'Setup Guides',
    isPremium: false,
    date: '2026-07-06',
    readTime: '4 min read',
    content: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <p style={{ fontSize: '18px', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
          To unlock the full potential of Rainebank's algorithmic trading, you need to connect a supported broker. We highly recommend Exness due to their ultra-low spreads and reliable execution during high-volatility events.
        </p>

        <h3 style={{ fontSize: '24px', fontWeight: 600, margin: '24px 0 8px 0', color: 'var(--text-primary)' }}>Step 1: Create an Exness Account</h3>
        <p style={{ fontSize: '16px', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
          If you don't already have an Exness account, you must create one using our official partner link. This ensures your account is properly routed into our VIP execution tier.
        </p>
        <div style={{ padding: '24px', background: 'var(--bg-gradient-1)', borderRadius: '12px', border: '1px solid var(--accent)' }}>
          <a href="https://one.exnessonelink.com/a/f7qeqc4thh" target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', background: 'var(--accent)', color: '#fff', padding: '12px 24px', borderRadius: '8px', textDecoration: 'none', fontWeight: 600 }}>
            Create Exness Account
          </a>
        </div>

        <h3 style={{ fontSize: '24px', fontWeight: 600, margin: '24px 0 8px 0', color: 'var(--text-primary)' }}>Step 2: Generate MetaAPI Credentials</h3>
        <p style={{ fontSize: '16px', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
          Because Rainebank uses institutional-grade execution, we connect to your MT4/MT5 account via MetaAPI rather than standard retail integrations.
        </p>
        <ul style={{ fontSize: '16px', lineHeight: '1.6', color: 'var(--text-secondary)', marginLeft: '24px' }}>
          <li>Go to MetaAPI and create a free account.</li>
          <li>Add a new MT4 or MT5 connection profile and input your Exness server and login credentials.</li>
          <li>Once connected, copy your <strong>Account ID</strong> and generate an <strong>API Token</strong>.</li>
        </ul>

        <h3 style={{ fontSize: '24px', fontWeight: 600, margin: '24px 0 8px 0', color: 'var(--text-primary)' }}>Step 3: Link to Rainebank</h3>
        <p style={{ fontSize: '16px', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
          Finally, head over to your Rainebank Settings. Under "Broker Connection", select MetaAPI from the dropdown. Paste the Token and Account ID you generated in Step 2.
        </p>
        <p style={{ fontSize: '16px', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
          Click Save, and you are officially ready for automated execution!
        </p>
      </div>
    )
  },
  {
    id: '2',
    slug: 'setup-telegram-notifications',
    title: 'Configuring the Telegram Broadcaster',
    excerpt: 'Never miss a trade. Learn how to connect your Rainebank account to Telegram to receive instant, native notifications whenever the AI executes or rejects a trade.',
    category: 'Setup Guides',
    isPremium: false,
    date: '2026-07-06',
    readTime: '3 min read',
    content: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <p style={{ fontSize: '18px', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
          The Rainebank AI executes trades in milliseconds. To stay in the loop, you can configure our Telegram Broadcaster to send direct messages to your phone for every signal, execution, and risk rejection.
        </p>

        <h3 style={{ fontSize: '24px', fontWeight: 600, margin: '24px 0 8px 0', color: 'var(--text-primary)' }}>Step 1: Get Your Chat ID</h3>
        <p style={{ fontSize: '16px', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
          Open Telegram and search for the bot named <strong>@userinfobot</strong>. Start a chat with it, and it will reply with your unique Chat ID (e.g., 123456789).
        </p>

        <h3 style={{ fontSize: '24px', fontWeight: 600, margin: '24px 0 8px 0', color: 'var(--text-primary)' }}>Step 2: Create Your Bot Token (Optional)</h3>
        <p style={{ fontSize: '16px', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
          While Rainebank has a global fallback bot, creating your own bot ensures completely private message routing. Search for <strong>@BotFather</strong>, send `/newbot`, and follow the prompts to get your HTTP API Token.
        </p>

        <h3 style={{ fontSize: '24px', fontWeight: 600, margin: '24px 0 8px 0', color: 'var(--text-primary)' }}>Step 3: Save in Settings</h3>
        <p style={{ fontSize: '16px', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
          Navigate to your Rainebank Settings. Under the Telegram integration panel, paste your Bot Token and Chat ID. Click Save. The Edge Function will now natively route all trade data directly to your device!
        </p>
      </div>
    )
  },
  {
    id: '3',
    slug: 'advanced-correlation-limits',
    title: 'Advanced Correlation Limits: Protecting Your Capital',
    excerpt: 'Why taking 5 trades on highly correlated EUR pairs is a recipe for disaster, and how the Rainebank engine mathematically prevents it.',
    category: 'Trading Alpha',
    isPremium: true,
    date: '2026-07-05',
    readTime: '6 min read',
    content: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <p style={{ fontSize: '18px', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
          A common mistake made by retail traders is buying EURUSD, EURJPY, and EURAUD simultaneously. Because they are all heavily weighted by the Euro, this isn't diversification—it's simply triple the risk on a single currency's performance.
        </p>
        <p style={{ fontSize: '16px', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
          In this deep dive, we explore how algorithmic correlation matrices work, how institutional desks hedge beta exposure, and exactly how the Rainebank execution engine analyzes cross-pair mathematical relationships before deploying your capital...
        </p>
        {/* The rest of this premium content will be blurred out for free users! */}
        <p style={{ fontSize: '16px', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
          To calculate real-time Pearson correlation coefficients, our engine looks at the rolling 14-period standard deviation of both assets. If the covariance is greater than 0.8...
        </p>
      </div>
    )
  }
];
