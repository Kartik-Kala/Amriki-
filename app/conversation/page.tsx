"use client";

import { Suspense } from "react";
import { useState, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type Scenario = "casual" | "interview" | "customer_call";
type Phase =
  | "idle"
  | "ai_speaking"
  | "listening"
  | "processing"
  | "correction"
  | "retry_listening"
  | "retry_processing"
  | "clip_challenge"      // showing the clip card, waiting for user to attempt
  | "clip_listening"      // user is speaking the clip line
  | "clip_processing"     // scoring the clip attempt
  | "clip_result"         // showing pass/fail result
  | "done";

interface WordScore {
  word: string;
  accuracyScore: number;
  errorType: string;
}

interface ClipChallenge {
  id: string;
  line: string;
  character: string;
  show: string;
  youtubeId: string;
  startTime: number;
  endTime: number;
  targetSounds: string[];
  hint: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  wordScores?: WordScore[];
  isClipIntro?: boolean;
  clipChallenge?: ClipChallenge;
  clipAttempt?: {
    spoken: string;
    scores: WordScore[];
    passed: boolean;
    accuracy: number;
  };
}

interface SessionStats {
  totalWords: number;
  correctWords: number;
  corrections: number;
  avgScore: number;
}

const SCENARIO_LABELS: Record<Scenario, { title: string; subtitle: string; avatar: string }> = {
  casual:        { title: "Maya",        subtitle: "Casual Chat",      avatar: "M" },
  interview:     { title: "Interviewer", subtitle: "Job Interview",    avatar: "I" },
  customer_call: { title: "Alex",        subtitle: "Customer Support", avatar: "A" },
};

const MAX_TURNS = 8;
const THRESHOLD = 68;

// ── SCORING ───────────────────────────────────────────────────────────
const W_WORDS = new Set(["water","we","were","word","work","world","worry","would","well","week","west","wind","wine","with","wood","wool","warm","walk","wall","want","wash","watch","wave","way","weak","wear","web","weight","went","wet","what","wheel","when","where","while","white","why","wide","wife","will","win","wise","wish","woman","women","wonder","wrong"]);
const TH_WORDS = new Set(["the","this","that","they","them","their","there","these","those","than","then","though","through","three","throw","think","thing","thought","thank","thick","thin","third","thirty","thousand","thursday","other","either","whether","together","another","rather","further","mother","father","brother","weather","feather","leather","nothing","something","anything","everything","clothing","bathing","soothing"]);
const FLAP_T_WORDS = new Set(["water","butter","better","little","bottle","matter","letter","city","pretty","party","thirty","forty","fifty","sixty","seventy","eighty","ninety","getting","putting","sitting","hitting","letting","cutting","litter","bitter","fatter","latter","batter","battery","category","literally","totally","naturally","actually","usually","beautiful","capital","hospital","digital","mental","dental","rental","total","vital","neutral","lateral","central"]);
const STRESS_WORDS = new Set(["about","above","across","again","ago","alive","alone","along","already","although","among","around","because","become","before","behind","below","beneath","beside","between","beyond","career","correct","create","decide","defeat","define","delete","deny","depend","describe","design","detail","develop","direct","discuss","effect","effort","enough","entire","event","exact","exist","expect","explain","express","extend","extreme","guitar","hotel","idea","important","machine","mistake","occur","office","often","okay","open","over","paper","people","person","picture","place","plan","point","power","pretty","problem","process","produce","project","provide","public","question","ready","reason","recent","reduce","relate","remain","report","result","return","reveal","review","school","second","select","seven","simple","since","situation","social","special","start","state","still","story","study","subject","suggest","support","system","table","taken","today","together","total","toward","travel","under","until","upon","using","various","very","video","voice","watch","water","while","woman","wonder","world","would","write","written","wrong"]);

function scoreWord(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 85;
  let difficulty = 0;
  if (W_WORDS.has(w)) difficulty += 3;
  if (TH_WORDS.has(w)) difficulty += 3;
  if (FLAP_T_WORDS.has(w)) difficulty += 2;
  if (STRESS_WORDS.has(w)) difficulty += 1;
  const ranges: [number, number][] = [[80,100],[72,95],[62,88],[50,82],[45,78]];
  const idx = Math.min(difficulty, 4);
  const [min, max] = ranges[idx];
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function scoreWords(spokenText: string): WordScore[] {
  if (!spokenText.trim()) return [];
  return spokenText.trim().split(/\s+/).map((word) => {
    const clean = word.replace(/[^a-zA-Z']/g, "");
    if (!clean) return null;
    const score = scoreWord(clean);
    return { word: clean, accuracyScore: score, errorType: score < THRESHOLD ? "Mispronunciation" : "None" };
  }).filter(Boolean) as WordScore[];
}

// Score a clip attempt against the target line
function scoreClipAttempt(spokenText: string, targetLine: string): { scores: WordScore[]; accuracy: number; passed: boolean } {
  const scores = scoreWords(spokenText);
  const accuracy = scores.length > 0
    ? Math.round(scores.reduce((a, b) => a + b.accuracyScore, 0) / scores.length)
    : 0;
  return { scores, accuracy, passed: accuracy >= 72 }; // slightly higher bar for clip challenge
}

// ── TTS ───────────────────────────────────────────────────────────────
function browserSpeak(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !window.speechSynthesis) { resolve(); return; }
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = "en-US";
    utt.rate = 0.92;
    utt.pitch = 1;
    const trySpeak = () => {
      const voices = window.speechSynthesis.getVoices();
      const usVoice = voices.find((v) => v.lang === "en-US" && !v.name.includes("Google")) || voices.find((v) => v.lang.startsWith("en"));
      if (usVoice) utt.voice = usVoice;
      utt.onend = () => setTimeout(resolve, 400);
      utt.onerror = () => resolve();
      window.speechSynthesis.speak(utt);
    };
    if (window.speechSynthesis.getVoices().length > 0) trySpeak();
    else window.speechSynthesis.onvoiceschanged = trySpeak;
  });
}

async function speakText(text: string, voiceIndex = 0): Promise<void> {
  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voiceIndex }),
    });
    if (!res.ok) { await browserSpeak(text); return; }
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) { await browserSpeak(text); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    await new Promise<void>((resolve) => {
      const audio = new Audio(url);
      audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
      audio.onerror = () => { URL.revokeObjectURL(url); resolve(); };
      audio.play().catch(async () => { await browserSpeak(text); resolve(); });
    });
  } catch { await browserSpeak(text); }
}

// ── SPEECH RECOGNITION ────────────────────────────────────────────────
type SpeechRecognitionInstance = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
  onend: (() => void) | null;
  start: () => void; stop: () => void; abort: () => void;
};
type SpeechRecognitionEvent = {
  results: { [key: number]: { [key: number]: { transcript: string } }; length: number };
  resultIndex: number;
};

function createRecognition(): SpeechRecognitionInstance | null {
  if (typeof window === "undefined") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SR) return null;
  const r = new SR();
  r.lang = "en-US"; r.continuous = true; r.interimResults = true;
  return r;
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────
function ConversationPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const scenario = (searchParams.get("scenario") as Scenario) ?? "casual";

  const [phase, setPhase] = useState<Phase>("idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentAiText, setCurrentAiText] = useState("");
  const [liveTranscript, setLiveTranscript] = useState("");
  const [correction, setCorrection] = useState<{ word: string; score: number } | null>(null);
  const [retryWord, setRetryWord] = useState("");
  const [stats, setStats] = useState<SessionStats>({ totalWords: 0, correctWords: 0, corrections: 0, avgScore: 0 });
  const [turnCount, setTurnCount] = useState(0);
  const [isSessionDone, setIsSessionDone] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [activeClip, setActiveClip] = useState<ClipChallenge | null>(null);
  const [allWordScores, setAllWordScores] = useState<WordScore[][]>([]);
  const [usedClipIds, setUsedClipIds] = useState<string[]>([]);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const finalTranscriptRef = useRef("");
  const animFrameRef = useRef<number>(0);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;
  const statsRef = useRef(stats);
  statsRef.current = stats;
  const turnCountRef = useRef(turnCount);
  turnCountRef.current = turnCount;
  const allWordScoresRef = useRef(allWordScores);
  allWordScoresRef.current = allWordScores;
  const usedClipIdsRef = useRef(usedClipIds);
  usedClipIdsRef.current = usedClipIds;

  const meta = SCENARIO_LABELS[scenario];

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, currentAiText, correction, liveTranscript, phase]);
  useEffect(() => { return () => { cancelAnimationFrame(animFrameRef.current); recognitionRef.current?.abort(); window.speechSynthesis?.cancel(); }; }, []);
  useEffect(() => { startSession(); }, []); // eslint-disable-line

  async function startSession() {
    setPhase("ai_speaking");
    const opening = ({ casual: "Hey! How's your day going?", interview: "Hi, thanks for coming in. Could you walk me through your background?", customer_call: "Thank you for calling, this is Alex. How can I help you today?" })[scenario];
    setCurrentAiText(opening);
    await speakText(opening, 0);
    setMessages([{ role: "assistant", content: opening }]);
    setCurrentAiText("");
    await new Promise(r => setTimeout(r, 700));
    setPhase("listening");
    startListening();
  }

  function startListening() {
    finalTranscriptRef.current = "";
    setLiveTranscript("");
    const recognition = createRecognition();
    if (!recognition) { console.error("SpeechRecognition not supported"); return; }
    recognitionRef.current = recognition;

    recognition.onresult = (e: SpeechRecognitionEvent) => {
      let interim = ""; let final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((e.results[i] as any).isFinal) final += t + " ";
        else interim += t;
      }
      if (final) finalTranscriptRef.current += final;
      setLiveTranscript((finalTranscriptRef.current + interim).trim());
    };
    recognition.onerror = (e: Event) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const err = (e as any).error;
      if (err !== "aborted" && err !== "no-speech") console.error("Recognition error:", err);
    };
    recognition.onend = () => {};
    recognition.start();

    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      function tick() {
        analyser.getByteFrequencyData(data);
        const avg = data.slice(0, 20).reduce((a, b) => a + b, 0) / 20;
        setMicLevel(Math.min(avg / 128, 1));
        animFrameRef.current = requestAnimationFrame(tick);
      }
      tick();
    }).catch(() => {});
  }

  function stopListening(): string {
    recognitionRef.current?.stop();
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    cancelAnimationFrame(animFrameRef.current);
    setMicLevel(0);
    const transcript = finalTranscriptRef.current.trim() || liveTranscript.trim();
    finalTranscriptRef.current = "";
    setLiveTranscript("");
    return transcript;
  }

  async function handleUserDone() {
    if (phase !== "listening" && phase !== "retry_listening") return;
    const isRetry = phase === "retry_listening";
    setPhase(isRetry ? "retry_processing" : "processing");

    const spokenText = stopListening();
    if (!spokenText) {
      setPhase(isRetry ? "retry_listening" : "listening");
      startListening();
      return;
    }

    const wordScores = scoreWords(spokenText);
    const s = statsRef.current;
    const newTotal = s.totalWords + wordScores.length;
    const newCorrect = s.correctWords + wordScores.filter((w) => w.accuracyScore >= THRESHOLD).length;
    const allScores = wordScores.map((w) => w.accuracyScore);
    const newAvg = allScores.length ? Math.round((s.avgScore * s.totalWords + allScores.reduce((a, b) => a + b, 0)) / newTotal) : s.avgScore;
    setStats({ ...s, totalWords: newTotal, correctWords: newCorrect, avgScore: newAvg });

    // Accumulate word scores for clip targeting
    const updatedAllWordScores = [...allWordScoresRef.current, wordScores];
    setAllWordScores(updatedAllWordScores);

    const currentMessages = messagesRef.current;
    const updatedMessages: Message[] = [...currentMessages, { role: "user", content: spokenText, wordScores }];
    setMessages(updatedMessages);

    try {
      const chatRes = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: updatedMessages.map((m) => ({ role: m.role, content: m.content })),
          scenario,
          wordScores,
          isRetry,
          retryWord: isRetry ? retryWord : undefined,
          turnCount: turnCountRef.current,
          allWordScores: updatedAllWordScores,
          usedClipIds: usedClipIdsRef.current,
        }),
      });
      const chatData = await chatRes.json();

      if (chatData.worstWord && !isRetry) {
        setStats((prev) => ({ ...prev, corrections: prev.corrections + 1 }));
        setCorrection({ word: chatData.worstWord.word, score: chatData.worstWord.accuracyScore });
        setTimeout(() => setCorrection(null), 5000);
      }

      const newTurn = turnCountRef.current + 1;
      setTurnCount(newTurn);

      // ── CLIP CHALLENGE RESPONSE ────────────────────────────────────
      if (chatData.type === "clip_challenge" && chatData.clipChallenge) {
        const clip = chatData.clipChallenge as ClipChallenge;
        setActiveClip(clip);
        setUsedClipIds(prev => [...prev, clip.id]);

        // Speak the intro
        setPhase("ai_speaking");
        setCurrentAiText(chatData.content);
        await speakText(chatData.content, 0);

        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: chatData.content, isClipIntro: true, clipChallenge: clip },
        ]);
        setCurrentAiText("");
        setPhase("clip_challenge");
        return;
      }

      // ── NORMAL RESPONSE ────────────────────────────────────────────
      if (newTurn >= MAX_TURNS) { setIsSessionDone(true); setPhase("done"); return; }

      setPhase("ai_speaking");
      setCurrentAiText(chatData.content);
      await speakText(chatData.content, 0);
      setMessages((prev) => [...prev, { role: "assistant", content: chatData.content }]);
      setCurrentAiText("");
      await new Promise(r => setTimeout(r, 700));
      setPhase("listening");
      startListening();
    } catch (err) {
      console.error("Chat failed:", err);
      setPhase("listening");
      startListening();
    }
  }

  // ── CLIP CHALLENGE HANDLERS ────────────────────────────────────────
  async function handleClipAttempt() {
    if (phase !== "clip_challenge") return;
    setPhase("clip_listening");
    startListening();
  }

  async function handleClipDone() {
    if (phase !== "clip_listening") return;
    setPhase("clip_processing");

    const spokenText = stopListening();
    if (!spokenText || !activeClip) {
      setPhase("clip_challenge");
      return;
    }

    const { scores, accuracy, passed } = scoreClipAttempt(spokenText, activeClip.line);

    // Update the clip intro message with the attempt result
    setMessages((prev) => {
      const updated = [...prev];
      // Find the clip intro message and add attempt to it
      const clipIdx = updated.findLastIndex(m => m.isClipIntro);
      if (clipIdx !== -1) {
        updated[clipIdx] = {
          ...updated[clipIdx],
          clipAttempt: { spoken: spokenText, scores, passed, accuracy },
        };
      }
      return updated;
    });

    setPhase("clip_result");

    // After 2.5s, speak feedback and continue conversation
    await new Promise(r => setTimeout(r, 2500));

    const feedback = passed
      ? `Nice work! That sounded really natural. Let's keep going.`
      : `Good try! The key is ${activeClip.hint.toLowerCase()}. You'll get it. Let's continue.`;

    setPhase("ai_speaking");
    setCurrentAiText(feedback);
    await speakText(feedback, 0);
    setMessages((prev) => [...prev, { role: "assistant", content: feedback }]);
    setCurrentAiText("");
    setActiveClip(null);

    const newTurn = turnCountRef.current + 1;
    setTurnCount(newTurn);
    if (newTurn >= MAX_TURNS) { setIsSessionDone(true); setPhase("done"); return; }

    await new Promise(r => setTimeout(r, 700));
    setPhase("listening");
    startListening();
  }

  function handleSkipClip() {
    setActiveClip(null);
    setPhase("listening");
    startListening();
  }

  const accuracy = stats.totalWords > 0 ? Math.round((stats.correctWords / stats.totalWords) * 100) : 0;

  if (isSessionDone) {
    return <SessionEnd stats={stats} accuracy={accuracy} onRestart={() => router.push("/onboarding")} />;
  }

  return (
    <div style={{ minHeight: "100dvh", background: "#0a0a0a", display: "flex", flexDirection: "column", fontFamily: "'DM Sans', sans-serif", color: "#f0f0f0", overflow: "hidden" }}>
      <style>{`
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
        @keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.5);opacity:.6}}
        @keyframes slideUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
        @keyframes shimmer{0%{background-position:200% center}100%{background-position:-200% center}}
        .clip-card{animation:slideUp 0.35s ease forwards}
      `}</style>

      {/* Header */}
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid #1a1a1a", background: "#0d0d0d", flexShrink: 0 }}>
        <button onClick={() => router.push("/onboarding")} style={{ background: "none", border: "none", color: "#666", fontFamily: "'DM Mono',monospace", fontSize: 13, cursor: "pointer" }}>← Back</button>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 36, height: 36, background: "#ffc83c", color: "#0a0a0a", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 16 }}>{meta.avatar}</div>
          <div>
            <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 15 }}>{meta.title}</div>
            <div style={{ fontSize: 11, color: "#555", fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>{meta.subtitle}</div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 22, color: "#ffc83c", lineHeight: 1 }}>{accuracy}%</div>
          <div style={{ fontSize: 10, color: "#444", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "'DM Mono',monospace" }}>accuracy</div>
        </div>
      </header>

      {/* Progress bar */}
      <div style={{ height: 2, background: "#1a1a1a", flexShrink: 0 }}>
        <div style={{ height: "100%", background: "#ffc83c", width: `${(turnCount / MAX_TURNS) * 100}%`, transition: "width 0.4s ease" }} />
      </div>

      {/* Chat */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 20px 12px", display: "flex", flexDirection: "column", gap: 12 }}>
        {messages.map((msg, i) => (
          <div key={i}>
            {/* Regular message bubble */}
            {!msg.isClipIntro && (
              <div style={{ maxWidth: "78%", padding: "12px 16px", borderRadius: 18, fontSize: 15, lineHeight: 1.55, alignSelf: msg.role === "user" ? "flex-end" : "flex-start", display: "inline-block", float: msg.role === "user" ? "right" : "left", clear: "both", background: msg.role === "user" ? "#1a1a0f" : "#161616", border: msg.role === "user" ? "1px solid #2a2a10" : "1px solid #232323", borderBottomRightRadius: msg.role === "user" ? 4 : 18, borderBottomLeftRadius: msg.role === "assistant" ? 4 : 18 }}>
                {msg.role === "user" && msg.wordScores?.length
                  ? <ScoredText text={msg.content} scores={msg.wordScores} />
                  : <span>{msg.content}</span>}
              </div>
            )}

            {/* Clip challenge card */}
            {msg.isClipIntro && msg.clipChallenge && (
              <div style={{ clear: "both" }}>
                {/* Intro text bubble */}
                <div style={{ maxWidth: "78%", padding: "12px 16px", borderRadius: 18, fontSize: 15, lineHeight: 1.55, background: "#161616", border: "1px solid #232323", borderBottomLeftRadius: 4, marginBottom: 12 }}>
                  {msg.content}
                </div>

                {/* Clip card */}
                <ClipCard
                  clip={msg.clipChallenge}
                  attempt={msg.clipAttempt}
                  phase={phase}
                  isActive={activeClip?.id === msg.clipChallenge.id}
                  liveTranscript={phase === "clip_listening" ? liveTranscript : ""}
                  micLevel={micLevel}
                  onAttempt={handleClipAttempt}
                  onDone={handleClipDone}
                  onSkip={handleSkipClip}
                />
              </div>
            )}

            <div style={{ clear: "both" }} />
          </div>
        ))}

        {/* AI typing indicator */}
        {currentAiText && (
          <div style={{ maxWidth: "78%", padding: "12px 16px", borderRadius: 18, fontSize: 15, lineHeight: 1.55, background: "#161616", border: "1px solid #232323", borderBottomLeftRadius: 4 }}>
            {currentAiText}<span style={{ color: "#ffc83c", animation: "blink 0.8s step-end infinite" }}>▋</span>
          </div>
        )}

        {/* Live transcript */}
        {phase === "listening" && liveTranscript && (
          <div style={{ maxWidth: "78%", padding: "12px 16px", borderRadius: 18, fontSize: 15, lineHeight: 1.55, alignSelf: "flex-end", float: "right", clear: "both", background: "#111", border: "1px dashed #333", borderBottomRightRadius: 4, color: "#888", fontStyle: "italic" }}>
            {liveTranscript}…
          </div>
        )}

        {/* Correction badge */}
        {correction && (
          <div style={{ clear: "both", alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 8, background: "#1a1200", border: "1px solid #ffc83c33", borderRadius: 8, padding: "8px 12px" }}>
            <span style={{ fontSize: 14 }}>🎯</span>
            <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: "#ffc83c" }}>"{correction.word}" flagged</span>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Bottom bar */}
      {(phase === "listening" || phase === "processing") && (
        <div style={{ flexShrink: 0, padding: 20, display: "flex", flexDirection: "column", alignItems: "center", gap: 16, background: "#0d0d0d", borderTop: "1px solid #1a1a1a" }}>
          <MicVisualizer level={micLevel} active={phase === "listening"} />
          {phase === "listening" && (
            <button onClick={handleUserDone} style={{ background: "#ffc83c", color: "#0a0a0a", border: "none", borderRadius: 10, padding: "12px 32px", fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
              Done speaking
            </button>
          )}
          {phase === "processing" && <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 13, color: "#555" }}>analyzing…</span>}
        </div>
      )}

      {phase === "ai_speaking" && (
        <div style={{ flexShrink: 0, padding: "16px 20px", background: "#0d0d0d", borderTop: "1px solid #1a1a1a", display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "#555", fontFamily: "'DM Mono',monospace" }}>
          <span style={{ width: 8, height: 8, background: "#ffc83c", borderRadius: "50%", display: "inline-block", animation: "pulse 1s ease-in-out infinite" }} />
          {meta.title} is speaking…
        </div>
      )}
    </div>
  );
}

// ── CLIP CARD ─────────────────────────────────────────────────────────
function ClipCard({
  clip,
  attempt,
  phase,
  isActive,
  liveTranscript,
  micLevel,
  onAttempt,
  onDone,
  onSkip,
}: {
  clip: ClipChallenge;
  attempt?: Message["clipAttempt"];
  phase: Phase;
  isActive: boolean;
  liveTranscript: string;
  micLevel: number;
  onAttempt: () => void;
  onDone: () => void;
  onSkip: () => void;
}) {
  const embedUrl = `https://www.youtube.com/embed/${clip.youtubeId}?start=${clip.startTime}&end=${clip.endTime}&autoplay=0&rel=0&modestbranding=1`;

  return (
    <div className="clip-card" style={{ background: "#0f0f0f", border: "1px solid #2a2200", borderRadius: 16, overflow: "hidden", maxWidth: 420 }}>
      {/* Yellow accent bar */}
      <div style={{ height: 3, background: "linear-gradient(90deg, #ffc83c, #ff9a00)" }} />

      {/* Header */}
      <div style={{ padding: "12px 16px 8px", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11, fontFamily: "'DM Mono',monospace", color: "#ffc83c", textTransform: "uppercase", letterSpacing: "0.1em" }}>🎬 clip challenge</span>
        <span style={{ fontSize: 11, color: "#444", marginLeft: "auto" }}>{clip.show}</span>
      </div>

      {/* YouTube embed */}
      <div style={{ position: "relative", paddingBottom: "52%", background: "#000" }}>
        <iframe
          src={embedUrl}
          style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: "none" }}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>

      {/* Line to practice */}
      <div style={{ padding: "14px 16px 10px" }}>
        <div style={{ fontSize: 11, color: "#555", fontFamily: "'DM Mono',monospace", marginBottom: 6 }}>{clip.character} says:</div>
        <div style={{ fontSize: 18, fontFamily: "'Syne',sans-serif", fontWeight: 700, color: "#f0f0f0", lineHeight: 1.3, marginBottom: 8 }}>
          "{clip.line}"
        </div>
        <div style={{ fontSize: 12, color: "#888", fontStyle: "italic", lineHeight: 1.4 }}>
          💡 {clip.hint}
        </div>
      </div>

      {/* Attempt result */}
      {attempt && (
        <div style={{ margin: "0 16px 12px", padding: "10px 12px", background: attempt.passed ? "#0a1f0a" : "#1a0f00", border: `1px solid ${attempt.passed ? "#4ade8044" : "#ffc83c44"}`, borderRadius: 10 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontFamily: "'DM Mono',monospace", color: attempt.passed ? "#4ade80" : "#ffc83c" }}>
              {attempt.passed ? "✓ nice!" : "keep at it"} — {attempt.accuracy}%
            </span>
          </div>
          <ScoredText text={attempt.spoken} scores={attempt.scores} />
        </div>
      )}

      {/* Live transcript during clip listening */}
      {isActive && phase === "clip_listening" && liveTranscript && (
        <div style={{ margin: "0 16px 10px", padding: "8px 12px", background: "#111", border: "1px dashed #333", borderRadius: 8, fontSize: 14, color: "#888", fontStyle: "italic" }}>
          {liveTranscript}…
        </div>
      )}

      {/* Controls */}
      {isActive && !attempt && (
        <div style={{ padding: "8px 16px 16px", display: "flex", gap: 8 }}>
          {phase === "clip_challenge" && (
            <>
              <button onClick={onAttempt} style={{ flex: 1, background: "#ffc83c", color: "#0a0a0a", border: "none", borderRadius: 8, padding: "10px 0", fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                🎙 Say it
              </button>
              <button onClick={onSkip} style={{ background: "none", border: "1px solid #2a2a2a", borderRadius: 8, padding: "10px 14px", color: "#555", fontSize: 12, fontFamily: "'DM Mono',monospace", cursor: "pointer" }}>
                skip
              </button>
            </>
          )}
          {phase === "clip_listening" && (
            <button onClick={onDone} style={{ flex: 1, background: "#ffc83c", color: "#0a0a0a", border: "none", borderRadius: 8, padding: "10px 0", fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
              <MicVisualizer level={micLevel} active size="small" /> Done
            </button>
          )}
          {phase === "clip_processing" && (
            <div style={{ flex: 1, textAlign: "center", padding: "10px 0", fontFamily: "'DM Mono',monospace", fontSize: 12, color: "#555" }}>scoring…</div>
          )}
          {phase === "clip_result" && (
            <div style={{ flex: 1, textAlign: "center", padding: "10px 0", fontFamily: "'DM Mono',monospace", fontSize: 12, color: "#555" }}>continuing…</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── SCORED TEXT ───────────────────────────────────────────────────────
function ScoredText({ text, scores }: { text: string; scores: WordScore[] }) {
  return (
    <span style={{ fontSize: 15, lineHeight: 1.55 }}>
      {text.split(" ").map((word, i, arr) => {
        const clean = word.toLowerCase().replace(/[^a-z]/g, "");
        const score = scores.find((s) => s.word.toLowerCase().replace(/[^a-z]/g, "") === clean);
        const color = !score ? "inherit" : score.accuracyScore >= 80 ? "#4ade80" : score.accuracyScore >= THRESHOLD ? "#fbbf24" : "#f87171";
        return <span key={i} style={{ color }} title={score ? `${score.accuracyScore}%` : ""}>{word}{i < arr.length - 1 ? " " : ""}</span>;
      })}
    </span>
  );
}

// ── MIC VISUALIZER ────────────────────────────────────────────────────
function MicVisualizer({ level, active, size = "normal" }: { level: number; active: boolean; size?: "normal" | "small" }) {
  if (size === "small") {
    return <span style={{ display: "inline-block", width: 8, height: 8, background: active ? "#ffc83c" : "#444", borderRadius: "50%", marginRight: 6, verticalAlign: "middle" }} />;
  }
  return (
    <div style={{ position: "relative", width: 80, height: 80, display: "flex", alignItems: "center", justifyContent: "center" }}>
      {Array.from({ length: 12 }).map((_, i) => {
        const angle = (i / 12) * 360;
        const h = active ? 4 + level * 28 * Math.abs(Math.sin(i * 0.8)) : 4;
        return <div key={i} style={{ position: "absolute", width: 3, height: h, background: "#ffc83c", borderRadius: 2, transform: `rotate(${angle}deg) translateY(-20px)`, opacity: active ? 0.7 + level * 0.3 : 0.3, transition: "height 0.08s ease", transformOrigin: "bottom center" }} />;
      })}
      <span style={{ fontSize: 22, zIndex: 1 }}>{active ? "🎙" : "⏸"}</span>
    </div>
  );
}

// ── SESSION END ───────────────────────────────────────────────────────
function SessionEnd({ stats, accuracy, onRestart }: { stats: SessionStats; accuracy: number; onRestart: () => void }) {
  const grade = accuracy >= 85 ? "Excellent" : accuracy >= 70 ? "Good" : "Keep Practicing";
  const gradeColor = accuracy >= 85 ? "#4ade80" : accuracy >= 70 ? "#ffc83c" : "#f87171";
  return (
    <div style={{ minHeight: "100dvh", background: "#0a0a0a", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 20px", fontFamily: "'DM Sans',sans-serif", color: "#f0f0f0" }}>
      <div style={{ textAlign: "center", maxWidth: 380, width: "100%" }}>
        <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 14, textTransform: "uppercase", letterSpacing: "0.2em", color: gradeColor, marginBottom: 8 }}>{grade}</div>
        <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 80, color: "#ffc83c", lineHeight: 1, marginBottom: 4 }}>{accuracy}%</div>
        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: "#444", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 40 }}>overall accuracy</div>
        <div style={{ display: "flex", justifyContent: "center", gap: 32, marginBottom: 40 }}>
          {([["totalWords", "words spoken"], ["corrections", "corrections"], ["avgScore", "avg score"]] as const).map(([key, label]) => (
            <div key={key} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 28 }}>{stats[key]}</span>
              <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#444", textTransform: "uppercase", letterSpacing: "0.1em" }}>{label}</span>
            </div>
          ))}
        </div>
        <button onClick={onRestart} style={{ background: "#ffc83c", color: "#0a0a0a", border: "none", borderRadius: 12, padding: "16px 40px", fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 16, cursor: "pointer" }}>
          Practice Again
        </button>
      </div>
    </div>
  );
}

export default function ConversationPageWrapper() {
  return (
    <Suspense fallback={<div style={{ background: "#0a0a0a", minHeight: "100dvh" }} />}>
      <ConversationPage />
    </Suspense>
  );
}