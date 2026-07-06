import { fetchMacroEvents } from "./supabase/functions/_shared/news";

async function run() {
  const result = await fetchMacroEvents("UKOIL");
  console.log(result);
}
run();
