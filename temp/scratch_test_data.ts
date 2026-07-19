import * as fs from 'fs';

// Manually polyfill the env vars for the script
const envFile = fs.readFileSync('.env.local', 'utf8');
for (const line of envFile.split('\n')) {
  if (line.includes('=')) {
    const [key, ...vals] = line.split('=');
    process.env[key.trim()] = vals.join('=').trim();
  }
}
process.env.ENV = 'development';

import { fetchPaperBars } from '../supabase/functions/_shared/execution.ts';

async function main() {
  console.log("Fetching XAUUSD...");
  const xau = await fetchPaperBars('XAUUSD', '1D', 5);
  console.log("XAUUSD Bars:", xau);
  
  console.log("Fetching XAGUSD...");
  const xag = await fetchPaperBars('XAGUSD', '1D', 5);
  console.log("XAGUSD Bars:", xag);
}

main().catch(console.error);
