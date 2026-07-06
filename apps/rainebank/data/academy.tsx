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
    excerpt: 'A super simple guide to setting up your Exness trading account and connecting it to our platform so the AI can start trading for you.',
    category: 'Setup Guides',
    isPremium: false,
    date: '2026-07-06',
    readTime: '4 min read',
    content: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <p style={{ fontSize: '18px', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
          To let Rainebank's AI trade for you, you first need a broker. A broker is just a bank that lets you buy and sell currencies. We highly recommend <strong>Exness</strong> because their fees are incredibly low, which means you keep more of your profits!
        </p>

        <h3 style={{ fontSize: '24px', fontWeight: 600, margin: '24px 0 8px 0', color: 'var(--text-primary)' }}>Step 1: Create an Exness Account</h3>
        <p style={{ fontSize: '16px', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
          First, click the button below to create your Exness account. By using this special link, you get placed into our VIP group which gives you the best trading speeds.
        </p>
        <div style={{ padding: '24px', background: 'var(--bg-gradient-1)', borderRadius: '12px', border: '1px solid var(--accent)' }}>
          <a href="https://one.exnessonelink.com/a/f7qeqc4thh" target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', background: 'var(--accent)', color: '#fff', padding: '12px 24px', borderRadius: '8px', textDecoration: 'none', fontWeight: 600 }}>
            Create Exness Account
          </a>
        </div>

        <h3 style={{ fontSize: '24px', fontWeight: 600, margin: '24px 0 8px 0', color: 'var(--text-primary)' }}>Step 2: Get Your Secret Keys</h3>
        <p style={{ fontSize: '16px', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
          Instead of giving us your personal login password, you are going to use a tool called <strong>MetaAPI</strong> to generate a secure "key".
        </p>
        <ul style={{ fontSize: '16px', lineHeight: '1.6', color: 'var(--text-secondary)', marginLeft: '24px' }}>
          <li>Go to the MetaAPI website and create a free account.</li>
          <li>Click "Add Connection" and type in your Exness account details.</li>
          <li>Once connected, copy the long string of letters and numbers called the <strong>Account ID</strong> and generate an <strong>API Token</strong>.</li>
        </ul>

        <h3 style={{ fontSize: '24px', fontWeight: 600, margin: '24px 0 8px 0', color: 'var(--text-primary)' }}>Step 3: Paste Your Keys into Rainebank</h3>
        <p style={{ fontSize: '16px', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
          Finally, go to your Rainebank Settings page. Under "Broker Connection", choose "MetaAPI" from the dropdown. Paste the Token and Account ID you just copied in Step 2.
        </p>
        <p style={{ fontSize: '16px', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
          Click Save, and you're done! The AI is now officially linked to your account.
        </p>
      </div>
    )
  },
  {
    id: '2',
    slug: 'setup-telegram-notifications',
    title: 'How to Get Trade Alerts on Telegram',
    excerpt: 'Learn how to connect Rainebank to your Telegram app so you get a text message on your phone every time a trade happens.',
    category: 'Setup Guides',
    isPremium: false,
    date: '2026-07-06',
    readTime: '3 min read',
    content: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <p style={{ fontSize: '18px', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
          Our AI trades extremely fast. If you want to know exactly what it's doing while you're away from your computer, you can set up Telegram alerts! We will send a direct message straight to your phone whenever a trade opens or closes.
        </p>

        <h3 style={{ fontSize: '24px', fontWeight: 600, margin: '24px 0 8px 0', color: 'var(--text-primary)' }}>Step 1: Find Your Chat ID</h3>
        <p style={{ fontSize: '16px', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
          Open the Telegram app on your phone and search for <strong>@userinfobot</strong>. Send it a message saying "hello". The bot will reply with a long number called your Chat ID (like 123456789). Copy this number.
        </p>

        <h3 style={{ fontSize: '24px', fontWeight: 600, margin: '24px 0 8px 0', color: 'var(--text-primary)' }}>Step 2: Create a Custom Bot (Optional)</h3>
        <p style={{ fontSize: '16px', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
          If you want your alerts to come from your very own private bot, you can easily make one! Search for <strong>@BotFather</strong> in Telegram. Send the message `/newbot` and follow the simple steps. At the end, it will give you an API Token. Copy this too!
        </p>

        <h3 style={{ fontSize: '24px', fontWeight: 600, margin: '24px 0 8px 0', color: 'var(--text-primary)' }}>Step 3: Save in Settings</h3>
        <p style={{ fontSize: '16px', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
          Go back to your Rainebank Settings. Scroll down to the Telegram section and paste your Bot Token and Chat ID. Hit Save, and you're good to go!
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
          To stop this from happening, the Rainebank AI uses a mathematical formula to compare how similarly two currency pairs move. If it notices that two pairs are moving like identical twins (a correlation score over 80%), it will block you from taking the second trade...
        </p>
      </div>
    )
  }
];
