# RaineInvest Developer Setup

This guide outlines the steps required to set up your local environment for developing and running the RaineInvest system.

---

## 1. Prerequisites

```

## 5. Install the Supabase CLI

The Supabase CLI is required to manage and deploy edge functions (like `agent-trade`).

**For macOS (Recommended):**
Install the CLI via Homebrew:
```bash
brew install supabase/tap/supabase
```

**For Windows/Linux (or via npm):**
```bash
npm install -g supabase
```

## 6. Setup the Project & Authenticate

Once the tools above are installed, you can set up the project:

1. Install all Node dependencies using `pnpm`:
   ```bash
   pnpm install
   ```
2. Authenticate the Supabase CLI with your account:
   ```bash
   supabase login
   ```
   *(This will prompt you to generate and provide a Personal Access Token from your dashboard).*
3. Link your local project to the production Supabase instance (replace `<project-id>` with your actual ID, e.g., `ktezlusdkqlfdwqrldtn`):
   ```bash
   supabase link --project-ref <project-id>
   ```
4. For Edge Function deployment, you can now use:
   ```bash
   supabase functions deploy <function-name>
   ```
   *(Alternatively, use `pnpm deploy:prod` to push both DB changes and edge functions).*

You are now ready to develop on the Raine Bank system!

## 7. Running Agents Manually

During development, you may need to manually trigger the background trading agents. You can do this using the provided Node.js script.

Ensure you have your `.env` file correctly configured at the root of the project with your `SUPABASE_SERVICE_ROLE_KEY`.

Run the following command from the root directory to sequentially trigger the agents (e.g., `agent-news`, `agent-swing`):
```bash
node scripts/call_agents.mjs
```

## 8. Running the Web App Locally

The frontend web application is a Next.js app located in `apps/raineinvest`.

### Environment Variables Setup
Before running the app, you need to create an `.env.local` file inside the `apps/raineinvest` directory. The app requires access to Supabase and Paystack keys.

Copy your keys from the root `.env` or your Supabase dashboard into `apps/raineinvest/.env.local`:
```env
NEXT_PUBLIC_SUPABASE_URL="https://<your-project-id>.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="your-anon-key"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"

PAYSTACK_SECRET_KEY="sk_live_..."
NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY="pk_live_..."
NEXT_PUBLIC_PAYSTACK_ALPHA_PLAN_CODE="PLN_..."
```

*(Note: The `SUPABASE_SERVICE_ROLE_KEY` is specifically required by the `LandingPage` server component to fetch the live showcase signal while bypassing Row Level Security).*

### 2. Start the Development Server
Since the repository is a `pnpm` workspace, ensure Node.js is active via NVM and run the `dev` script from the root directory:

```bash
source ~/.nvm/nvm.sh
pnpm run dev
```

This will launch the Next.js development server on `http://localhost:3000`.
