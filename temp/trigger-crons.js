const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function ping(funcName) {
  console.log(`\n--- Pinging ${funcName} ---`);
  try {
    const res = await fetch(`${url}/functions/v1/${funcName}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      }
    });
    const status = res.status;
    const text = await res.text();
    console.log(`Status: ${status}`);
    console.log(`Response: ${text.substring(0, 200)}`);
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }
}

async function run() {
  await ping('exness-monitor');
  await ping('monitor-open-trades');
  await ping('resolve-outcomes');
}
run();
