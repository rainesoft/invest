import dotenv from "dotenv";
dotenv.config({ path: "supabase/.env" });

async function run() {
  console.log("Fetching Cointelegraph RSS...");
  const rssRes = await fetch("https://cointelegraph.com/rss");
  const xml = await rssRes.text();

  // Extract titles using regex
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  console.log(`Found ${items.length} items. Parsing top 3...`);

  const headlines = [];
  for (let i = 0; i < Math.min(3, items.length); i++) {
    const item = items[i];
    const titleMatch = item.match(/<title>(.*?)<\/title>/);
    const pubDateMatch = item.match(/<pubDate>(.*?)<\/pubDate>/);
    
    if (titleMatch) {
      // Basic CDATA removal if present
      let title = titleMatch[1].replace("<![CDATA[", "").replace("]]>", "").trim();
      headlines.push(title);
    }
  }

  console.log("Extracted Headlines:");
  headlines.forEach((h, i) => console.log(`${i+1}. ${h}`));

  // We will append a fake breaking news headline to test the LLM
  headlines.push("BREAKING: Donald Trump announces massive Bitcoin strategic reserve policy at Nashville conference");

  console.log("\nTesting LLM Sentiment Analysis on fake headline...");
  const fakeHeadline = headlines[headlines.length - 1];
  
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    console.error("No OPENAI_API_KEY found in .env");
    return;
  }

  const prompt = `You are a high-frequency trading Sentiment API. 
Analyze this news headline and return ONLY a JSON object.
Do not include markdown or codeblocks. Just the raw JSON.
Format: { "sentiment": "BULLISH" | "BEARISH" | "NEUTRAL", "confidence": 0-100, "symbol": "BTCUSD" | "NONE" }

Headline: "${fakeHeadline}"`;

  try {
    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.0
      })
    });

    const aiData = await aiRes.json();
    const resultText = aiData.choices[0].message.content.trim();
    console.log("Raw LLM output:", resultText);
    
    const parsed = JSON.parse(resultText);
    console.log("Parsed JSON:", parsed);

  } catch (err) {
    console.error("LLM Error:", err.message);
  }
}

run();
