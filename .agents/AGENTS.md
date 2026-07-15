
# Rainebank Content Strategy
- **High School Reading Level**: All blog posts, academy articles, tutorials, and user-facing educational copy MUST be written at a level that a high schooler can easily understand. Avoid overly dense financial jargon where possible. If complex algorithmic or institutional trading concepts (like "Pearson correlation coefficients" or "covariance") must be discussed, they must be broken down with simple, relatable real-world analogies (e.g., "It's like putting all your eggs in one basket").


## Market Analysis Rule
Never give knee-jerk financial or market assessments based on historical assumptions (e.g. "Gold always goes up during war"). Always pull live market data, chart levels, and recent macroeconomic news first to establish a factual baseline before advising the user on an asset.

## Security First Principle
Whenever you identify a potential security vulnerability (e.g., exposing an unauthenticated endpoint, missing validation, hardcoded secrets), you MUST proactively suggest implementing the secure alternative. Never prioritize convenience over security in production systems. Specifically, if you deploy unauthenticated endpoints (like using `--no-verify-jwt` for internal webhooks), you must enforce internal authentication inside the function code (such as verifying Webhook Secrets or manually parsing user JWTs) to prevent spoofed payloads.
