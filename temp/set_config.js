const { Client } = require('pg');
const fs = require('fs');

const envLocal = fs.readFileSync('apps/rainebank/.env.local', 'utf8');
const anonKey = envLocal.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=(.*)/)[1];

const client = new Client({
  // URL-encoded password for ux!LpiLm#!**8b2
  connectionString: 'postgres://postgres.ktezlusdkqlfdwqrldtn:ux!LpiLm%23!**8b2@aws-0-us-east-1.pooler.supabase.com:6543/postgres'
});

async function run() {
  await client.connect();
  
  console.log('Setting app.settings.cron_secret...');
  await client.query(`ALTER DATABASE postgres SET "app.settings.cron_secret" = '${anonKey}';`);
  
  // Also verify edge_function_url is set, just in case
  await client.query(`ALTER DATABASE postgres SET "app.settings.edge_function_url" = 'https://ktezlusdkqlfdwqrldtn.supabase.co';`);

  console.log('Configuration updated in Postgres!');
  await client.end();
}

run().catch(console.error);
