const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgres://postgres.ktezlusdkqlfdwqrldtn:ux!LpiLm%23!**8b2@aws-0-us-east-1.pooler.supabase.com:6543/postgres'
});

async function run() {
  await client.connect();
  console.log('Setting config on role...');
  // Let's try ALTER ROLE postgres
  await client.query(`ALTER ROLE postgres SET "app.settings.cron_secret" = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0ZXpsdXNka3FsZmR3cXJsZHRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDQ2MjQ0NjIsImV4cCI6MjA2MDIwMDQ2Mn0.NQMYTl9uT-rOtTi9RESGUdRRaHUsu90O2WeAsnha-ss';`);
  console.log('Success!');
  await client.end();
}

run().catch(console.error);
