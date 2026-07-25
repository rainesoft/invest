async function run() {
  const url = (process.env.SUPABASE_URL || "").replace(/\/$/, "") + "/rest/v1/trade_opportunities?symbol=eq.XAUUSD&status=eq.REJECTED&order=created_at.desc&limit=1";
  const req = await fetch(url, {
    headers: {
      "apikey": process.env.SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": "Bearer " + process.env.SUPABASE_SERVICE_ROLE_KEY
    }
  });
  console.log(await req.json());
}
run();
