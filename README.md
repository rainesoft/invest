# RaineBank

An institutional-grade, fully autonomous algorithmic trading SaaS platform and autonomous PAMM fund manager.

The RaineBank Engine is designed to identify structural macro setups, mathematically evaluate risk via an AI Risk Officer, autonomously execute trades on live brokerages, manage global treasury solvency, and automatically market its performance to scale a retail and institutional subscriber base.

## 🏗️ System Architecture

### 1. Frontend (The Vault & Storefront)
- **Framework:** Next.js (App Router) + React.
- **Styling:** Inline Vanilla CSS & Tailwind CSS, featuring a heavy dark-mode glassmorphic aesthetic inspired by high-end trading terminals.
- **Pages:**
  - **Landing Page:** Bento-box structural layout converting traffic to free-tier accounts.
  - **The Vault (`/dashboard`):** Real-time ledger tracking signals, win-rates, active trades, and treasury solvency.
  - **Developer Portal (`/docs`):** Swagger-less, custom-styled institutional API integration documentation for B2B prop firms.

### 2. Backend (Supabase Core)
- **Database:** PostgreSQL (Supabase) with Row Level Security (RLS) ensuring strict data isolation.
- **Trigger Framework:** Heavy reliance on the `pg_net` extension and Postgres triggers (`AFTER INSERT`). Database events instantly trigger asynchronous HTTP requests to Deno Edge Functions, bypassing the need for polling loops.
- **Cron Scheduler:** `pg_cron` manages all asynchronous heartbeats, strictly using SQL statements to invoke Edge Functions.

### 3. Intelligence & Signal Generation (The Agent Council)
- **Agent Swing (`agent-swing`):** The core macro analyst. Wakes up every 4 hours to compute Fibonacci retracements on the 1D chart and hunts for high-conviction liquidity sweeps.
- **Agent News (`agent-news`):** Event-driven fundamental analyst. Wakes up hourly to ingest macroeconomic data and breaking news via Tavily, outputting macro bias variables that influence the Swing agent.
- **AI Execution Desk (CRO):** Utilizes OpenAI to evaluate market structure against systemic rules, enforcing strict 1:2.5 Risk/Reward ratios and isolating correlated asset risk. Trades exceeding maximum risk parameters are strictly vetoed.

### 4. Execution Layer (PAMM Routing & Trade Resolution)
- **The Execution Router (`agent-trade`):** A multi-tenant execution engine that iterates through subscribed users upon an approved S-Tier or A-Tier AI signal.
- **Bring-Your-Own-Broker (BYOB):** Users securely connect their own MT4/MT5 accounts via MetaApi.cloud tokens to execute live trades alongside the Master Account.
- **Post-Mortem Engine (`resolve-outcomes`):** Autonomously tracks live trades against a price action simulator. If a trade hits a Stop Loss, it leverages OpenAI to automatically generate a post-mortem analysis of the failure based on the last 10 candles.
- **Treasury Management (`cron-treasury-snapshot`):** Continuously monitors the overall Solvency Ratio of the system by cross-referencing Master Broker account equities against total customer liabilities.

---

## 💰 Monetization Pipeline

RaineBank operates two distinct, fully automated revenue streams:

1. **B2C Retail Tier ($99/mo)**
   - **Paystack Integration:** Webhooks automatically map successful checkout events to the `user_subscriptions` ledger, instantly upgrading user permissions to view the real-time Alpha feed without delay.
2. **B2B Institutional Tier ($1,000 - $2,000/mo)**
   - **Unkey API Gateway:** Edge-level rate limiting and key management. Institutional partners are issued raw API keys to directly ingest JSON signals into their proprietary execution engines.

---

## ⚙️ The Automation Flywheel

The system is engineered to run completely hands-off, managing its own execution, monitoring, and marketing.

- **Telegram Broadcast:** A `pg_net` database trigger pushes new `APPROVED` S-Tier and A-Tier signals directly to the RaineBank retail Telegram channel instantly via MarkdownV2 formatting, explicitly ignoring rejected trades.
- **The Retail Lifecycle (Email Drip):** Using the **Resend API**, an automated cron job nurtures free-tier users:
  - **Day 0:** Welcome email.
  - **Day 3:** "Proof of Edge" highlighting the best trade they missed by not upgrading.
  - **Day 7:** Direct Paystack checkout upsell.
- **The Watchdog (`system-health-ping`):** Monitors the database timestamps. If the primary engine stalls, it isolates the failure and emails the CIO directly, keeping errors away from the retail Telegram.
- **Metrics Amplification (The Auto-Brag):** Every Friday, the engine audits its own 7-day performance (Net R-Multiple, Win Rate) and pushes pre-formatted marketing copy to the CIO for native LinkedIn/X publishing.

---

## 🚀 Local Development Quick Start

1. **Install Dependencies**
   ```bash
   pnpm install
   ```

2. **Environment Configuration**
   Copy `.env.example` to `.env` and fill in the required keys:
   - `NEXT_PUBLIC_SUPABASE_URL` & `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `UNKEY_ROOT_KEY` & `UNKEY_API_ID`
   - Edge Secrets (Set via `supabase secrets set`): `TELEGRAM_BOT_TOKEN`, `META_API_TOKEN`, `RESEND_API_KEY`, `PAYSTACK_SECRET_KEY`, `OPENAI_API_KEY`, `TAVILY_API_KEY`.

3. **Database Initialization**
   Run the local Supabase stack and apply migrations:
   ```bash
   npx supabase start
   ```

4. **Run the Next.js Frontend**
   ```bash
   pnpm dev
   ```

5. **Deploy Edge Functions**
   ```bash
   npx supabase functions deploy
   ```

---
*Built by Rainesoft Technology Institute.*
