
# Rainebank Content Strategy
- **High School Reading Level**: All blog posts, academy articles, tutorials, and user-facing educational copy MUST be written at a level that a high schooler can easily understand. Avoid overly dense financial jargon where possible. If complex algorithmic or institutional trading concepts (like "Pearson correlation coefficients" or "covariance") must be discussed, they must be broken down with simple, relatable real-world analogies (e.g., "It's like putting all your eggs in one basket").


## Market Analysis Rule
Never give knee-jerk financial or market assessments based on historical assumptions (e.g. "Gold always goes up during war"). Always pull live market data, chart levels, and recent macroeconomic news first to establish a factual baseline before advising the user on an asset.

## Security First Principle
Whenever you identify a potential security vulnerability (e.g., exposing an unauthenticated endpoint, missing validation, hardcoded secrets), you MUST proactively suggest implementing the secure alternative. Never prioritize convenience over security in production systems. Specifically, if you deploy unauthenticated endpoints (like using `--no-verify-jwt` for internal webhooks), you must enforce internal authentication inside the function code (such as verifying Webhook Secrets or manually parsing user JWTs) to prevent spoofed payloads.

### Rule: Git Workflow Protocol
- **Branching**: NEVER push directly to the `main` or `master` branch. Always checkout a new descriptive branch (e.g., `feat/`, `fix/`, `chore/`) or push to the designated `dev` branch.
- **Conventional Commits**: All commit messages must strictly follow the Global Standard Conventional Commits specification (e.g., `feat: `, `fix: `, `refactor: `).
- **Granularity**: Do not lump unrelated changes into a single monolithic commit. Group logically related files together and create unique, atomic commits for each logical change with a descriptive message.

- **Merging & Primary Workspace**: After creating, committing, and pushing a feature branch, you MUST always merge that branch back into the `dev` branch. The `dev` branch is the primary working branch—ensure you return to it and continue all subsequent work from there.


## Rule: Resource-Efficient System Design
When designing solutions, monitoring state, or handling edge cases, you MUST prioritize native, low-overhead mechanics over custom polling loops or background daemons.
- **API Costs:** Never propose high-frequency polling scripts if a system is subject to API quotas (e.g., MetaAPI).
- **Native Delegation:** Offload logic to native handlers wherever possible (e.g., use MetaTrader's native Take Profit/Stop Loss parameters instead of monitoring prices manually; use Database Webhooks instead of polling tables).
- **System Stability:** Avoid solutions that rely on transient environments (like chat-bound scripts) for mission-critical operations.


## Rule: MetaAPI Modification Protocol
When using MetaAPI's `POSITION_MODIFY` or `ORDER_MODIFY` endpoints to adjust an existing trade, you MUST always fetch and explicitly re-inject all existing protective parameters (like `stopLoss` or `takeProfit`) into the payload, even if you are not changing them.

MetaAPI treats omitted parameters as explicit deletion commands. Failing to re-include a Stop Loss when modifying a Take Profit will erase the Stop Loss on the broker, exposing the user to infinite risk.

## Rule: Temporary Files and Diagnostics
All temporary execution files, one-off Node scripts, and diagnostic database migrations MUST be saved in the `<appDataDir>/brain/<conversation-id>/scratch/` directory. 
NEVER create temporary diagnostic files inside the project's source tree (e.g., `supabase/migrations/` or project roots) to prevent accidental commits and workspace pollution. If a diagnostic database migration is required, apply it from the scratch directory.

### Scratch Scripts & Ad-Hoc Files
When writing temporary scratch scripts (e.g., for ad-hoc database queries, testing APIs, or manual trade execution) or generating non-permanent files, you MUST create them inside the `temp/` folder in the project root. Never save temporary scripts in the root directory to avoid cluttering the repository and leaving behind untracked files during git commits.
