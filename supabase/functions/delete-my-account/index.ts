import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

// Rows that reference the user. Deleted before the auth user so nothing is left orphaned.
// Mirrors the cleanup list in admin-delete-user.
const cleanupTables = [
  { table: 'welcome_email_logs', column: 'user_id' },
  { table: 'purchase_reminder_email_logs', column: 'user_id' },
  { table: 'daily_motivation_email_logs', column: 'user_id' },
  { table: 'daily_login_attendance', column: 'student_id' },
  { table: 'daily_activity_logs', column: 'student_id' },
  { table: 'doubt_logs', column: 'student_id' },
  { table: 'dpp_attempted_questions', column: 'student_id' },
  { table: 'dpp_topic_submissions', column: 'student_id' },
  { table: 'dpt_submissions', column: 'student_id' },
  { table: 'assignment_submissions', column: 'student_id' },
  { table: 'class_attendance', column: 'student_id' },
  { table: 'test_results', column: 'student_id' },
  { table: 'cart_items', column: 'user_id' },
  { table: 'ai_video_watch_logs', column: 'student_id' },
  { table: 'student_progress', column: 'student_id' },
  { table: 'enrollments', column: 'student_id' },
  { table: 'payments', column: 'user_id' },
  { table: 'user_push_tokens', column: 'user_id' },
  { table: 'user_roles', column: 'user_id' },
  { table: 'profiles', column: 'id' },
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    // Identify the caller from their own session token. The user id is never taken from the request body,
    // so a signed-in user can only ever delete their own account.
    const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return json({ error: 'Not signed in' }, 401);
    }
    const { data: caller, error: callerError } = await supabase.auth.getUser(token);
    if (callerError || !caller.user) {
      return json({ error: 'Your session has expired. Please log in again and retry.' }, 401);
    }
    const userId = caller.user.id;
    const phone = caller.user.phone;

    // Remove personal data first. A failure here is reported but does not stop the rest.
    const cleanupFailures: string[] = [];
    for (const { table, column } of cleanupTables) {
      const { error } = await supabase.from(table).delete().eq(column, userId);
      if (error) {
        console.error(`Cleanup ${table} failed: ${error.message}`);
        cleanupFailures.push(`${table}: ${error.message}`);
      }
    }
    if (phone) {
      const { error } = await supabase.from('phone_otp_verifications').delete().eq('phone_number', phone);
      if (error) cleanupFailures.push(`phone_otp_verifications: ${error.message}`);
    }

    // Deleting the auth user is what stops logins. If it fails, the account still exists and the user can retry.
    const { error: deleteError } = await supabase.auth.admin.deleteUser(userId);
    if (deleteError) {
      console.error('deleteUser failed:', deleteError.message);
      return json({
        error: 'We could not delete your account right now. Please try again.',
        cleanup_failures: cleanupFailures,
      }, 500);
    }

    return json({ success: true, cleanup_failures: cleanupFailures });
  } catch (err) {
    console.error('delete-my-account error:', err);
    return json({ error: 'Something went wrong while deleting your account. Please try again.' }, 500);
  }
});
