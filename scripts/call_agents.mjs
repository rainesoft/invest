import fs from 'fs';

function parseEnv(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const env = {};
  content.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      let val = match[2];
      if (val.startsWith('"') && val.endsWith('"')) {
        val = val.slice(1, -1);
      }
      env[match[1]] = val;
    }
  });
  return env;
}

const prodEnv = parseEnv('.env');
const serviceKey = prodEnv['SUPABASE_SERVICE_ROLE_KEY'];

if (!serviceKey || serviceKey === '[SENSITIVE]' || serviceKey === '') {
    console.error("Service key missing or redacted in .env.prod. We might need to use Vercel CLI to pull it.");
}

const PROJECT_URL = 'https://ktezlusdkqlfdwqrldtn.supabase.co';

async function callAgent(agentName) {
  console.log(`Calling ${agentName}...`);
  try {
    const res = await fetch(`${PROJECT_URL}/functions/v1/${agentName}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json'
      }
    });
    const text = await res.text();
    console.log(`Response from ${agentName} [${res.status}]:`, text);
  } catch (err) {
    console.error(`Error calling ${agentName}:`, err);
  }
}

async function run() {
  await callAgent('agent-news');
  await callAgent('agent-swing');
}

run();
