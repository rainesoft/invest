import { createClient } from "npm:@supabase/supabase-js@2.108.2";
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const { data } = await supabase
  .from("user_trades")
  .select("*")
  .order("created_at", { ascending: false })
  .limit(10);
console.log(JSON.stringify(data, null, 2));
