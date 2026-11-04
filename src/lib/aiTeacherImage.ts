/**
 * Largest side (px) a photo is scaled down to before it is sent. The teacher reads far more detail than the
 * old 1400 px limit; this is only the size the photo is re-encoded at, not a limit on what the student uploads.
 */
export const QUESTION_IMAGE_MAX_SIDE = 2048;
/** Photos with a shorter side are enlarged to this, so small printed text is big enough for the teacher to read. */
export const QUESTION_IMAGE_MIN_SIDE = 1000;

export class QuestionImageError extends Error {}

/**
 * Target size for a photo, keeping the aspect ratio. Large photos shrink to maxSide; small screenshots
 * grow to minSide so the text is legible to the teacher.
 */
export function scaledSize(
  width: number,
  height: number,
  maxSide = QUESTION_IMAGE_MAX_SIDE,
  minSide = QUESTION_IMAGE_MIN_SIDE,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) throw new QuestionImageError("The photo could not be read. Please try another picture.");
  const longest = Math.max(width, height);
  const scale = longest > maxSide ? maxSide / longest : longest < minSide ? minSide / longest : 1;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Reads any picture the browser can open (JPG, PNG, WebP, GIF, BMP, SVG, and so on, of any size) and
 * returns it as a JPEG data URL that the teacher can read. White background is painted first, so
 * transparent pictures stay readable.
 */
export async function prepareQuestionImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new QuestionImageError(
      "Your browser could not open this picture. Please try a JPG or PNG, or take a new photo.",
    );
  });
  try {
    const { width, height } = scaledSize(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new QuestionImageError("Your browser could not prepare the photo. Please try another browser.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", 0.92);
  } finally {
    bitmap.close();
  }
}
