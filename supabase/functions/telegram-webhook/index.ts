import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.108.2";

const TELEGRAM_API = `https://api.telegram.org/bot${Deno.env.get("TELEGRAM_BOT_TOKEN")}`;

async function sendMessage(chatId: number, text: string) {
  try {
    const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
      }),
    });
    if (!res.ok) {
      console.error("Failed to send telegram message", await res.text());
    }
  } catch (e) {
    console.error("Telegram API fetch error:", e);
  }
}

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  try {
    const update = await req.json();

    // Check if the update contains a message
    if (update.message && update.message.text) {
      const chatId = update.message.chat.id;
      const text = update.message.text.trim();

      // Check if it's a deep link /start command
      if (text.startsWith("/start ")) {
        const token = text.replace("/start ", "").trim();

        if (token) {
          const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
          const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
          const supabase = createClient(supabaseUrl, supabaseKey);

          // Find the user with this link token
          const { data: userSettings, error } = await supabase
            .from("user_risk_settings")
            .select("user_id")
            .eq("telegram_link_token", token)
            .single();

          if (error || !userSettings) {
            await sendMessage(chatId, "❌ Invalid or expired connection link. Please generate a new one from your RaineInvest Settings.");
          } else {
            // Update the user's chat ID and clear the token
            const { error: updateError } = await supabase
              .from("user_risk_settings")
              .update({
                telegram_chat_id: chatId.toString(),
                telegram_link_token: null, // Token is one-time use
              })
              .eq("user_id", userSettings.user_id);

            if (updateError) {
              console.error("Failed to link chat id", updateError);
              await sendMessage(chatId, "❌ Failed to connect account. Please try again or contact support.");
            } else {
              await sendMessage(
                chatId,
                "✅ Successfully connected your RaineInvest account! You will now receive instant, automated AI trade alerts in this chat."
              );
            }
          }
        }
      } else if (text.startsWith("/start")) {
        await sendMessage(chatId, "Welcome to RaineInvest! To link your account, please click the 'Connect Telegram' button inside your RaineInvest Settings page.");
      }
    }

    // Telegram requires a 200 OK response otherwise it will keep retrying the webhook
    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("Webhook processing error:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
});
