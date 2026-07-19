const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Step 1: Test what headlines the news fetcher actually returns for UKOIL
async function testNews() {
  console.log("=== STEP 1: Testing News Headlines for UKOIL ===\n");
  
  // Simulate exactly what news.ts does
  const query = "Crude Oil Brent OPEC Strait Hormuz supply disruption";
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}+Financial+News&hl=en-US&gl=US&ceid=US:en`;
  
  console.log("Query:", query);
  console.log("URL:", url, "\n");
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      console.log("❌ News fetch FAILED with status:", response.status);
      return null;
    }
    
    const text = await response.text();
    const regex = /<item>\s*<title>(.*?)<\/title>/g;
    let match;
    const headlines = [];
    
    while ((match = regex.exec(text)) !== null && headlines.length < 5) {
      let cleanTitle = match[1]
        .replace(/&apos;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&');
      headlines.push(cleanTitle);
    }
    
    if (headlines.length > 0) {
      console.log("✅ Headlines found:");
      headlines.forEach((h, i) => console.log(`  ${i+1}. ${h}`));
    } else {
      console.log("❌ No headlines parsed from RSS response");
      console.log("RSS response length:", text.length);
      console.log("First 500 chars:", text.substring(0, 500));
    }
    return headlines;
  } catch (e) {
    console.log("❌ News fetch ERROR:", e.message);
    return null;
  }
}

// Step 2: Check ForexFactory calendar
async function testCalendar() {
  console.log("\n=== STEP 2: Testing ForexFactory Calendar ===\n");
  try {
    const res = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json', {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!res.ok) {
      console.log("❌ Calendar fetch FAILED:", res.status);
      return null;
    }
    const events = await res.json();
    const usdEvents = events.filter(e => 
      e.country === 'USD' && (e.impact === 'High' || e.impact === 'Medium')
    );
    console.log(`✅ ${events.length} total events, ${usdEvents.length} USD High/Medium impact`);
    usdEvents.slice(0, 5).forEach(e => 
      console.log(`  [${e.impact}] ${e.title} - ${e.date}`)
    );
    return events;
  } catch (e) {
    console.log("❌ Calendar ERROR:", e.message);
    return null;
  }
}

// Step 3: Check the last UKOIL rejection from the audit_log to see what context the AI received
async function checkAuditLog() {
  console.log("\n=== STEP 3: Checking Audit Logs for UKOIL ===\n");
  const { data } = await supabase.from('audit_log')
    .select('action, payload_json, created_at')
    .filter('payload_json->>symbol', 'eq', 'UKOIL')
    .order('created_at', { ascending: false })
    .limit(5);
  
  if (data) {
    data.forEach(d => {
      console.log(`[${d.created_at}] Action: ${d.action}`);
      console.log(`  Reason: ${d.payload_json?.reason || 'N/A'}`);
      console.log('---');
    });
  }
}

// Step 4: Check what the Pre-AI Guard does with UKOIL
async function checkPreAIGuard() {
  console.log("\n=== STEP 4: Checking Pre-AI Guard State ===\n");
  const { data } = await supabase.from('audit_log')
    .select('created_at')
    .eq('action', 'REJECTED_BY_RISK_PRE_AI')
    .eq('entity_type', 'research')
    .filter('payload_json->>symbol', 'eq', 'UKOIL')
    .gte('created_at', new Date(Date.now() - 240 * 60 * 1000).toISOString())
    .limit(1);
  
  if (data && data.length > 0) {
    console.log("⚠️ UKOIL is CACHED as rejected by Pre-AI Guard since:", data[0].created_at);
    console.log("   The AI evaluation was SKIPPED entirely!");
  } else {
    console.log("✅ No Pre-AI Guard cache - UKOIL should reach AI evaluation");
  }
}

async function run() {
  await testNews();
  await testCalendar();
  await checkAuditLog();
  await checkPreAIGuard();
}
run();
