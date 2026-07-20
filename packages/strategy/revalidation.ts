import OpenAI from "npm:openai";
import { LogicContext } from "./indicators.ts";

export async function revalidateOpportunity(signal: any, snapshot: LogicContext, newsContext: string | null) {
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
      defaultHeaders: { "api-key": azureKey }
    });
  } else {
    throw new Error("No OpenAI or Azure OpenAI keys found");
  }

  const systemPrompt = `You are a Senior Risk Officer re-evaluating a previously published trading signal.
Your job is to determine if the original thesis is still valid given the NEW live market snapshot and NEW breaking news context.

[ORIGINAL SIGNAL THESIS]
Symbol: ${signal.symbol}
Direction: ${signal.side}
Entry Plan: ${JSON.stringify(signal.entry_plan_json)}
Stop Loss Plan: ${JSON.stringify(signal.stop_plan_json)}
Take Profit Plan: ${JSON.stringify(signal.take_profit_json)}
Thesis: ${signal.ai_summary}

[NEW LIVE CONTEXT]
Current Price: ${snapshot.current_price}
Breaking News & Macro: ${newsContext || "No major macro events."}

[VALIDATION RULES]
1. MACRO CONTRADICTION: If the new breaking news fundamentally contradicts the original thesis (e.g. a 'risk-off' geopolitical shock occurs but the signal is LONG equities), you MUST reject the signal.
2. STRUCTURAL DECAY: If the price action has significantly shifted and the original structural rationale no longer makes sense, reject it.
3. DO NOT HALLUCINATE MATH: The system has ALREADY mathematically verified that the current price has NOT hit the stop loss or take profit. Do NOT reject the setup claiming the stop loss was hit. You must only reject based on fundamental macro shifts or severe structural decay.
4. PROFIT SECURING: If the trade is currently in profit, but the momentum has slowed, the market is ranging, or we are approaching a strong structural barrier, issue a TAKE_PROFIT command to secure the bag early. Do not get greedy.
5. If the thesis remains strongly valid and supported by the new context, issue MAINTAIN.

You MUST respond strictly with a raw JSON object:
{
  "action": "MAINTAIN" | "REJECT" | "TAKE_PROFIT",
  "reason": "Explain why you chose this action."
}`;

  const userPrompt = `Re-evaluate the ${signal.symbol} signal.`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "revalidation",
        schema: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["MAINTAIN", "REJECT", "TAKE_PROFIT"] },
            reason: { type: "string" }
          },
          required: ["action", "reason"],
          additionalProperties: false
        },
        strict: true
      }
    },
    temperature: 0.1
  });

  const content = response.choices[0].message.content;
  if (!content) throw new Error("No content returned from AI");
  return JSON.parse(content);
}
