# Rainebank Content Strategy

- **High School Reading Level**: All blog posts, academy articles, tutorials,
  and user-facing educational copy MUST be written at a level that a high
  schooler can easily understand. Avoid overly dense financial jargon where
  possible. If complex algorithmic or institutional trading concepts (like
  "Pearson correlation coefficients" or "covariance") must be discussed, they
  must be broken down with simple, relatable real-world analogies (e.g., "It's
  like putting all your eggs in one basket").

## Market Analysis Rule (Live Data Enforcement & Hierarchy)

Never give knee-jerk financial or market assessments based on historical
assumptions. **CRITICAL:** When asked to provide live market analysis, entry
points, or S-Tier trade signals in chat, you MUST pull true real-time data to
get the exact current price. You must strictly follow this fallback hierarchy:

1. **VPS Data (Primary):** Query the `market_data_pti` table to see if the VPS
   has pushed a recent candle (within the last ~30-60 minutes).
2. **MetaAPI (Secondary):** If the VPS data is stale, attempt to fetch the live
   price directly via MetaAPI, assuming rate limits and credits allow.
3. **Web Search (Last Resort):** Only use `search_web` if both the VPS and
   MetaAPI fail. If you must use this fallback, you **MUST be highly cautious**
   (as web searches may return futures contracts or exaggerated news) and
   explicitly inform the user that you are using web data. You must also tell
   the user exactly what needs fixing (e.g., "MetaAPI is rate-limited" or "The
   VPS hasn't pushed data since [time]") so they can restore the primary data
   feeds.

_Note:_ You are STRICTLY FORBIDDEN from relying on non-VPS local database
snapshots (like `market_context` or `trade_opportunities`) to determine the
current price, as that data is only updated on cron cycles and will be stale.

## Security First Principle

Whenever you identify a potential security vulnerability (e.g., exposing an
unauthenticated endpoint, missing validation, hardcoded secrets), you MUST
proactively suggest implementing the secure alternative. Never prioritize
convenience over security in production systems. Specifically, if you deploy
unauthenticated endpoints (like using `--no-verify-jwt` for internal webhooks),
you must enforce internal authentication inside the function code (such as
verifying Webhook Secrets or manually parsing user JWTs) to prevent spoofed
payloads.

### Rule: Git Workflow Protocol

- **Branching**: NEVER push directly to the `main` or `master` branch. Always
  checkout a new descriptive branch (e.g., `feat/`, `fix/`, `chore/`) or push to
  the designated `dev` branch.
- **Conventional Commits**: All commit messages must strictly follow the Global
  Standard Conventional Commits specification (e.g., `feat:`, `fix:`,
  `refactor:`).
- **Granularity**: Do not lump unrelated changes into a single monolithic
  commit. Group logically related files together and create unique, atomic
  commits for each logical change with a descriptive message.

- **Merging & Primary Workspace**: After creating, committing, and pushing a
  feature branch, you MUST always merge that branch back into the `dev` branch.
  The `dev` branch is the primary working branch—ensure you return to it and
  continue all subsequent work from there.

## Rule: Resource-Efficient System Design

When designing solutions, monitoring state, or handling edge cases, you MUST
prioritize native, low-overhead mechanics over custom polling loops or
background daemons.

- **API Costs:** Never propose high-frequency polling scripts if a system is
  subject to API quotas (e.g., MetaAPI).
- **Native Delegation:** Offload logic to native handlers wherever possible
  (e.g., use MetaTrader's native Take Profit/Stop Loss parameters instead of
  monitoring prices manually; use Database Webhooks instead of polling tables).
- **System Stability:** Avoid solutions that rely on transient environments
  (like chat-bound scripts) for mission-critical operations.

## CRITICAL RULE: MetaAPI Modification Protocol (STRICT ENFORCEMENT)

When using MetaAPI's `POSITION_MODIFY` or `ORDER_MODIFY` endpoints to adjust an
existing trade, you MUST always fetch and explicitly re-inject all existing
protective parameters (like `stopLoss` or `takeProfit`) into the payload, even
if you are not changing them.

MetaAPI treats omitted parameters as explicit deletion commands. Failing to
re-include a Stop Loss when modifying a Take Profit will erase the Stop Loss on
the broker, exposing the user to infinite risk. **THIS APPLIES TO MANUAL
SCRIPTS:** Even when executing one-off diagnostic scripts in the scratch
directory, you are strictly forbidden from sending a modification payload that
does not contain BOTH `stopLoss` and `takeProfit`.

## Rule: Temporary Files and Diagnostics

All temporary execution files, one-off Node scripts, and diagnostic database
migrations MUST be saved in the `<appDataDir>/brain/<conversation-id>/scratch/`
directory. NEVER create temporary diagnostic files inside the project's source
tree (e.g., `supabase/migrations/` or project roots) to prevent accidental
commits and workspace pollution. If a diagnostic database migration is required,
apply it from the scratch directory.

### Scratch Scripts & Ad-Hoc Files

When writing temporary scratch scripts (e.g., for ad-hoc database queries,
testing APIs, or manual trade execution) or generating non-permanent files, you
MUST create them inside the `temp/` folder in the project root. Never save
temporary scripts in the root directory to avoid cluttering the repository and
leaving behind untracked files during git commits.

### Agent Consolidation Rule

When adding new functionality to the trading system, ALWAYS prefer expanding an
existing agent (adding a new `action` type to its request dispatcher) over
creating a new Edge Function. Only create a new function when:

- The feature is a genuinely independent domain with no existing owner agent
- The runtime characteristics differ significantly (e.g., long-running vs. fast
  webhook)
- The existing agent would exceed ~800 lines and readability suffers
  significantly

Examples of correct consolidation:

- Position management (break-even, trailing stops) → `agent-trade` (action:
  MANAGE_POSITIONS)
- Signal sleep mode check → `agent-scalper` (inline guard before AI call)
- Weekend defense → `agent-kill-switch` (action: WEEKEND_DEFENSE)

### Scratch Scripts & Ad-Hoc Files

When writing temporary scratch scripts (e.g., for ad-hoc database queries,
testing APIs, or manual trade execution) or generating non-permanent files, you
MUST create them inside the `temp/` folder in the project root. Never save
temporary scripts in the root directory to avoid cluttering the repository and
leaving behind untracked files during git commits.

## Incident Response & Health Checks

Whenever you investigate and resolve a critical system bug, execution failure,
or silent failure:

1. You MUST update the workspace's System Health Checklist (e.g.,
   `docs/System Health Checklist.md`) to include a diagnostic query or check
   that can detect this specific failure mode in the future.
2. You MUST update the corresponding `system-health` skill (`SKILL.md`) so that
   the automated health check incorporates your new diagnostic.

## Architectural Preference

- **Execution Routing**: Always prioritize the Windows VPS hybrid architecture
  (queueing trades as `VPS_PENDING`) for opening trades in order to reduce
  MetaAPI costs. Do NOT attempt to migrate order entries to the MetaAPI pipeline
  unless explicitly commanded by the user.
