const META_API_TOKEN = Deno.env.get("META_API_TOKEN");
const META_API_ACCOUNT_ID = Deno.env.get("META_API_ACCOUNT_ID");
const baseUrl = Deno.env.get("META_API_BASE_URL") || "https://mt-client-api-v1.london.agiliumtrade.ai";

console.log("Acc:", META_API_ACCOUNT_ID);

fetch(`${baseUrl}/users/current/accounts/${META_API_ACCOUNT_ID}/symbols/XAUUSD/current-quote`, {
  headers: { "auth-token": META_API_TOKEN! }
})
.then(res => res.text())
.then(console.log);
