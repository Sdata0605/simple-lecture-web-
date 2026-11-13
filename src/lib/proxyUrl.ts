import { SUPABASE_URL } from '@/lib/supabaseUrl';

const DIRECT_ORIGIN = "https://oxwhqvsoelqqsblmqkxx.supabase.co";
const PROXY_ORIGIN = SUPABASE_URL;

export function rewriteStorageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.startsWith(DIRECT_ORIGIN) ? url.replace(DIRECT_ORIGIN, PROXY_ORIGIN) : url;
}

const PUBLIC_OBJECT_PATH = "/storage/v1/object/public/";
const RENDER_IMAGE_PATH = "/storage/v1/render/image/public/";

/**
 * Returns a resized, WebP version of a public Supabase storage image using the
 * image-transform endpoint (e.g. a 4.5 MB PNG becomes a ~20 KB WebP at width 640).
 * Anything that is not a public storage object URL is returned unchanged.
 */
export function resizedStorageUrl(url: string | null | undefined, width: number, height: number): string | null {
  const u = rewriteStorageUrl(url);
  if (!u || !u.includes(PUBLIC_OBJECT_PATH)) return u;
  const base = u.split("?")[0];
  // Width AND height with resize=cover: the server crops to the card's shape.
  // (Width alone keeps the original height and stretches the image in the card.)
  return `${base.replace(PUBLIC_OBJECT_PATH, RENDER_IMAGE_PATH)}?width=${width}&height=${height}&resize=cover&quality=75&format=webp`;
}
