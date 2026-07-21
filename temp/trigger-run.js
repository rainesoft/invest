const url = process.env.SUPABASE_URL + "/functions/v1/agent-scalper";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

fetch(url, {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + key
  }
}).then(async res => {
  console.log("Status:", res.status);
  console.log(await res.text());
}).catch(console.error);
