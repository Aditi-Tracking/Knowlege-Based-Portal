// Triggered by trigger_parse_outstanding_fn (storage.objects INSERT, filtered to
// bucket_id = 'accounts-uploads'). Parses the uploaded Accounts Excel export and
// reconciles it against outstanding_snapshots. The trigger creates an import_jobs
// row and passes its id as payload.job_id — this function reports status/summary/
// error back against that row so the frontend can poll it directly instead of
// inferring completion from row-count changes.
//
// Required secrets (set via `supabase secrets set`):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (auto-injected by the platform)
//   WEBHOOK_SECRET                            (shared secret; must match the
//                                              custom header configured on the
//                                              Database Webhook, e.g. x-webhook-secret)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";
import * as XLSX from "https://esm.sh/xlsx@0.18.5?target=deno";

const BUCKET = "accounts-uploads";

const SUMMARY_ROW_NAMES = new Set(["grand total", "total", "subtotal"]);

const EXPECTED_COLUMNS = {
  billingName: ["billingname"],
  bucket0_30: ["0-30"],
  bucket31_60: ["31-60"],
  bucket61_90: ["61-90"],
  bucketAbove90: ["above90"],
  grandTotal: ["grandtotal"],
} as const;

function normalizeHeader(h: unknown): string {
  return String(h ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^\w-]/g, "");
}

function buildColumnMap(sampleRow: Record<string, unknown>): Record<keyof typeof EXPECTED_COLUMNS, string | null> {
  const normalizedToActual = new Map<string, string>();
  for (const actualKey of Object.keys(sampleRow)) {
    normalizedToActual.set(normalizeHeader(actualKey), actualKey);
  }
  const map = {} as Record<keyof typeof EXPECTED_COLUMNS, string | null>;
  for (const [field, candidates] of Object.entries(EXPECTED_COLUMNS)) {
    const actual = candidates.map((c) => normalizedToActual.get(c)).find((v) => v !== undefined) ?? null;
    map[field as keyof typeof EXPECTED_COLUMNS] = actual;
  }
  return map;
}

function parseNum(v: unknown): number {
  if (typeof v === "number") return v;
  const cleaned = String(v ?? "").replace(/,/g, "").trim();
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

Deno.serve(async (req) => {
  // Declared outside the try block so the catch handler can still report
  // status back against the right import_jobs row if something throws.
  let jobId: string | undefined;
  let supabase: ReturnType<typeof createClient> | undefined;

  try {
    const secret = req.headers.get("x-webhook-secret");
    if (secret !== Deno.env.get("WEBHOOK_SECRET")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    const payload = await req.json();
    jobId = payload?.job_id;

    supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const record = payload?.record;
    if (!record || record.bucket_id !== BUCKET) {
      return new Response(JSON.stringify({ skipped: true, reason: "not an accounts-uploads event" }), { status: 200 });
    }
    const objectPath: string = record.name;
    if (!/\.xlsx?$/i.test(objectPath)) {
      if (jobId) {
        await supabase.from("import_jobs").update({
          status: "error",
          error_message: "Not an Excel file (.xlsx/.xls expected)",
          completed_at: new Date().toISOString(),
        }).eq("id", jobId);
      }
      return new Response(JSON.stringify({ skipped: true, reason: "not an Excel file" }), { status: 200 });
    }

    const { data: fileBlob, error: downloadError } = await supabase.storage.from(BUCKET).download(objectPath);
    if (downloadError || !fileBlob) {
      throw new Error(`Failed to download ${objectPath}: ${downloadError?.message}`);
    }

    const workbook = XLSX.read(new Uint8Array(await fileBlob.arrayBuffer()), { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: null });

    if (rows.length === 0) {
      if (jobId) {
        await supabase.from("import_jobs").update({
          status: "done", rows_processed: 0, matched: 0, unmatched: 0, closed: 0,
          completed_at: new Date().toISOString(),
        }).eq("id", jobId);
      }
      return new Response(JSON.stringify({ rows_processed: 0, matched: 0, unmatched: 0, closed: 0 }), { status: 200 });
    }

    const columnMap = buildColumnMap(rows[0]);
    for (const [field, actual] of Object.entries(columnMap)) {
      if (!actual) throw new Error(`Missing expected column for "${field}" in uploaded sheet`);
    }

    const today = new Date().toISOString().slice(0, 10);

    const { data: prevDateRow } = await supabase
      .from("outstanding_snapshots")
      .select("snapshot_date")
      .lt("snapshot_date", today)
      .order("snapshot_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    const previousBatchDate: string | null = prevDateRow?.snapshot_date ?? null;

    let previousActive: { customer_id: string; grand_total: number; crm_customers: { billing_name: string } | null }[] = [];
    if (previousBatchDate) {
      const { data } = await supabase
        .from("outstanding_snapshots")
        .select("customer_id, grand_total, crm_customers(billing_name)")
        .eq("snapshot_date", previousBatchDate)
        .eq("is_closed", false);
      previousActive = data ?? [];
    }
    // billing_name carried alongside grand_total here purely so the closed
    // loop below can denormalize it into import_job_closures — see that
    // table's migration for why it's copied rather than joined live later.
    const previousActiveMap = new Map(
      previousActive.map((r) => [r.customer_id, { grandTotal: r.grand_total, billingName: r.crm_customers?.billing_name ?? "" }]),
    );

    let matched = 0;
    let unmatched = 0;
    const matchedCustomerIds = new Set<string>();

    for (const row of rows) {
      const billingName = String(row[columnMap.billingName!] ?? "").trim();
      if (!billingName || SUMMARY_ROW_NAMES.has(billingName.toLowerCase())) continue;

      const bucket_0_30 = parseNum(row[columnMap.bucket0_30!]);
      const bucket_31_60 = parseNum(row[columnMap.bucket31_60!]);
      const bucket_61_90 = parseNum(row[columnMap.bucket61_90!]);
      const bucket_above_90 = parseNum(row[columnMap.bucketAbove90!]);
      const grand_total = parseNum(row[columnMap.grandTotal!]);

      const { data: customerId } = await supabase.rpc("match_customer_name", { input_name: billingName });

      if (!customerId) {
        unmatched++;
        await supabase.from("unmatched_import_names").upsert(
          {
            raw_name: billingName,
            source: "accounts_excel",
            import_batch_date: today,
            bucket_0_30,
            bucket_31_60,
            bucket_61_90,
            bucket_above_90,
            grand_total,
          },
          { onConflict: "raw_name,import_batch_date" },
        );
        continue;
      }

      matched++;
      matchedCustomerIds.add(customerId);

      const { data: prevSnapshot } = await supabase
        .from("outstanding_snapshots")
        .select("grand_total")
        .eq("customer_id", customerId)
        .lt("snapshot_date", today)
        .order("snapshot_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      const previousGrandTotal = prevSnapshot?.grand_total ?? 0;
      const recovered_amount = Math.max(0, previousGrandTotal - grand_total);

      await supabase.from("outstanding_snapshots").upsert(
        {
          customer_id: customerId,
          snapshot_date: today,
          bucket_0_30,
          bucket_31_60,
          bucket_61_90,
          bucket_above_90,
          grand_total,
          recovered_amount,
          is_closed: false,
        },
        { onConflict: "customer_id,snapshot_date" },
      );
    }

    let closed = 0;
    for (const [customerId, prev] of previousActiveMap) {
      if (matchedCustomerIds.has(customerId)) continue;
      closed++;
      await supabase.from("outstanding_snapshots").upsert(
        {
          customer_id: customerId,
          snapshot_date: today,
          bucket_0_30: 0,
          bucket_31_60: 0,
          bucket_61_90: 0,
          bucket_above_90: 0,
          grand_total: 0,
          recovered_amount: prev.grandTotal,
          is_closed: true,
        },
        { onConflict: "customer_id,snapshot_date" },
      );

      // Auto-close behavior itself is unchanged above — this just makes
      // which customers got closed in which import reviewable afterward,
      // instead of only a one-time count shown right after upload.
      if (jobId) {
        await supabase.from("import_job_closures").insert({
          import_job_id: jobId,
          customer_id: customerId,
          billing_name: prev.billingName,
          prev_grand_total: prev.grandTotal,
        });
      }
    }

    if (jobId) {
      await supabase.from("import_jobs").update({
        status: "done",
        rows_processed: rows.length,
        matched,
        unmatched,
        closed,
        completed_at: new Date().toISOString(),
      }).eq("id", jobId);
    }

    return new Response(
      JSON.stringify({ rows_processed: rows.length, matched, unmatched, closed }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = String(err?.message ?? err);
    if (jobId && supabase) {
      try {
        await supabase.from("import_jobs").update({
          status: "error",
          error_message: message,
          completed_at: new Date().toISOString(),
        }).eq("id", jobId);
      } catch (_e) {
        // best-effort — don't let a failed status update mask the original error
      }
    }
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
