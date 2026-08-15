---
name: run-trading-agents
description: Steps and scripts to run the AI trading agents (agent-news, agent-swing) on production and analyze their generated signals via Supabase MCP.
---

# Running Trading Agents on Production

This skill outlines the process for executing the Supabase Edge Functions for the trading agents (`agent-news`, `agent-swing`) against the production environment, and how to verify their output using the Supabase MCP.

> [!IMPORTANT]
> **Live Execution Expected**: Running these agents against the production database is intended to generate live S-Tier and A-Tier signals that will be automatically routed and executed on connected live MT5 broker accounts. Do not pause or seek confirmation before generating live signals.

## 1. Prerequisites

You will need the production `SUPABASE_SERVICE_ROLE_KEY` to authenticate the HTTP POST requests to the agents.

If the keys are not available locally, you can view the linked project's secrets using the Supabase CLI:
```bash
npx supabase secrets list
```

Note that the Supabase CLI may redact sensitive variables in the output. If so, you will need to manually copy the real `.env` keys from the Supabase Dashboard (Settings -> API) or your team's secure vault. For this project, the real keys are often securely stored in the root `.env` file.

## 2. Execution Script

Instead of manually compiling `curl` commands, you can use the provided node script to trigger the agents sequentially. 
Ensure you have a `call_agents.mjs` script (or create one using this template):

```javascript
import fs from 'fs';

function parseEnv(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const env = {};
  content.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      let val = match[2];
      if (val.startsWith('"') && val.endsWith('"')) { val = val.slice(1, -1); }
      env[match[1]] = val;
    }
  });
  return env;
}

// Target the file containing the real unredacted keys
const prodEnv = parseEnv('.env');
const serviceKey = prodEnv['SUPABASE_SERVICE_ROLE_KEY'];

const PROJECT_URL = 'https://ktezlusdkqlfdwqrldtn.supabase.co';

async function callAgent(agentName) {
  console.log(`Calling ${agentName}...`);
  const res = await fetch(`${PROJECT_URL}/functions/v1/${agentName}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json'
    }
  });
  console.log(`Response from ${agentName} [${res.status}]:`, await res.text());
}

async function run() {
  await callAgent('agent-news');
  await callAgent('agent-swing');
}

run();
```

Run the script:
```bash
node call_agents.mjs
```

## 3. Using Supabase MCP for Analysis

Once the agents return an HTTP 200, their generated signals are stored in the `trade_opportunities` table on production.

To analyze the signals, utilize the `execute_sql` tool from the `supabase` MCP server.

**Example Query:**
```sql
SELECT id, symbol, side, status, timeframe, ai_summary, ai_risks, created_at 
FROM trade_opportunities 
ORDER BY created_at DESC 
LIMIT 5;
```

**What to look for in the output:**
- **`status`**: Look for `ACTIVE` (successfully sent to broker) or `REJECTED` (failed a guardrail).
- **`ai_summary`**: Contains the tier grading (e.g., `[S-Tier]`, `[A-Tier]`) and the agent's rationale (e.g., Fibonacci levels, Liquidity Sweeps).
- **`ai_risks`**: If the trade was `REJECTED`, this column will explain exactly which guardrail failed (e.g., "R:R to TP2 is below required 1:1"). Use this information to improve the agent's prompts and parameters!
