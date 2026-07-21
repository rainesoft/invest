const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgres://postgres.ktezlusdkqlfdwqrldtn:ux!LpiLm#!**8b2@aws-0-us-east-1.pooler.supabase.com:6543/postgres'
});

async function run() {
  await client.connect();
  
  // Check jobs
  const res1 = await client.query('SELECT jobid, schedule, command, jobname, active FROM cron.job;');
  console.log('--- CRON JOBS ---');
  console.table(res1.rows);
  
  // Check recent runs
  const res2 = await client.query(`
    SELECT jobid, runid, status, return_message, start_time, end_time 
    FROM cron.job_run_details 
    ORDER BY start_time DESC 
    LIMIT 10;
  `);
  console.log('\n--- RECENT RUNS ---');
  console.table(res2.rows);

  await client.end();
}

run().catch(console.error);
