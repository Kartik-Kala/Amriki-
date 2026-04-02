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
  | "done";

interface WordScore {
  word: string;
  accuracyScore: number;
  errorType: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  wordScores?: WordScore[];
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

function browserSpeak(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !window.speechSynthesis) { resolve(); return; }
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = "en-US";
    utt.rate = 0.92;
    utt.pitch = 1;
    const voices = window.speechSynthesis.getVoices();
    const usVoice = voices.find((v) => v.lang === "en-US");
    if (usVoice) utt.voice = usVoice;
    utt.onend = () => resolve();
    utt.onerror = () => resolve();
    window.speechSynthesis.speak(utt);
  });
}

function ConversationPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const scenario = (searchParams.get("scenario") as Scenario) ?? "casual";

  const [phase, setPhase] = useState<Phase>("idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentAiText, setCurrentAiText] = useState("");
  const [correction, setCorrection] = useState<{ word: string; score: number; tip: string } | null>(null);
  const [retryWord, setRetryWord] = useState("");
  const [retryResult, setRetryResult] = useState<"pass" | "fail" | null>(null);
  const [stats, setStats] = useState<SessionStats>({ totalWords: 0, correctWords: 0, corrections: 0, avgScore: 0 });
  const [turnCount, setTurnCount] = useState(0);
  const [isSessionDone, setIsSessionDone] = useState(false);
  const [micLevel, setMicLevel] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const animFrameRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;
  const statsRef = useRef(stats);
  statsRef.current = stats;

  const meta = SCENARIO_LABELS[scenario];

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, currentAiText, correction]);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animFrameRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      window.speechSynthesis?.cancel();
    };
  }, []);

  useEffect(() => { startSession(); }, []); // eslint-disable-line

  async function startSession() {
    setPhase("ai_speaking");
    const opening = ({ casual: "Hey! How's your day going?", interview: "Hi, thanks for coming in. Could you walk me through your background?", customer_call: "Thank you for calling, this is Alex. How can I help you today?" })[scenario];
    setCurrentAiText(opening);
    await speakText(opening);
    setMessages([{ role: "assistant", content: opening }]);
    setCurrentAiText("");
    setPhase("listening");
    startRecording();
  }

  async function speakText(text: string, voiceIndex = 0) {
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

  function startMicVisualizer(stream: MediaStream) {
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
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      startMicVisualizer(stream);
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mediaRecorderRef.current = recorder;
      recorder.start(100);
    } catch (err) { console.error("Mic error:", err); }
  }

  function stopRecording(): Promise<Blob> {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === "inactive") return resolve(new Blob());
      recorder.onstop = () => resolve(new Blob(audioChunksRef.current, { type: "audio/webm" }));
      recorder.stop();
      cancelAnimationFrame(animFrameRef.current);
      setMicLevel(0);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    });
  }

  async function handleUserDone() {
    if (phase !== "listening" && phase !== "retry_listening") return;
    const isRetry = phase === "retry_listening";
    setPhase(isRetry ? "retry_processing" : "processing");

    const audioBlob = await stopRecording();
    const currentMessages = messagesRef.current;
    const lastAiMsg = [...currentMessages].reverse().find((m) => m.role === "assistant")?.content ?? "Hello how are you doing today";

    const formData = new FormData();
    formData.append("audio", audioBlob, "audio.webm");
    formData.append("text", lastAiMsg);

    let wordScores: WordScore[] = [];
    let recognizedText = "";

    try {
      const assessRes = await fetch("/api/assess", { method: "POST", body: formData });
      const assessData = await assessRes.json();
      wordScores = assessData.words ?? [];
      recognizedText = assessData.recognizedText ?? "";
      const s = statsRef.current;
      const newTotal = s.totalWords + wordScores.length;
      const newCorrect = s.correctWords + wordScores.filter((w) => w.accuracyScore >= 68).length;
      const allScores = wordScores.map((w) => w.accuracyScore);
      const newAvg = allScores.length ? Math.round((s.avgScore * s.totalWords + allScores.reduce((a, b) => a + b, 0)) / newTotal) : s.avgScore;
      setStats({ ...s, totalWords: newTotal, correctWords: newCorrect, avgScore: newAvg });
    } catch (err) { console.error("Assessment failed:", err); }

    const userText = recognizedText || "(couldn't detect speech)";
    const updatedMessages: Message[] = [...currentMessages, { role: "user", content: userText, wordScores }];
    setMessages(updatedMessages);

    try {
      const chatRes = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: updatedMessages.map((m) => ({ role: m.role, content: m.content })),
          scenario, wordScores, isRetry,
          retryWord: isRetry ? retryWord : undefined,
        }),
      });
      const chatData = await chatRes.json();

      if (chatData.type === "correction" && !isRetry) {
        setStats((s) => ({ ...s, corrections: s.corrections + 1 }));
        setCorrection({ word: chatData.word, score: chatData.score, tip: chatData.correction });
        setRetryWord(chatData.word);
        setPhase("correction");
      } else {
        if (isRetry) {
          const score = wordScores.find((w) => w.word.toLowerCase() === retryWord.toLowerCase())?.accuracyScore ?? 0;
          setRetryResult(score >= 68 ? "pass" : "fail");
          setTimeout(() => { setRetryResult(null); setCorrection(null); }, 2000);
        }
        const newTurn = turnCount + 1;
        setTurnCount(newTurn);
        if (newTurn >= MAX_TURNS) { setIsSessionDone(true); setPhase("done"); return; }

        setPhase("ai_speaking");
        setCurrentAiText(chatData.content);
        await speakText(chatData.content, updatedMessages.length % 3);
        setMessages((prev) => [...prev, { role: "assistant", content: chatData.content }]);
        setCurrentAiText("");
        setPhase("listening");
        startRecording();
      }
    } catch (err) {
      console.error("Chat failed:", err);
      setPhase("listening");
      startRecording();
    }
  }

  async function handleRetry() {
    setPhase("retry_listening");
    await startRecording();
  }

  const accuracy = stats.totalWords > 0 ? Math.round((stats.correctWords / stats.totalWords) * 100) : 0;

  if (isSessionDone) {
    return <SessionEnd stats={stats} accuracy={accuracy} onRestart={() => router.push("/onboarding")} />;
  }

  return (
    <div style={{ minHeight: "100dvh", background: "#0a0a0a", display: "flex", flexDirection: "column", fontFamily: "'DM Sans', sans-serif", color: "#f0f0f0", overflow: "hidden" }}>
      <style>{`@keyframes blink{0%,100%{opacity:1}50%{opacity:0}} @keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.5);opacity:.6}}`}</style>

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

      <div style={{ height: 2, background: "#1a1a1a", flexShrink: 0 }}>
        <div style={{ height: "100%", background: "#ffc83c", width: `${(turnCount / MAX_TURNS) * 100}%`, transition: "width 0.4s ease" }} />
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "24px 20px 12px", display: "flex", flexDirection: "column", gap: 12 }}>
        {messages.map((msg, i) => (
          <div key={i} style={{ maxWidth: "78%", padding: "12px 16px", borderRadius: 18, fontSize: 15, lineHeight: 1.55, alignSelf: msg.role === "user" ? "flex-end" : "flex-start", background: msg.role === "user" ? "#1a1a0f" : "#161616", border: msg.role === "user" ? "1px solid #2a2a10" : "1px solid #232323", borderBottomRightRadius: msg.role === "user" ? 4 : 18, borderBottomLeftRadius: msg.role === "assistant" ? 4 : 18 }}>
            {msg.role === "user" && msg.wordScores?.length
              ? <ScoredText text={msg.content} scores={msg.wordScores} />
              : <span>{msg.content}</span>}
          </div>
        ))}

        {currentAiText && (
          <div style={{ maxWidth: "78%", padding: "12px 16px", borderRadius: 18, fontSize: 15, lineHeight: 1.55, alignSelf: "flex-start", background: "#161616", border: "1px solid #232323", borderBottomLeftRadius: 4 }}>
            {currentAiText}<span style={{ color: "#ffc83c", animation: "blink 0.8s step-end infinite" }}>▋</span>
          </div>
        )}

        {correction && phase === "correction" && (
          <div style={{ background: "#0f0f00", border: "1px solid #ffc83c44", borderLeft: "3px solid #ffc83c", borderRadius: 12, padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 13, color: "#ffc83c", background: "#ffc83c15", padding: "3px 8px", borderRadius: 6 }}>"{correction.word}" — {correction.score}%</span>
              <span style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "'DM Mono',monospace" }}>Let's fix this</span>
            </div>
            <p style={{ fontSize: 14, color: "#ccc", lineHeight: 1.6, margin: "0 0 14px" }}>{correction.tip}</p>
            <button onClick={handleRetry} style={{ background: "#ffc83c", color: "#0a0a0a", border: "none", borderRadius: 8, padding: "10px 18px", fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
              Say "{correction.word}" now →
            </button>
          </div>
        )}

        {(phase === "retry_listening" || phase === "retry_processing") && (
          <div style={{ background: "#0a0a0a", border: "1px dashed #ffc83c55", borderRadius: 12, padding: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 15, color: "#ffc83c" }}>Say: "{retryWord}"</span>
            {phase === "retry_listening" && <button onClick={handleUserDone} style={{ background: "#ffc83c", color: "#0a0a0a", border: "none", borderRadius: 10, padding: "10px 20px", fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>Done</button>}
            {phase === "retry_processing" && <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 13, color: "#555" }}>scoring…</span>}
          </div>
        )}

        {retryResult && (
          <div style={{ alignSelf: "center", fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 15, padding: "10px 20px", borderRadius: 999, background: retryResult === "pass" ? "#052010" : "#150505", color: retryResult === "pass" ? "#4ade80" : "#f87171", border: `1px solid ${retryResult === "pass" ? "#4ade8044" : "#f8717144"}` }}>
            {retryResult === "pass" ? "✓ Nice improvement!" : "Keep practicing!"}
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {(phase === "listening" || phase === "processing") && (
        <div style={{ flexShrink: 0, padding: 20, display: "flex", flexDirection: "column", alignItems: "center", gap: 16, background: "#0d0d0d", borderTop: "1px solid #1a1a1a" }}>
          <MicVisualizer level={micLevel} active={phase === "listening"} />
          {phase === "listening" && <button onClick={handleUserDone} style={{ background: "#ffc83c", color: "#0a0a0a", border: "none", borderRadius: 10, padding: "12px 32px", fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>Done speaking</button>}
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

function ScoredText({ text, scores }: { text: string; scores: WordScore[] }) {
  return (
    <span>
      {text.split(" ").map((word, i, arr) => {
        const clean = word.toLowerCase().replace(/[^a-z]/g, "");
        const score = scores.find((s) => s.word.toLowerCase().replace(/[^a-z]/g, "") === clean);
        const color = !score ? "inherit" : score.accuracyScore >= 80 ? "#4ade80" : score.accuracyScore >= 68 ? "#fbbf24" : "#f87171";
        return <span key={i} style={{ color }} title={score ? `${score.accuracyScore}%` : ""}>{word}{i < arr.length - 1 ? " " : ""}</span>;
      })}
    </span>
  );
}

function MicVisualizer({ level, active }: { level: number; active: boolean }) {
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
        <button onClick={onRestart} style={{ background: "#ffc83c", color: "#0a0a0a", border: "none", borderRadius: 12, padding: "16px 40px", fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 16, cursor: "pointer" }}>Practice Again</button>
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