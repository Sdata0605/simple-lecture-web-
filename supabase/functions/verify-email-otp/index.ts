import { corsHeaders } from '../_shared/cors.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateRandomPassword(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%';
  let password = '';
  for (let i = 0; i < 24; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, otp_code, purpose, signup_data } = await req.json();

    if (!email || !otp_code || !purpose) {
      return new Response(JSON.stringify({ error: 'Email, OTP code, and purpose are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const cleanEmail = email.toLowerCase().trim();
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Find the latest unused OTP for this email+purpose
    const { data: otpRecord, error: fetchError } = await supabase
      .from('email_otp_verifications')
      .select('*')
      .eq('email', cleanEmail)
      .eq('purpose', purpose)
      .eq('verified', false)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fetchError || !otpRecord) {
      return new Response(JSON.stringify({ error: 'OTP expired or not found. Please request a new one.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check attempts
    if (otpRecord.attempts >= 3) {
      await supabase
        .from('email_otp_verifications')
        .update({ verified: true })
        .eq('id', otpRecord.id);

      return new Response(JSON.stringify({ error: 'Too many incorrect attempts. Please request a new OTP.' }), {
        status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify OTP
    const inputHash = await sha256(otp_code);
    if (inputHash !== otpRecord.otp_hash) {
      await supabase
        .from('email_otp_verifications')
        .update({ attempts: otpRecord.attempts + 1 })
        .eq('id', otpRecord.id);

      const remaining = 2 - otpRecord.attempts;
      return new Response(JSON.stringify({
        error: `Incorrect OTP. ${remaining > 0 ? `${remaining} attempt(s) remaining.` : 'Please request a new OTP.'}`
      }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Signup pre-flight, BEFORE the OTP is consumed, so someone who has to correct
    // their email or phone can retry with the code already in their inbox.
    let cleanPhone = '';
    if (purpose !== 'login') {
      if (!signup_data?.full_name || !signup_data?.phone) {
        return new Response(JSON.stringify({ error: 'Full name and phone are required for signup' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      cleanPhone = signup_data.phone.replace(/\D/g, '');

      // O(log n) indexed duplicate check on profiles table
      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', cleanEmail)
        .maybeSingle();
      if (existingProfile) {
        return new Response(JSON.stringify({ error: 'An account with this email already exists.' }), {
          status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // profiles.phone_number carries a UNIQUE index (idx_profiles_phone_unique) and is
      // written by the on_auth_user_created trigger. A collision therefore aborts the whole
      // auth.users insert, which GoTrue reports only as the opaque 500 "Database error
      // creating new user". Reject it here instead, with something the user can act on.
      const { data: existingPhone } = await supabase
        .from('profiles')
        .select('id')
        .eq('phone_number', cleanPhone)
        .maybeSingle();
      if (existingPhone) {
        return new Response(JSON.stringify({
          error: 'An account with this phone number already exists. Please log in instead.'
        }), {
          status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Mark OTP as used
    await supabase
      .from('email_otp_verifications')
      .update({ verified: true })
      .eq('id', otpRecord.id);

    let userEmail = cleanEmail;

    if (purpose === 'login') {
      // O(log n) indexed lookup on profiles table
      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', cleanEmail)
        .maybeSingle();

      if (!profile) {
        return new Response(JSON.stringify({ error: 'User not found' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Get the actual auth user email for magic link generation
      const { data: { user: authUser }, error: authError } = await supabase.auth.admin.getUserById(profile.id);
      if (authError || !authUser?.email) {
        return new Response(JSON.stringify({ error: 'Failed to retrieve user data' }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      userEmail = authUser.email;
    } else {
      // Signup: create user. Validation and duplicate checks already ran above.

      // Phone is deliberately NOT passed here: the Auth phone provider is disabled on this
      // project, so auth.users.phone is a liability rather than a source of truth. The number
      // lives in user_metadata and profiles.phone_number (what phone login actually reads);
      // auth.users.phone is mirrored below on a best-effort basis.
      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email: cleanEmail,
        password: generateRandomPassword(),
        email_confirm: true,
        user_metadata: {
          full_name: signup_data.full_name,
          phone: cleanPhone,
        },
      });

      if (createError) {
        console.error('Create user error:', createError);
        return new Response(JSON.stringify({ error: createError.message || 'Failed to create account' }), {
          status: (createError as { status?: number }).status || 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Mirror the phone onto auth.users. Skipped silently when the phone provider
      // is disabled — signup must not depend on that toggle.
      const { error: attachPhoneError } = await supabase.auth.admin.updateUserById(
        newUser.user.id,
        { phone: `+91${cleanPhone}`, phone_confirm: true },
      );
      if (attachPhoneError) {
        console.warn('Could not attach phone to auth user:', attachPhoneError.message);
      }

      // Update profile with phone
      await supabase
        .from('profiles')
        .update({ phone_number: cleanPhone })
        .eq('id', newUser.user.id);

      userEmail = newUser.user.email!;
    }

    // Generate session via magic link
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: userEmail,
    });

    if (linkError || !linkData) {
      console.error('Generate link error:', linkError);
      return new Response(JSON.stringify({ error: 'Failed to create session' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const actionLink = linkData.properties?.action_link;
    if (!actionLink) {
      return new Response(JSON.stringify({ error: 'Failed to generate auth link' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Parse token from URL and exchange for session
    const url = new URL(actionLink);
    const token_hash = url.searchParams.get('token') || url.hash?.split('token=')[1]?.split('&')[0];

    const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
      token_hash: token_hash || '',
      type: 'magiclink',
    });

    if (verifyError || !verifyData?.session) {
      console.error('Verify OTP error:', verifyError);
      return new Response(JSON.stringify({ error: 'Failed to create session' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      session: {
        access_token: verifyData.session.access_token,
        refresh_token: verifyData.session.refresh_token,
      },
      user: {
        id: verifyData.session.user.id,
        email: verifyData.session.user.email,
      },
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('verify-email-otp error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
