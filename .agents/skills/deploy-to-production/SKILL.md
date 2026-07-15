---
name: deploy-to-production
description: Use this skill when the user asks to deploy to production, ship changes, release, or go live. Covers both Vercel (frontend) and Supabase Edge Functions (backend) for the Rainebank project.
version: 1.0.0
---

# Deploy to Production

## Project Details
- **Repo:** `rainesoft/bank`
- **Working Dir:** `/Volumes/QDrive/Workspace/raine/bank`
- **Supabase Project Ref:** `ktezlusdkqlfdwqrldtn`
- **Production Branch:** `main`
- **Development Branch:** `dev`

## Step 1: Identify What Changed
Before deploying, determine which layers have changed:
- **Frontend changed** (`apps/rainebank/` files) → Vercel deploy needed
- **Edge functions changed** (`supabase/functions/` files) → Supabase deploy needed
- Both can be needed at the same time.

## Step 2: Deploy Frontend to Vercel
Vercel deploys automatically when `main` is updated. No CLI needed.

1. Ensure all changes are committed and pushed to `dev`.
2. Create a PR from `dev` → `main`:
```bash
gh pr create --base main --head dev --title "<title>" --body "<summary>"
```
3. Merge the PR (only after user approval — see git-workflow skill):
```bash
gh pr merge <PR_NUMBER> --merge
```
4. Vercel will automatically detect the `main` push and deploy to production within ~2-3 minutes.

## Step 3: Deploy Supabase Edge Functions
Edge functions are NOT auto-deployed. Must be done explicitly.

1. Ensure Supabase CLI is authenticated:
```bash
supabase login
```
(If already authenticated, this can be skipped — the CLI will say "You are already logged in".)

2. Deploy only the functions that changed:
```bash
supabase functions deploy <function-name> --project-ref ktezlusdkqlfdwqrldtn --no-verify-jwt
```
> **CRITICAL**: The `--no-verify-jwt` flag is **mandatory** for any functions triggered by database webhooks (`pg_net`), such as `exness-executor` and `telegram-broadcast`. Without this flag, the API Gateway will reject internal database triggers with a `401 Unauthorized` error.

3. Known functions in this project:
   - `exness-executor` — Core trade execution & risk management
   - `telegram-broadcast` — Signal and trade notifications
   - `research-run` — AI signal generation
   - `exness-monitor` — Live trade monitoring & trailing stops
   - `paystack-webhook` — Billing & subscription management
   - `process-recurring-billing` — Recurring billing processor

4. To deploy ALL functions at once (use sparingly, only when many functions changed):
```bash
supabase functions deploy --project-ref ktezlusdkqlfdwqrldtn --no-verify-jwt
```

## Step 4: Confirm Deployment
- **Vercel:** Check the [Vercel Dashboard](https://vercel.com/team_QQQcKazUlwlp8vgmB5lwysUn/rainebank) or run `gh pr view <NUMBER>` to confirm the merge state.
- **Supabase:** The CLI prints `Deployed Functions on project ktezlusdkqlfdwqrldtn: <name>` on success. A `401 Unauthorized` error means `supabase login` is required first.

## Important Notes
- Supabase functions **must be redeployed every time** their source code changes — git push alone is never enough.
- The Supabase CLI may show `WARNING: Docker is not running` — this is non-blocking for remote deployments and can be safely ignored.
- The `ignoreCommand` in `vercel.json` means Vercel may skip a build if only Supabase function files changed — this is expected and correct behaviour.
