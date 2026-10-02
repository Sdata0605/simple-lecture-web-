#!/usr/bin/env python3
"""
Generate the pre-recorded voice lines for the lecture player's "Ask AI" voice
assistant, plus the typed TypeScript manifest the app imports.

Outputs (both fully regenerated on every run):
  public/assistant-audio/<category-folder>/<category-folder>-NN.mp3
  src/components/learning/askAssistant/assistantAudioManifest.ts

Usage (from the project root):
  python scripts/generate-assistant-audio.py            # regenerate everything
  python scripts/generate-assistant-audio.py --skip-existing   # only synthesize missing files

Requires: pip install edge-tts   (network access to Microsoft's Edge TTS service)

To change wording: edit LINES below and rerun. Files no longer referenced by
LINES are deleted so public/assistant-audio/ always matches the manifest.
Keep lines short (~1.5-4 s spoken, <= ~12 words), gender-neutral, no names,
no emojis, and never topic-specific (clips are reused across every subject).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import random
import re
import shutil
import sys
from pathlib import Path

import edge_tts

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

ROOT = Path(__file__).resolve().parent.parent
AUDIO_DIR = ROOT / "public" / "assistant-audio"
PUBLIC_URL_BASE = "/assistant-audio"
MANIFEST_PATH = ROOT / "src" / "components" / "learning" / "askAssistant" / "assistantAudioManifest.ts"

# Indian-English female voice, matching the narration voice used in answers.
PREFERRED_VOICES = ["en-IN-NeerjaExpressiveNeural", "en-IN-NeerjaNeural"]
# Slightly brisker and brighter than default for a warm, lively assistant feel.
# Kept conservative on purpose so it still sounds natural.
RATE = "+4%"
PITCH = "+2Hz"

CONCURRENCY = 4
MAX_ATTEMPTS = 3
MIN_BYTES = 2048

# ---------------------------------------------------------------------------
# The lines. Category keys must match AssistantClipCategory in
# src/components/learning/askAssistant/assistantAudioTypes.ts.
# Order matters: position N becomes <folder>-NN.mp3.
# ---------------------------------------------------------------------------

LINES: dict[str, list[str]] = {
    # Student tapped "Ask AI" mid-lecture. The mic opens the instant the clip
    # ends, so every line must invite them to speak right now.
    "greeting": [
        "How can I help you?",
        "Hey, what's the problem? Tell me.",
        "What doubts do you have?",
        "I'm listening. What's your question?",
        "Go ahead, ask me anything.",
        "Stuck somewhere? Tell me what's confusing you.",
        "Sure! What would you like to know?",
        "Okay, I'm all ears. What's the doubt?",
        "Paused for a question? Go ahead, I'm listening.",
        "Tell me, which part didn't make sense?",
        "Hi there! What can I clear up for you?",
        "Ask away, I'm right here.",
        "What's on your mind? Go ahead.",
        "Something confusing? Just tell me.",
        "Yes, tell me your doubt.",
        "Hello! What would you like me to explain?",
        "No problem, let's sort it out. What's the question?",
        "Need a hand? Ask me your question.",
        "Alright, what's bothering you in this part?",
        "Happy to help. What's your doubt?",
    ],
    # Lecture just finished; assistant opens automatically.
    "greetingEnd": [
        "That's the end of the lecture! Any doubts?",
        "And that wraps up the lecture. Anything you'd like to ask?",
        "Lecture done! Is anything still unclear?",
        "Great job finishing the lecture! Any questions for me?",
        "That's a wrap! Want me to explain anything again?",
        "You made it to the end! Any doubts before you move on?",
        "The lecture's over. Is there anything you'd like to revisit?",
        "Well done! Tell me if anything didn't click.",
        "All done! Ask me anything about what you just watched.",
        "That's it for this lecture. Any questions? I'm listening.",
    ],
    # Student came back from an answer.
    "followUp": [
        "Anything else you'd like to ask?",
        "Got another doubt? Go ahead.",
        "Does that help? Ask me more if you like.",
        "What else can I help you with?",
        "Any other questions? I'm listening.",
        "Is there anything else that's unclear?",
        "Want to dig deeper? Ask away.",
        "Anything more on your mind?",
        "Need me to explain something else?",
        "Any follow-up questions? Just tell me.",
        "Hope that cleared it up. What's next?",
        "Still curious? Ask me another one.",
    ],
    # Question received, request sent.
    "thinking": [
        "Got it, let me analyze your question.",
        "Okay, let me think about that.",
        "Good question! Give me a second.",
        "Alright, let me look into it.",
        "Hmm, let me check that for you.",
        "Understood. Let me work it out.",
        "Nice one! Let me find the answer.",
        "Okay, give me a moment.",
        "Let me go through the lecture material for that.",
        "Sure, let me figure this out.",
        "Great question. Let me take a look.",
        "Got your question. Working on it.",
        "One sec, let me find the best way to explain.",
        "Interesting! Let me dig into that.",
    ],
    # Request taking a while, nothing streamed yet.
    "stillThinking": [
        "Almost there, just a moment.",
        "Still working on it, hang on.",
        "Just a few more seconds.",
        "Putting it all together, one moment.",
        "Hang tight, I'm nearly done.",
        "This one needs a little more thought. Almost ready.",
        "Bear with me, it's coming together.",
        "Just finishing up, stay with me.",
        "Nearly there, thanks for waiting.",
        "Still on it. It won't be long.",
    ],
    # First part of the answer arrived.
    "found": [
        "Found it! Here's what I've got.",
        "Here you go!",
        "Okay, here's the answer.",
        "Got it! Let me explain.",
        "Alright, here's how it works.",
        "Here's what I found.",
        "Done! Take a look.",
        "There we go. Here's the explanation.",
        "Okay, this should help.",
        "Great, I've got it. Here it is.",
        "Here's a clear way to think about it.",
        "Right, let's go through it.",
    ],
    # Text answer shown, animated explanation still rendering.
    "preparingVisual": [
        "I'm preparing a visual explanation. Read along meanwhile.",
        "A visual is on its way. Have a read while it loads.",
        "I'm also making an animation for this. Read the answer meanwhile.",
        "Hang on, I'm drawing this out for you. Read along for now.",
        "Your visual explanation is being prepared. Start reading meanwhile.",
        "Creating a quick animation. The text is ready to read.",
        "While I build the visual, go through the answer.",
        "A step-by-step visual is coming. Read ahead for now.",
        "I'm turning this into a visual. It'll be ready shortly.",
        "Give the answer a read. The visual will follow soon.",
    ],
    # Question isn't covered by this subject's material.
    "outOfScope": [
        "Hmm, I couldn't find that in this subject's material. Try asking about this lecture.",
        "That seems outside this subject. Could you ask something from the lecture?",
        "I'm not sure that's covered here. Try a question about this lecture.",
        "That's a bit beyond this course. Ask me something from this lesson.",
        "I can only help with this subject's material. Try another question?",
        "Hmm, that's not in this course. Ask me about what you're studying here.",
        "I don't see that in this subject. Could you ask it around the lecture?",
        "That one's outside my notes for this course. Try something from the lecture.",
    ],
    # Speech detected but transcript empty / too short. Mic reopens after.
    "didntCatch": [
        "Sorry, I didn't quite catch that. Could you say it again?",
        "Hmm, I missed that. One more time?",
        "I couldn't hear you clearly. Please try again.",
        "Sorry, could you repeat that?",
        "That was a bit unclear. Say it once more?",
        "Pardon? I didn't get that.",
        "Oops, I missed it. Please ask again.",
        "Could you speak a little louder and try again?",
        "I didn't catch the full question. Please repeat it.",
        "Sorry, it cut out. Try once more?",
    ],
    # Request failed.
    "error": [
        "Oops, something went wrong on my side. Please try again.",
        "Sorry, I ran into a problem. Could you try that again?",
        "Hmm, that didn't work. Let's give it another shot.",
        "Something went wrong there. Please ask once more.",
        "Sorry, I hit a snag. Try again in a moment.",
        "Looks like a connection problem. Please try again.",
        "My apologies, I couldn't finish that. Please try again.",
        "That didn't go through. Could you ask again?",
    ],
    # Listened a long time without hearing anything.
    "stillThere": [
        "I'm still here. Ask me anything, or type it below.",
        "Take your time. I'm listening whenever you're ready.",
        "Still there? Go ahead and ask your question.",
        "No rush. You can also type your question below.",
        "I'm ready when you are. Just speak up.",
        "Didn't hear anything yet. Ask away, or type it instead.",
        "Whenever you're ready, I'm here to help.",
        "Still with me? Tell me your doubt, or type it below.",
    ],
}

# ---------------------------------------------------------------------------
# Implementation
# ---------------------------------------------------------------------------


def kebab(name: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "-", name).lower()


def build_clips() -> list[dict]:
    clips = []
    for category, lines in LINES.items():
        folder = kebab(category)
        for i, text in enumerate(lines, start=1):
            stem = f"{folder}-{i:02d}"
            clips.append(
                {
                    "id": stem,
                    "category": category,
                    "text": text,
                    "src": f"{PUBLIC_URL_BASE}/{folder}/{stem}.mp3",
                    "path": AUDIO_DIR / folder / f"{stem}.mp3",
                }
            )
    return clips


def is_valid_mp3(path: Path) -> bool:
    try:
        if path.stat().st_size < MIN_BYTES:
            return False
        with path.open("rb") as f:
            head = f.read(3)
    except OSError:
        return False
    if head[:3] == b"ID3":
        return True
    return len(head) >= 2 and head[0] == 0xFF and (head[1] & 0xE0) == 0xE0


async def synthesize(text: str, voice: str, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".mp3.tmp")
    try:
        await edge_tts.Communicate(text, voice, rate=RATE, pitch=PITCH).save(str(tmp))
        if not is_valid_mp3(tmp):
            raise RuntimeError(f"output invalid or too small ({tmp.stat().st_size if tmp.exists() else 0} bytes)")
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            tmp.unlink()


async def pick_voice() -> str:
    voices = await edge_tts.list_voices()
    available = {v["ShortName"] for v in voices}
    probe = AUDIO_DIR / ".voice-probe.mp3"
    for voice in PREFERRED_VOICES:
        if voice not in available:
            print(f"[voice] {voice} not offered by the service, skipping")
            continue
        try:
            await synthesize("Hello there.", voice, probe)
            return voice
        except Exception as exc:  # noqa: BLE001
            print(f"[voice] {voice} failed a probe synthesis ({exc}), trying next")
        finally:
            if probe.exists():
                probe.unlink()
    raise SystemExit(f"None of the preferred voices are usable: {PREFERRED_VOICES}")


async def generate_all(clips: list[dict], voice: str, skip_existing: bool) -> tuple[list[dict], list[tuple[dict, str]]]:
    sem = asyncio.Semaphore(CONCURRENCY)
    retried: list[dict] = []
    failed: list[tuple[dict, str]] = []

    async def worker(clip: dict) -> None:
        if skip_existing and is_valid_mp3(clip["path"]):
            return
        last_err = ""
        for attempt in range(1, MAX_ATTEMPTS + 1):
            async with sem:
                try:
                    await synthesize(clip["text"], voice, clip["path"])
                    if attempt > 1:
                        retried.append(clip)
                    print(f"  ok   {clip['id']}" + (f" (attempt {attempt})" if attempt > 1 else ""))
                    return
                except Exception as exc:  # noqa: BLE001
                    last_err = f"{type(exc).__name__}: {exc}"
                    print(f"  fail {clip['id']} attempt {attempt}/{MAX_ATTEMPTS}: {last_err}")
            if attempt < MAX_ATTEMPTS:
                await asyncio.sleep(1.5 * 2 ** (attempt - 1) + random.random())
        failed.append((clip, last_err))

    await asyncio.gather(*(worker(c) for c in clips))
    return retried, failed


def remove_stale(clips: list[dict]) -> list[Path]:
    keep = {c["path"].resolve() for c in clips}
    removed = []
    if not AUDIO_DIR.exists():
        return removed
    for p in sorted(AUDIO_DIR.rglob("*"), reverse=True):
        if p.is_file() and p.resolve() not in keep:
            p.unlink()
            removed.append(p)
        elif p.is_dir() and not any(p.iterdir()):
            shutil.rmtree(p)
    return removed


def write_manifest(clips: list[dict], voice: str) -> None:
    out = [
        "// AUTO-GENERATED by scripts/generate-assistant-audio.py — do not edit by hand.",
        'import type { AssistantClip } from "./assistantAudioTypes";',
        "",
        f"export const ASSISTANT_VOICE = {json.dumps(voice)};",
        "",
        "export const ASSISTANT_CLIPS: readonly AssistantClip[] = [",
    ]
    for c in clips:
        out.append(
            "  { "
            f"id: {json.dumps(c['id'])}, "
            f"category: {json.dumps(c['category'])}, "
            f"text: {json.dumps(c['text'], ensure_ascii=False)}, "
            f"src: {json.dumps(c['src'])}"
            " },"
        )
    out.append("];")
    out.append("")
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text("\n".join(out), encoding="utf-8", newline="\n")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--skip-existing", action="store_true", help="only synthesize clips whose MP3 is missing or invalid")
    args = parser.parse_args()

    clips = build_clips()
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)

    voice = asyncio.run(pick_voice())
    print(f"Voice: {voice}  rate={RATE} pitch={PITCH}  clips={len(clips)}")

    retried, failed = asyncio.run(generate_all(clips, voice, args.skip_existing))

    removed = remove_stale(clips)
    for p in removed:
        print(f"  removed stale {p.relative_to(ROOT)}")

    print()
    print("Summary:")
    for category, lines in LINES.items():
        print(f"  {category:16s} {len(lines)}")
    if retried:
        print(f"Needed retries: {', '.join(c['id'] for c in retried)}")
    if failed:
        print(f"\nFAILED ({len(failed)} clip(s)); manifest NOT written:")
        for clip, err in failed:
            print(f"  {clip['id']}: {clip['text']!r} -> {err}")
        return 1

    write_manifest(clips, voice)
    total = sum(c["path"].stat().st_size for c in clips)
    print(f"Wrote {len(clips)} clips ({total / 1024:.1f} KB) and {MANIFEST_PATH.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
