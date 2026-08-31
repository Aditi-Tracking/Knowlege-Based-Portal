import { serve } from "https://deno.land/std/http/server.ts";
import { Resend } from "npm:resend";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

// This function is called directly from the browser (taskDelegation.js), unlike the cron-invoked
// send-task-emails function this was modeled on — so, unlike that one, it needs to actually
// answer the browser's CORS preflight (OPTIONS) and carry these headers on every response,
// or the browser blocks the real POST client-side before it ever reaches here.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const taskTitle: string = body.task_title || "Untitled task";
    const taskDescription: string = body.task_description || "";
    const dueDate: string | null = body.due_date || null;
    const assignedBy: string = body.assigned_by || "MIS";
    const assignees: Array<{ email: string; name?: string }> = Array.isArray(body.assignees) ? body.assignees : [];

    if (!assignees.length) {
      return new Response(
        JSON.stringify({ success: true, emails_sent: 0, message: "No assignees provided" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const dueLabel = dueDate
      ? new Date(dueDate + "T00:00:00").toLocaleDateString("en-GB", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : "Not set";

    let sent = 0;

    for (const assignee of assignees) {
      const email = assignee?.email;
      if (!email) continue;
      const name = assignee?.name || email;

      const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
</head>
<body style="margin:0; padding:0; background:#f0f4f8; font-family:Arial, sans-serif;">
  <div style="max-width:600px; margin:30px auto; background:#ffffff;
              border-radius:8px; overflow:hidden;
              box-shadow:0 2px 8px rgba(0,0,0,0.08);">

    <!-- Header -->
    <div style="background:#2474b5; padding:28px 32px;">
      <h2 style="margin:0; color:#ffffff; font-size:24px; font-weight:700;">
        New Task Assigned 📋
      </h2>
      <p style="margin:6px 0 0; color:#cce4f7; font-size:14px;">
        Hi ${name}, a new task has been delegated to you
      </p>
    </div>

    <!-- Task card -->
    <div style="padding:24px 32px;">
      <p style="margin:0 0 14px; font-size:13px; font-weight:700;
                color:#555; text-transform:uppercase; letter-spacing:0.8px;">
        Task
      </p>
      <div style="background:#f8f9fa; border-radius:8px; padding:18px 20px; margin-bottom:18px;">
        <p style="margin:0 0 8px; font-size:17px; font-weight:700; color:#222;">${taskTitle}</p>
        ${taskDescription ? `<p style="margin:0; font-size:14px; color:#555; line-height:1.5; white-space:pre-wrap;">${taskDescription}</p>` : ""}
      </div>
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">
        <tr>
          <td style="padding:6px 0; color:#888; width:120px;">Due Date</td>
          <td style="padding:6px 0; color:#333; font-weight:600;">${dueLabel}</td>
        </tr>
        <tr>
          <td style="padding:6px 0; color:#888;">Assigned By</td>
          <td style="padding:6px 0; color:#333; font-weight:600;">${assignedBy}</td>
        </tr>
      </table>
    </div>

    <!-- CTA Button -->
    <div style="padding:8px 32px 32px; text-align:center;">
      <a href="https://learn.adititracking.com"
         style="display:inline-block; background:#2474b5; color:#ffffff;
                padding:14px 36px; border-radius:6px; text-decoration:none;
                font-size:15px; font-weight:600;">
        Open Task Portal
      </a>
    </div>

    <!-- Footer -->
    <div style="background:#f8f9fa; padding:14px 32px; text-align:center;
                border-top:1px solid #e9ecef;">
      <p style="margin:0; font-size:12px; color:#aaa;">
        Aditi Tracking &middot; Task Delegation &middot; Do not reply
      </p>
    </div>

  </div>
</body>
</html>`;

      const { error } = await resend.emails.send({
        from: "Aditi Portal <portal@adititracking.com>",
        to: email,
        subject: `New task assigned: ${taskTitle}`,
        html,
      });

      if (error) {
        console.error(`Email error for ${name} (${email}):`, error);
      } else {
        sent++;
      }
    }

    return new Response(
      JSON.stringify({ success: true, emails_sent: sent }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ success: false, error: String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
