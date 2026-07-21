import { createClient } from "npm:@supabase/supabase-js@2.38.4";
import "npm:dotenv/config";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function check() {
  const { data } = await supabase.from('user_settings').select('telegram_chat_id, telegram_link_token').eq('user_id', (await supabase.auth.admin.getUserById((await supabase.from('users').select('id').eq('email', 'david@rainesoft.com').single()).data.id)).data.user.id);
  console.log("DB Data:", data);
}
check();
