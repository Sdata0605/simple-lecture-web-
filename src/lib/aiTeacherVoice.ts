// How the Ask AI teacher sounds. Gemini's voices have no accent or speed setting, so the accent and pace are
// asked for in words (here for the first message of a session; the ai-teacher edge function says the same in
// the teacher's own instructions), and the speed is also trimmed a little when the audio is played.

/** Said to the teacher at the start of every Ask AI session. */
export const TEACHER_VOICE_STYLE =
  "VOICE: when you speak English, use a clear Indian English accent, like a school teacher from India, never an American or British accent. Speak slowly and calmly, clearly slower than a normal conversation, with a short pause between sentences, so a school student can follow every word.";

/**
 * Speed of the teacher's voice when played back (1 = as generated). The model tends to ignore "speak slowly",
 * so the sound is also slowed by this much; below about 0.9 the voice starts to drag and drop in pitch.
 */
export const TEACHER_PLAYBACK_RATE = 0.92;
