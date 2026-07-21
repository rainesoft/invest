import { fetchMacroEvents } from "./supabase/functions/_shared/news.ts";

async function run() {
  console.log("XAUUSD:");
  console.log(await fetchMacroEvents("XAUUSD"));
  console.log("\nEURUSD:");
  console.log(await fetchMacroEvents("EURUSD"));
}

run();
