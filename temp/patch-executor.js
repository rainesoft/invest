const fs = require('fs');

const path = 'supabase/functions/exness-executor/index.ts';
let code = fs.readFileSync(path, 'utf8');

// 1. Replace the entryPrice extraction
code = code.replace(
  'const entryPrice = entryPlan.price || entryPlan.entry_price || entryPlan.limit_price;',
  `const defaultEntryPrice = entryPlan.price || entryPlan.entry_price || entryPlan.limit_price;
    const scaledEntries = entryPlan.scaled_entries && Array.isArray(entryPlan.scaled_entries) && entryPlan.scaled_entries.length > 0 
        ? entryPlan.scaled_entries 
        : [{ price: defaultEntryPrice, weight: 1.0 }];`
);

// 2. Inject the loop start
code = code.replace(
  'const riskPerTrade = Number(user.portfolio_capital) * Number(user.risk_per_trade_pct);',
  `for (const scaledEntry of scaledEntries) {
        const entryPrice = scaledEntry.price;
        const entryWeight = scaledEntry.weight || 1.0;
        const riskPerTrade = Number(user.portfolio_capital) * Number(user.risk_per_trade_pct) * entryWeight;`
);

// 3. Inject the loop end
code = code.replace(
  'executions.push({ user_id: user.user_id, status });\n    }',
  `executions.push({ user_id: user.user_id, status });\n      }\n    }`
);

fs.writeFileSync(path, code);
console.log("Patched successfully!");
