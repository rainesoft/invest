export interface AuditEntry {
  actor_type: string;
  actor_id?: string;
  action: string;
  entity_type?: string;
  entity_id?: string;
  payload_json?: Record<string, unknown>;
}

async function computeHash(input: string) {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function insertAuditLog(
  supabase: any,
  entry: AuditEntry,
) {
  const { data: last } = await supabase
    .from("audit_log")
    .select("hash")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const prevHash = last?.hash ?? "";
  const hash = await computeHash(prevHash + JSON.stringify(entry));

  const { error } = await supabase.from("audit_log").insert({
    ...entry,
    hash,
  });
  if (error) {
    throw new Error(error.message);
  }
  return hash;
}

