import OpenAI from "npm:openai";
import { SupabaseClient } from "npm:@supabase/supabase-js@2.108.2";

interface AdvocateContext {
  symbol: string;
  side: "BUY" | "SELL";
  price: number;
  setup_label: string;
  macro_bias: string;
  fib_narrative?: string;
  technical_reasons: string;
}

interface AdvocateResult {
  approved: boolean;
  reason: string;
}

export async function askDevilsAdvocate(
  context: AdvocateContext,
  traceId: string,
  supabase: SupabaseClient
): Promise<AdvocateResult> {
  console.log(`[Devil's Advocate] [Trace: ${traceId}] Analyzing ${context.side} on ${context.symbol}...`);
  
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  const azureKey = Deno.env.get("AZURE_OPENAI_API_KEY");

  let openai: OpenAI;
  if (openaiKey) {
    openai = new OpenAI({ apiKey: openaiKey });
  } else if (azureKey) {
    openai = new OpenAI({
      apiKey: azureKey,
      baseURL: `${Deno.env.get("AZURE_OPENAI_ENDPOINT")}/openai/deployments/${Deno.env.get("AZURE_OPENAI_DEPLOYMENT")}`,
      defaultQuery: { "api-version": Deno.env.get("AZURE_OPENAI_API_VERSION") || "2023-07-01-preview" },
      defaultHeaders: { "api-key": azureKey },
    });
  } else {
    console.warn(`[Devil's Advocate] [Trace: ${traceId}] No AI keys found. Bypassing check.`);
    return { approved: true, reason: "Bypassed: No AI configuration" };
  }

  const systemPrompt = `You are a strict Risk Manager and Devil's Advocate for a high-frequency trading firm.
Your job is to critically analyze proposed trades and find reasons to REJECT them.
A scalper bot wants to execute a trade. You must review the setup and the macro context.

If the trade direction strongly contradicts the macro bias OR if the technical setup is extremely weak given the context, you must REJECT it.
If the trade seems reasonable and aligns with or isn't outright destroyed by the macro context, you may APPROVE it.

Respond ONLY with valid JSON in this exact format:
{
  "approved": boolean,
  "reason": "String explaining the primary reason for approval or rejection in under 30 words"
}`;

  const userPrompt = `
PROPOSED TRADE:
Symbol: ${context.symbol}
Action: ${context.side}
Current Price: $${context.price}
Setup: ${context.setup_label}
Technical Basis: ${context.technical_reasons}

MARKET CONTEXT (from Swing Trader):
Macro Bias: ${context.macro_bias}
Fibonacci / Structure Narrative: ${context.fib_narrative || "None available"}

Analyze this trade and return your verdict in JSON format.
  `;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    });

    const content = response.choices[0].message.content;
    if (!content) throw new Error("No response from AI");

    const result = JSON.parse(content) as AdvocateResult;
    
    // Log verdict to DB
    await supabase.from("agent_verdicts").insert({
      trace_id: traceId,
      agent_persona: "DEVILS_ADVOCATE",
      symbol: context.symbol,
      action: context.side,
      verdict_approved: result.approved,
      verdict_reason: result.reason,
      context_json: context
    });

    console.log(`[Devil's Advocate] [Trace: ${traceId}] Verdict for ${context.symbol}: ${result.approved ? 'APPROVED' : 'REJECTED'} - ${result.reason}`);
    return result;
  } catch (error: any) {
    console.error(`[Devil's Advocate] [Trace: ${traceId}] Error during analysis:`, error.message);
    // Fail-open strategy to not block trades if AI fails
    return { approved: true, reason: `Bypassed: AI Error - ${error.message}` };
  }
}
