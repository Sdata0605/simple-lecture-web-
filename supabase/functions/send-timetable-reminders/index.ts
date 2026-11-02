import { corsHeaders } from '../_shared/cors.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6.9.10';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const APP_BASE = 'https://simplelecture.com';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>
  )[c]);
}

function makeTransporter() {
  const smtpHost = Deno.env.get('SMTP_HOST');
  const smtpPort = parseInt(Deno.env.get('SMTP_PORT') || '465');
  const smtpUser = Deno.env.get('SMTP_USER');
  const smtpPass = Deno.env.get('SMTP_PASS');

  if (!smtpHost || !smtpUser || !smtpPass) throw new Error('SMTP not configured');

  return nodemailer.createTransport({
    host: smtpHost, port: smtpPort, secure: smtpPort === 465,
    auth: { user: smtpUser, pass: smtpPass },
  });
}

// Legacy: sessions with no channel (reminder_channel IS NULL) get the 15-minute email, as before.
// Sessions that have a channel are skipped here: they are handled by the channel path below.
async function sendLegacyReminders(supabase: any): Promise<{ processed: number; sent: number }> {
  const nowMs = Date.now();
  const lo = new Date(nowMs + 14 * 60 * 1000).toISOString();
  const hi = new Date(nowMs + 16 * 60 * 1000).toISOString();

  const { data: sessions, error } = await supabase
    .from('study_timetable_sessions')
    .select('id, student_id, course_id, subject_id, title, scheduled_at, duration_minutes')
    .is('reminder_sent_at', null)
    .is('reminder_channel', null)
    .eq('status', 'pending')
    .gte('scheduled_at', lo)
    .lte('scheduled_at', hi);

  if (error) throw error;
  if (!sessions || sessions.length === 0) return { processed: 0, sent: 0 };

  const transporter = makeTransporter();

  const studentIds = [...new Set(sessions.map((s: any) => s.student_id))];
  const courseIds = [...new Set(sessions.map((s: any) => s.course_id))];
  const subjectIds = [...new Set(sessions.map((s: any) => s.subject_id).filter(Boolean))];

  const [{ data: profiles }, { data: courses }, { data: subjects }] = await Promise.all([
    supabase.from('profiles').select('id, email, full_name').in('id', studentIds),
    supabase.from('courses').select('id, name').in('id', courseIds),
    subjectIds.length
      ? supabase.from('popular_subjects').select('id, name').in('id', subjectIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));
  const courseMap = new Map((courses || []).map((c: any) => [c.id, c]));
  const subjectMap = new Map((subjects || []).map((s: any) => [s.id, s]));

  let sent = 0;
  for (const s of sessions) {
    const profile: any = profileMap.get(s.student_id);
    if (!profile?.email) continue;
    const course: any = courseMap.get(s.course_id);
    const subject: any = s.subject_id ? subjectMap.get(s.subject_id) : null;
    const startTime = new Date(s.scheduled_at).toLocaleTimeString('en-IN', {
      hour: '2-digit', minute: '2-digit', hour12: true,
    });

    try {
      await transporter.sendMail({
        from: '"SimpleLecture" <notifications@simplelecture.com>',
        to: profile.email,
        subject: `⏰ Study reminder: ${s.title} starts in 15 minutes`,
        html: `
          <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;">
            <div style="background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);padding:32px 24px;text-align:center;border-radius:0 0 24px 24px;">
              <h1 style="color:#fff;margin:0;font-size:26px;">⏰ Time to Study!</h1>
              <p style="color:rgba(255,255,255,0.9);margin:8px 0 0;font-size:15px;">Your scheduled session starts in 15 minutes</p>
            </div>
            <div style="padding:32px 24px;">
              <p style="color:#374151;font-size:17px;margin:0 0 16px;">Hi ${profile.full_name || 'Student'},</p>
              <p style="color:#4b5563;font-size:15px;line-height:1.6;margin:0 0 20px;">
                This is a friendly reminder for your study session:
              </p>
              <div style="background:#f8f7ff;border-left:4px solid #6366f1;border-radius:8px;padding:20px;margin:20px 0;">
                <p style="margin:0 0 8px;color:#1f2937;font-size:18px;font-weight:600;">${s.title}</p>
                ${course ? `<p style="margin:4px 0;color:#6b7280;font-size:14px;">📘 ${course.name}</p>` : ''}
                ${subject ? `<p style="margin:4px 0;color:#6b7280;font-size:14px;">📚 ${subject.name}</p>` : ''}
                <p style="margin:4px 0;color:#6b7280;font-size:14px;">🕒 ${startTime} · ${s.duration_minutes} min</p>
              </div>
              <div style="text-align:center;margin:28px 0;">
                <a href="https://simplelecture.com/timetable" style="display:inline-block;background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:16px;font-weight:600;">Open My Time Table →</a>
              </div>
              <p style="color:#9ca3af;font-size:13px;text-align:center;margin:24px 0 0;">You're doing great. Consistency wins. 💪</p>
            </div>
          </div>
        `,
      });
      await supabase
        .from('study_timetable_sessions')
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq('id', s.id);
      sent++;
    } catch (e) {
      console.error('[timetable-reminder] send failed', s.id, e);
    }
  }

  return { processed: sessions.length, sent };
}

// Channel 'email': the server emails the reminder text with an /open link. Phone not involved.
// Claim before sending (reminder_sent_at), release on failure, so the next minute retries.
// Stops once the session is more than 10 minutes late. Guarded by TIMETABLE_REMINDERS_ENABLED.
async function sendChannelEmails(supabase: any): Promise<{ due: number; sent: number }> {
  if (Deno.env.get('TIMETABLE_REMINDERS_ENABLED') !== 'true') return { due: 0, sent: 0 };

  const nowMs = Date.now();
  const lo = new Date(nowMs - 10 * 60 * 1000).toISOString();
  const hi = new Date(nowMs + 1 * 60 * 1000).toISOString();

  const { data: sessions, error } = await supabase
    .from('study_timetable_sessions')
    .select('id, student_id, course_id, subject_id, chapter_id, topic_id, title, scheduled_at, duration_minutes')
    .eq('reminder_channel', 'email')
    .eq('status', 'pending')
    .is('reminder_sent_at', null)
    .gte('scheduled_at', lo)
    .lte('scheduled_at', hi);

  if (error) throw error;
  if (!sessions || sessions.length === 0) return { due: 0, sent: 0 };

  const transporter = makeTransporter();

  const studentIds = [...new Set(sessions.map((s: any) => s.student_id))];
  const { data: profiles } = await supabase.from('profiles').select('id, email, full_name').in('id', studentIds);
  const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));

  let sent = 0;
  for (const s of sessions) {
    const profile: any = profileMap.get(s.student_id);
    if (!profile?.email) continue;

    // Claim: only the run that flips reminder_sent_at from null sends.
    const { data: claimed } = await supabase
      .from('study_timetable_sessions')
      .update({ reminder_sent_at: new Date().toISOString() })
      .eq('id', s.id)
      .is('reminder_sent_at', null)
      .select('id');
    if (!claimed || claimed.length === 0) continue;

    const topic = String(s.title || 'your next topic').replace(/\s+/g, ' ').trim().slice(0, 120);
    const ids = { courseId: s.course_id, subjectId: s.subject_id, chapterId: s.chapter_id, topicId: s.topic_id };
    const isUuid = (v: unknown) => typeof v === 'string' && UUID_RE.test(v);
    let openPath = '/timetable';
    if (isUuid(s.topic_id) && isUuid(ids.courseId)) {
      const q = new URLSearchParams({ courseId: ids.courseId });
      if (isUuid(ids.subjectId)) q.set('subjectId', ids.subjectId as string);
      if (isUuid(ids.chapterId)) q.set('chapterId', ids.chapterId as string);
      openPath = `/open/topic/${s.topic_id}?${q.toString()}`;
    } else if (isUuid(s.chapter_id) && isUuid(ids.courseId)) {
      const q = new URLSearchParams({ courseId: ids.courseId });
      if (isUuid(ids.subjectId)) q.set('subjectId', ids.subjectId as string);
      openPath = `/open/chapter/${s.chapter_id}?${q.toString()}`;
    }
    const openUrl = `${APP_BASE}${openPath}`;
    const safeTopic = escapeHtml(topic);
    const safeName = escapeHtml(String(profile.full_name || 'Student'));
    const text = `Hey, it's time to study ${topic}. Tap to open the app.`;

    try {
      await transporter.sendMail({
        from: '"SimpleLecture" <notifications@simplelecture.com>',
        to: profile.email,
        subject: `Time to study ${topic}`,
        text: `${text}\n\n${openUrl}`,
        html: `
          <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;">
            <div style="background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);padding:32px 24px;text-align:center;border-radius:0 0 24px 24px;">
              <h1 style="color:#fff;margin:0;font-size:26px;">Time to Study!</h1>
            </div>
            <div style="padding:32px 24px;">
              <p style="color:#374151;font-size:17px;margin:0 0 16px;">Hi ${safeName},</p>
              <p style="color:#1f2937;font-size:17px;line-height:1.6;margin:0 0 20px;">
                Hey, it's time to study <strong>${safeTopic}</strong>. Tap to open the app.
              </p>
              <div style="text-align:center;margin:28px 0;">
                <a href="${escapeHtml(openUrl)}" style="display:inline-block;background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:16px;font-weight:600;">Open in app</a>
              </div>
            </div>
          </div>
        `,
      });
      sent++;
    } catch (e) {
      console.error('[timetable-reminder] channel email failed', s.id, (e as Error).message);
      // Release the claim so the next minute retries (until 10 minutes late).
      await supabase.from('study_timetable_sessions').update({ reminder_sent_at: null }).eq('id', s.id);
    }
  }

  return { due: sessions.length, sent };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(supabaseUrl, serviceKey);

    const legacy = await sendLegacyReminders(supabase);
    const channel = await sendChannelEmails(supabase);

    return new Response(
      JSON.stringify({
        processed: legacy.processed,
        sent: legacy.sent,
        channelEmails: channel,
      }),
      { headers: jsonHeaders },
    );
  } catch (err: any) {
    console.error('[send-timetable-reminders]', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: jsonHeaders,
    });
  }
});
