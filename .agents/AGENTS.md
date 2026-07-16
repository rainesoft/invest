
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

