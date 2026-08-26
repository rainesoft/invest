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
    title: 'How to Connect Your Exness Account to RaineInvest (MT5)',
    excerpt: 'A super simple guide to setting up your Exness trading account and running the RaineInvest Expert Advisor on MetaTrader 5.',
    category: 'Setup Guides',
    isPremium: false,
    date: '2026-07-18',
    readTime: '4 min read',
    content: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <p style={{ fontSize: '18px', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
          To let RaineInvest's AI trade for you, you first need a broker. We highly recommend <strong>Exness</strong> because their raw spreads and low commissions mean you keep more of your profits!
        </p>

        <h3 style={{ fontSize: '24px', fontWeight: 600, margin: '24px 0 8px 0', color: 'var(--text-primary)' }}>Step 1: Create an Exness Account</h3>
        <p style={{ fontSize: '16px', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
          First, click the button below to create your Exness account. By using this special link, you get placed into our VIP group which gives you the best execution speeds.
        </p>
        <div style={{ padding: '24px', background: 'var(--bg-gradient-1)', borderRadius: '12px', border: '1px solid var(--accent)' }}>
          <a href="https://one.exnessonelink.com/a/f7qeqc4thh" target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', background: 'var(--accent)', color: '#fff', padding: '12px 24px', borderRadius: '8px', textDecoration: 'none', fontWeight: 600 }}>
            Create Exness Account
          </a>
        </div>

        <h3 style={{ fontSize: '24px', fontWeight: 600, margin: '24px 0 8px 0', color: 'var(--text-primary)' }}>Step 2: Install MetaTrader 5</h3>
        <p style={{ fontSize: '16px', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
          Download MetaTrader 5 (MT5) from the Exness website and log into your trading account. MT5 is the industry standard terminal where our automated trading robot (Expert Advisor) will live.
        </p>

        <h3 style={{ fontSize: '24px', fontWeight: 600, margin: '24px 0 8px 0', color: 'var(--text-primary)' }}>Step 3: Attach the RaineInvest EA</h3>
        <p style={{ fontSize: '16px', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
          Navigate to the <strong>Vault</strong> page on RaineInvest and copy your personal Security Token. Then, download the `.ex5` Expert Advisor file and drop it into the `Experts` folder in your MT5 terminal. 
        </p>
        <p style={{ fontSize: '16px', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
          Attach the EA to a chart, ensure "Allow Algorithmic Trading" is enabled, and paste your token into the EA inputs window. The EA will instantly connect to our backend servers and begin trading automatically!
        </p>
      </div>
    )
  },
  {
    id: '2',
    slug: 'setup-telegram-notifications',
    title: 'How to Get Trade Alerts on Telegram',
    excerpt: 'Learn how to connect the RaineInvest EA to your Telegram app so you get a push notification on your phone every time a trade executes.',
    category: 'Setup Guides',
    isPremium: false,
    date: '2026-07-18',
    readTime: '3 min read',
    content: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <p style={{ fontSize: '18px', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
          Our AI trades extremely fast. If you want to know exactly what it's doing while you're away from your computer, you can set up Telegram alerts! The EA will send a direct message straight to your phone whenever it opens or closes a trade.
        </p>
        <h3 style={{ fontSize: '20px', fontWeight: 600, margin: '8px 0 0 0', color: 'var(--text-primary)' }}>Step 1: Get Your Chat ID</h3>
        <p style={{ fontSize: '16px', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
          Message the official <strong>@RawDataBot</strong> on Telegram to find your personal Chat ID (a string of numbers like 123456789).
        </p>
        <h3 style={{ fontSize: '20px', fontWeight: 600, margin: '8px 0 0 0', color: 'var(--text-primary)' }}>Step 2: Add it to the EA</h3>
        <p style={{ fontSize: '16px', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
          When attaching the RaineInvest EA to your MT5 chart, look for the "Telegram Chat ID" input field in the settings window. Paste your Chat ID there and click OK.
        </p>
        <h3 style={{ fontSize: '20px', fontWeight: 600, margin: '8px 0 0 0', color: 'var(--text-primary)' }}>Step 3: Enable WebRequests</h3>
        <p style={{ fontSize: '16px', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
          To allow MT5 to send messages to Telegram, go to Tools -&gt; Options -&gt; Expert Advisors. Check "Allow WebRequests for listed URL" and add `https://api.telegram.org` to the list. You're done!
        </p>
      </div>
    )
  },
  {
    id: '3',
    slug: 'advanced-correlation-limits',
    title: 'Why You Shouldn\'t Put All Your Eggs in One Basket',
    excerpt: 'Trading three different pairs that all involve the US Dollar isn\'t safe. Learn how our software mathematically protects your account from crashing.',
    category: 'Trading Alpha',
    isPremium: true,
    date: '2026-07-05',
    readTime: '6 min read',
    content: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <p style={{ fontSize: '18px', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
          Imagine you have $100. To be safe, you decide to invest in three totally different companies. But later, you realize all three companies are actually owned by the exact same parent company! If that parent company goes bankrupt, you lose all $100.
        </p>
        <p style={{ fontSize: '16px', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
          This happens in trading all the time. People buy EURUSD, EURJPY, and EURAUD, thinking they are being safe by taking three different trades. But since all three rely on the Euro, if the Euro suddenly crashes, all three trades will lose money at the exact same time. This is called "Correlation". 
        </p>
        {/* The rest of this premium content will be blurred out for free users! */}
        <p style={{ fontSize: '16px', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
          To stop this from happening, the RaineInvest AI uses a mathematical formula to compare how similarly two currency pairs move. If it notices that two pairs are moving like identical twins (a correlation score over 80%), it will block you from taking the second trade...
        </p>
      </div>
    )
  }
];
