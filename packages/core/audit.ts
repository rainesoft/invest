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

  const cleanEntry: any = { ...entry, hash };
  if (cleanEntry.entity_id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanEntry.entity_id)) {
    delete cleanEntry.entity_id;
  }
  if (cleanEntry.actor_id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanEntry.actor_id)) {
    delete cleanEntry.actor_id;
  }

  const { error } = await supabase.from("audit_log").insert(cleanEntry);
  if (error) {
    throw new Error(error.message);
  }
  return hash;
}

