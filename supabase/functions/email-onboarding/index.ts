import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

interface WebhookPayload {
  type: "INSERT";
  table: "users";
  record: {
    id: string;
    email: string;
  };
}

serve(async (req) => {
  try {
    const payload: WebhookPayload = await req.json();

    if (payload.type !== "INSERT" || !payload.record?.email) {
      return new Response("Ignored", { status: 200 });
    }

    const email = payload.record.email;

    if (!RESEND_API_KEY) {
      console.error("Missing RESEND_API_KEY");
      return new Response("Server Configuration Error", { status: 500 });
    }

    const htmlContent = `
      <div style="font-family: sans-serif; font-size: 15px; color: #111; line-height: 1.6;">
        <p>Welcome to the RaineInvest Vault.</p>
        <p>You now have access to the public ledger. Because you are on the free tier, the signals you see on the dashboard are delayed by 4+ hours to protect the edge of our institutional and Alpha clients.</p>
        <p>RaineInvest is built on three core tenets:</p>
        <ol>
          <li><strong>Deterministic Math:</strong> We don't guess. The engine processes raw market structure and momentum oscillators to mathematically define the regime.</li>
          <li><strong>AI Guardrails:</strong> A specialized LLM evaluates structural alignment and rejects subpar setups.</li>
          <li><strong>Strict Risk Isolation:</strong> We mandate strict 1:2 R/R minimums to protect capital.</li>
        </ol>
        <p>Watch the ledger this week. The math speaks for itself.</p>
        <p>Best,<br>RaineInvest Systems</p>
      </div>
    `;

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "RaineInvest <system@raineinvest.com>",
        to: email,
        subject: "Welcome to the RaineInvest Vault",
        html: htmlContent,
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error("Resend API Error:", errorData);
      return new Response(`Email Dispatch Failed: ${errorData}`, { status: 500 });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Webhook processing error:", error);
    return new Response(`Error: ${error.message}`, { status: 500 });
  }
});
