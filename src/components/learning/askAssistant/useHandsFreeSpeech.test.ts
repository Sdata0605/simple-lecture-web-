/**
 * Lifecycle / race tests for the hands-free speech engine, run WITHOUT a DOM.
 *
 * React's hooks are mocked with trivial stand-ins so useHandsFreeSpeech runs as
 * a plain function (one "render"); effects are collected and run manually to
 * simulate mount/unmount. SpeechRecognition, getUserMedia and AudioContext are
 * fakes we drive by hand, so we can reproduce the orderings a real mic produces
 * (slow permission prompts, Chrome ending sessions on its own, late events from
 * aborted instances, another feature grabbing the voice lock…).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── React stand-in ───────────────────────────────────────────────────────────
const h = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  cells: [] as Array<{ value: unknown }>,
}));

vi.mock("react", () => ({
  useRef: (v: unknown) => ({ current: v }),
  useState: (init: unknown) => {
    const cell = { value: typeof init === "function" ? (init as () => unknown)() : init };
    h.cells.push(cell);
    return [
      cell.value,
      (v: unknown) => {
        cell.value = typeof v === "function" ? (v as (p: unknown) => unknown)(cell.value) : v;
      },
    ];
  },
  useEffect: (fn: () => void | (() => void)) => {
    h.effects.push(fn);
  },
  useCallback: (fn: unknown) => fn,
}));

import { useHandsFreeSpeech, type HandsFreeSpeechOptions } from "./useHandsFreeSpeech";
import { voiceLock } from "@/lib/voiceLock";

// ── Fakes ────────────────────────────────────────────────────────────────────
type Handler<T = void> = ((e: T) => void) | null;

class FakeRecognition {
  static instances: FakeRecognition[] = [];
  lang = "";
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  started = false;
  aborted = false;
  stopped = false;
  onstart: Handler = null;
  onaudiostart: Handler = null;
  onsoundstart: Handler = null;
  onspeechstart: Handler = null;
  onspeechend: Handler = null;
  onresult: Handler<unknown> = null;
  onerror: Handler<{ error: string }> = null;
  onend: Handler = null;
  constructor() {
    FakeRecognition.instances.push(this);
  }
  start() {
    this.started = true;
  }
  stop() {
    this.stopped = true;
  }
  abort() {
    this.aborted = true;
  }
  // test drivers
  emitStart() {
    this.onstart?.();
  }
  emitSpeechStart() {
    this.onspeechstart?.();
  }
  emitResult(...chunks: Array<[string, boolean]>) {
    const results = chunks.map(([transcript, isFinal]) => Object.assign([{ transcript }], { isFinal }));
    this.onresult?.({ resultIndex: 0, results });
  }
  emitError(error: string) {
    this.onerror?.({ error });
  }
  emitEnd() {
    this.onend?.();
  }
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeStream() {
  const track = { stopped: false, stop() { this.stopped = true; } };
  return { track, stream: { getTracks: () => [track] } };
}

const audioContexts: Array<{ state: string; closed: boolean }> = [];
class FakeAudioContext {
  state = "running";
  closed = false;
  constructor() {
    audioContexts.push(this);
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    this.closed = true;
    this.state = "closed";
    return Promise.resolve();
  }
  createMediaStreamSource() {
    return { connect() {} };
  }
  createAnalyser() {
    return { fftSize: 0, smoothingTimeConstant: 0, getFloatTimeDomainData() {} };
  }
}

let gumCalls: Array<ReturnType<typeof deferred<unknown>>> = [];
let coarsePointer = false;

// ── Harness ──────────────────────────────────────────────────────────────────
function mount(overrides: Partial<HandsFreeSpeechOptions> = {}) {
  h.effects = [];
  h.cells = [];
  const opts: HandsFreeSpeechOptions = {
    onUtterance: vi.fn(),
    onUnclear: vi.fn(),
    onNoSpeechTimeout: vi.fn(),
    ...overrides,
  };
  const speech = useHandsFreeSpeech(opts);
  const [, statusCell, interimCell, errorCell] = h.cells;
  const cleanups = h.effects.map((fn) => fn()).filter((c): c is () => void => typeof c === "function");
  return {
    speech,
    opts,
    status: () => statusCell.value,
    interim: () => interimCell.value,
    error: () => errorCell.value,
    unmount: () => cleanups.forEach((c) => c()),
  };
}

const lastRec = () => FakeRecognition.instances[FakeRecognition.instances.length - 1];

/** Resolve the pending getUserMedia call and let start() finish. */
async function grantMic(index = gumCalls.length - 1) {
  const s = makeStream();
  gumCalls[index].resolve(s.stream);
  await vi.advanceTimersByTimeAsync(0);
  return s.track;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance", "Date"] });
  vi.spyOn(console, "log").mockImplementation(() => {});
  FakeRecognition.instances = [];
  audioContexts.length = 0;
  gumCalls = [];
  coarsePointer = false;
  vi.stubGlobal("window", {
    SpeechRecognition: FakeRecognition,
    AudioContext: FakeAudioContext,
    matchMedia: () => ({ matches: coarsePointer }),
  });
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: () => {
        const d = deferred<unknown>();
        gumCalls.push(d);
        return d.promise;
      },
    },
  });
  voiceLock.release("askAssistant");
  voiceLock.release("teaching");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────────────
describe("useHandsFreeSpeech — start/stop races", () => {
  it("stop() while the mic permission prompt is pending: no recognizer is ever started and the late stream is closed", async () => {
    const t = mount();
    const p = t.speech.start();
    expect(t.status()).toBe("starting");
    expect(voiceLock.getOwner()).toBe("askAssistant");

    t.speech.stop();
    expect(voiceLock.getOwner()).toBeNull();
    expect(t.status()).toBe("off");

    const track = await grantMic();
    await p;
    expect(FakeRecognition.instances).toHaveLength(0);
    expect(track.stopped).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("unmount while the permission prompt is pending: nothing starts afterwards, lock released, no timers", async () => {
    const t = mount();
    void t.speech.start();
    t.unmount();
    const track = await grantMic();
    expect(FakeRecognition.instances).toHaveLength(0);
    expect(track.stopped).toBe(true);
    expect(voiceLock.getOwner()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stop() then start() again before the first prompt resolves: only the second run opens the mic", async () => {
    const t = mount();
    void t.speech.start();
    t.speech.stop();
    const p2 = t.speech.start();
    expect(gumCalls).toHaveLength(2);

    const firstTrack = await grantMic(0); // the stale one resolves late
    expect(firstTrack.stopped).toBe(true);
    expect(FakeRecognition.instances).toHaveLength(0);

    const secondTrack = await grantMic(1);
    await p2;
    expect(secondTrack.stopped).toBe(false);
    expect(FakeRecognition.instances).toHaveLength(1);
    expect(lastRec().started).toBe(true);
    t.speech.stop();
  });

  it("calling start() twice while starting reuses the in-flight start (one prompt, one recognizer)", async () => {
    const t = mount();
    const p1 = t.speech.start();
    const p2 = t.speech.start();
    expect(p2).toBe(p1);
    expect(gumCalls).toHaveLength(1);
    await grantMic();
    expect(FakeRecognition.instances).toHaveLength(1);
    t.speech.stop();
  });

  it("stop() fully releases everything: recognizer aborted + detached, tracks stopped, AudioContext closed, lock released, no timers", async () => {
    const t = mount();
    void t.speech.start();
    const track = await grantMic();
    const rec = lastRec();
    rec.emitStart();
    expect(t.status()).toBe("listening");

    t.speech.stop();
    expect(rec.aborted).toBe(true);
    expect(rec.onend).toBeNull();
    expect(rec.onresult).toBeNull();
    expect(track.stopped).toBe(true);
    expect(audioContexts.every((c) => c.closed)).toBe(true);
    expect(voiceLock.getOwner()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    expect(t.status()).toBe("off");
  });

  it("mic permission denied → status 'error' / 'not-allowed', no recognizer, lock released", async () => {
    const t = mount();
    const p = t.speech.start();
    gumCalls[0].reject(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
    await p;
    expect(t.status()).toBe("error");
    expect(t.error()).toBe("not-allowed");
    expect(FakeRecognition.instances).toHaveLength(0);
    expect(voiceLock.getOwner()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("coarse pointer (mobile): never holds a getUserMedia stream alongside recognition", async () => {
    coarsePointer = true;
    const t = mount();
    await t.speech.start();
    expect(gumCalls).toHaveLength(0);
    expect(FakeRecognition.instances).toHaveLength(1);
    t.speech.stop();
  });
});

describe("useHandsFreeSpeech — end of utterance", () => {
  it("releases the mic BEFORE onUtterance runs (so a clip played from the callback can't be transcribed)", async () => {
    let stateAtCallback: { aborted: boolean; owner: string | null; track: boolean; status: unknown } | null = null;
    let track!: { stopped: boolean };
    const t = mount({
      onUtterance: () => {
        stateAtCallback = {
          aborted: lastRec().aborted,
          owner: voiceLock.getOwner(),
          track: track.stopped,
          status: t.status(),
        };
      },
    });
    void t.speech.start();
    track = await grantMic();
    const rec = lastRec();
    rec.emitStart();
    rec.emitSpeechStart();
    rec.emitResult(["what is osmosis", true]);
    expect(t.status()).toBe("hearing");

    vi.advanceTimersByTime(1500);
    expect(stateAtCallback).toEqual({ aborted: true, owner: null, track: true, status: "off" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("finalizes exactly once, with the text, and ignores late events from the aborted recognizer", async () => {
    const t = mount();
    void t.speech.start();
    await grantMic();
    const rec = lastRec();
    rec.emitSpeechStart();
    rec.emitResult(["explain", true], ["photosynthesis", false]);
    vi.advanceTimersByTime(1500);
    expect(t.opts.onUtterance).toHaveBeenCalledTimes(1);
    expect(t.opts.onUtterance).toHaveBeenCalledWith("explain photosynthesis");

    // Late events from the dead instance must be inert.
    rec.emitResult(["more words", true]);
    rec.emitEnd();
    vi.advanceTimersByTime(5000);
    expect(t.opts.onUtterance).toHaveBeenCalledTimes(1);
    expect(FakeRecognition.instances).toHaveLength(1);
  });

  it("a callback that immediately calls start() again (no clip to play) opens a clean new listen", async () => {
    const t = mount({
      onUnclear: () => {
        void t.speech.start();
      },
    });
    coarsePointer = true; // skip getUserMedia to keep the re-start synchronous-ish
    await t.speech.start();
    const first = lastRec();
    first.emitSpeechStart(); // noise, no words
    await vi.advanceTimersByTimeAsync(4000); // > noWordsGrace (3500)
    expect(first.aborted).toBe(true);
    expect(FakeRecognition.instances).toHaveLength(2);
    const second = lastRec();
    expect(second.started).toBe(true);
    expect(voiceLock.getOwner()).toBe("askAssistant");
    expect(t.interim()).toBe("");

    first.emitEnd(); // stale end from the first instance
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeRecognition.instances).toHaveLength(2); // no extra restart
    t.speech.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("no speech at all for 30 s → onNoSpeechTimeout once, mic released, timers gone", async () => {
    const t = mount();
    void t.speech.start();
    await grantMic();
    vi.advanceTimersByTime(29_900);
    expect(t.opts.onNoSpeechTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(t.opts.onNoSpeechTimeout).toHaveBeenCalledTimes(1);
    expect(lastRec().aborted).toBe(true);
    expect(voiceLock.getOwner()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("useHandsFreeSpeech — Chrome session restarts", () => {
  it("auto-restarts when Chrome ends a session, keeping words heard so far", async () => {
    const t = mount();
    void t.speech.start();
    await grantMic();
    const first = lastRec();
    first.emitSpeechStart();
    first.emitResult(["what is", false]); // never finalized
    first.emitEnd();
    vi.advanceTimersByTime(200);
    expect(FakeRecognition.instances).toHaveLength(2);
    const second = lastRec();
    second.emitResult(["the Krebs cycle", true]);
    vi.advanceTimersByTime(1500);
    expect(t.opts.onUtterance).toHaveBeenCalledWith("what is the Krebs cycle");
  });

  it("stop() while a restart is scheduled cancels it (no recognizer re-opens after the assistant stops)", async () => {
    const t = mount();
    void t.speech.start();
    await grantMic();
    lastRec().emitEnd();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    t.speech.stop();
    vi.advanceTimersByTime(5000);
    expect(FakeRecognition.instances).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("unmount while a restart is scheduled cancels it", async () => {
    const t = mount();
    void t.speech.start();
    await grantMic();
    lastRec().emitEnd();
    t.unmount();
    vi.advanceTimersByTime(5000);
    expect(FakeRecognition.instances).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(voiceLock.getOwner()).toBeNull();
  });

  it("backs off when sessions die instantly (restart storm)", async () => {
    coarsePointer = true;
    const t = mount();
    await t.speech.start();
    for (let i = 0; i < 5; i++) {
      lastRec().emitEnd();
      vi.advanceTimersByTime(150);
    }
    const before = FakeRecognition.instances.length;
    lastRec().emitEnd();
    vi.advanceTimersByTime(900);
    expect(FakeRecognition.instances.length).toBe(before); // 6th restart within 5 s waits ~1 s
    vi.advanceTimersByTime(200);
    expect(FakeRecognition.instances.length).toBe(before + 1);
    t.speech.stop();
  });

  it("three network errors in a row → 'error'/'network'; a result in between resets the count", async () => {
    const t = mount();
    void t.speech.start();
    await grantMic();
    const rec = lastRec();
    rec.emitError("network");
    rec.emitError("network");
    rec.emitResult(["hi", false]);
    rec.emitError("network");
    rec.emitError("network");
    expect(t.status()).not.toBe("error");
    rec.emitError("network");
    expect(t.status()).toBe("error");
    expect(t.error()).toBe("network");
    expect(voiceLock.getOwner()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("useHandsFreeSpeech — voice lock takeover", () => {
  it("another feature acquiring the mic stops us — but status ends as 'off', not 'error' (AskAIAssistant only reacts to 'error')", async () => {
    const t = mount();
    void t.speech.start();
    await grantMic();
    const rec = lastRec();
    rec.emitStart();
    voiceLock.acquire("teaching");
    expect(rec.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    // Documents the hand-off to the component: nothing tells it the mic died.
    expect(t.status()).toBe("off");
    expect(t.opts.onNoSpeechTimeout).not.toHaveBeenCalled();
    voiceLock.release("teaching");
  });
});
