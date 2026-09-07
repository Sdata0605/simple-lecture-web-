import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { prompt, courseId } = await req.json();
    if (!prompt) throw new Error("Prompt is required");

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const { data: aiSettings, error: settingsError } = await supabaseAdmin
      .from('ai_settings')
      .select('setting_value')
      .eq('setting_key', 'ai_api_config')
      .maybeSingle();

    if (settingsError) {
      throw new Error(`Failed to load AI settings: ${settingsError.message}`);
    }

    const config = aiSettings?.setting_value as {
      enabled?: boolean;
      provider?: string;
      openrouter_api_key?: string;
    } | null;
    const openRouterApiKey = config?.openrouter_api_key?.trim();

    if (!config?.enabled || config.provider !== 'openrouter' || !openRouterApiKey) {
      return new Response(
        JSON.stringify({
          error: 'OpenRouter image generation is not configured. Enable OpenRouter and save its API key in Admin Settings.',
        }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Generating course image via OpenRouter');

    const response = await fetch('https://openrouter.ai/api/v1/images', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openRouterApiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://simplelecture.com',
        'X-Title': 'SimpleLecture',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-image',
        prompt,
        n: 1,
        aspect_ratio: '16:9',
        output_format: 'png',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenRouter image API error:', response.status, errorText.slice(0, 1000));
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (response.status === 401 || response.status === 403) {
        return new Response(JSON.stringify({ error: 'OpenRouter rejected the API key. Please check the key in Admin Settings.' }),
          { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: 'The OpenRouter account does not have enough credits for image generation.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      throw new Error(`OpenRouter image API returned ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const b64 = data?.data?.[0]?.b64_json;
    const mediaType = data?.data?.[0]?.media_type || 'image/png';

    if (!b64) {
      console.error('No image in OpenRouter response:', JSON.stringify(data).slice(0, 500));
      throw new Error("No image was generated");
    }

    const binaryString = atob(String(b64).replace(/^data:image\/\w+;base64,/, '').replace(/\s/g, ''));
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);

    const timestamp = Date.now();
    const folderPath = courseId || 'temp';
    const extension = mediaType === 'image/jpeg' ? 'jpg' : mediaType === 'image/webp' ? 'webp' : 'png';
    const fileName = `${folderPath}/ai_${timestamp}.${extension}`;

    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from('course-thumbnails')
      .upload(fileName, bytes.buffer, {
        contentType: mediaType,
        cacheControl: '3600',
        upsert: true,
      });

    if (uploadError) throw new Error(`Failed to upload image: ${uploadError.message}`);

    const { data: urlData } = supabaseAdmin.storage
      .from('course-thumbnails')
      .getPublicUrl(uploadData.path);

    return new Response(
      JSON.stringify({ imageUrl: urlData.publicUrl }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in ai-generate-image function:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
