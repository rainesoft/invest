import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://ktezlusdkqlfdwqrldtn.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0ZXpsdXNka3FsZmR3cXJsZHRuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NDYyNDQ2MiwiZXhwIjoyMDYwMjAwNDYyfQ.t1U0KpSeGL8SrsMDuLWVfpXI-SsV5UnJIdRIRNAi9ZM';

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data, error } = await supabase.from('market_data_pti').select('symbol, timeframe');
  if (error) {
    console.error(error);
    return;
  }
  
  const counts = data.reduce((acc, row) => {
    const key = `${row.symbol} ${row.timeframe}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  
  console.log("Market Data Counts:");
  console.log(counts);
}

check();
