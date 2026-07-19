import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config({ path: "apps/rainebank/.env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function check() {
  const { data: userRes } = await supabase.from('users').select('id').eq('email', 'david@rainesoft.com').single();
  const userId = userRes.id;
  const { data } = await supabase.from('user_settings').select('telegram_chat_id, telegram_link_token').eq('user_id', userId);
  console.log("DB Data for david@rainesoft.com:", data);
}
check().catch(console.error);
