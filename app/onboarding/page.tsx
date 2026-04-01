"use client";
import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";

const SAMPLE_TEXT = `The weather was very pleasant this Thursday. I decided to visit the market downtown and buy some butter, water, and vegetables. My neighbor told me that the store usually closes at three, but they sometimes keep it open later. I thought about taking a different route, but the traffic near the bridge was terrible.`;

type RecordingState = "idle" | "recording" | "done" | "analyzing";

export default function Onboarding() {
  const router = useRouter();
  const [state, setState] = useState<RecordingState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [mounted, setMounted] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => { setMounted(true); }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        setAudioBlob(blob);
        stream.getTracks().forEach((t) => t.stop());
      };

      mediaRecorder.start();
      setState("recording");
      setSeconds(0);

      timerRef.current = setInterval(() => {
        setSeconds((s) => {
          if (s >= 45) { stopRecording(); return s; }
          return s + 1;
        });
      }, 1000);
    } catch (err) {
      alert("Microphone access needed. Please allow mic access and try again.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (timerRef.current) clearInterval(timerRef.current);
    setState("done");
  };

  const analyze = async () => {
    if (!audioBlob) return;
    setState("analyzing");

    const reader = new FileReader();
    reader.readAsDataURL(audioBlob);
    reader.onloadend = async () => {
      const base64 = (reader.result as string).split(",")[1];
      try {
        const res = await fetch("/api/assess", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audio: base64, referenceText: SAMPLE_TEXT }),
        });
        const data = await res.json();
        sessionStorage.setItem("assessment", JSON.stringify(data));
        router.push("/conversation");
      } catch (err) {
        router.push("/conversation");
      }
    };
  };

  return (
    <main className="root">
      <div className={`container ${mounted ? "visible" : ""}`}>
        <button className="back" onClick={() => router.push("/")}>← back</button>

        <div className="step-label">STEP 1 OF 2 · VOICE SAMPLE</div>
        <h2 className="title">Read this paragraph aloud</h2>
        <p className="subtitle">
          We'll identify your top pronunciation patterns. Speak naturally — don't try to correct yourself yet.
        </p>

        <div className="text-card">
          <p className="sample-text">{SAMPLE_TEXT}</p>
          {state === "recording" && (
            <div className="recording-indicator">
              <span className="rec-dot" />
              <span className="rec-time">{seconds}s</span>
            </div>
          )}
        </div>

        <div className="actions">
          {state === "idle" && (
            <button className="btn-primary" onClick={startRecording}>🎙 Start Recording</button>
          )}
          {state === "recording" && (
            <button className="btn-stop" onClick={stopRecording}>⏹ Stop Recording</button>
          )}
          {state === "done" && (
            <div className="done-actions">
              <p className="done-label">✓ {seconds}s recorded</p>
              <button className="btn-primary" onClick={analyze}>Analyze My Pronunciation</button>
              <button className="btn-ghost" onClick={startRecording}>Record Again</button>
            </div>
          )}
          {state === "analyzing" && (
            <div className="analyzing">
              <div className="spinner" />
              <p>Analyzing your pronunciation patterns…</p>
            </div>
          )}
        </div>

        <button className="skip" onClick={() => router.push("/conversation")}>
          Skip → go straight to conversation
        </button>
      </div>

      <div className="orb" />
      <div className="grain" />

      <style jsx>{`
        .root {
          min-height: 100vh;
          background: #0a0a0a;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 2rem;
          font-family: "DM Sans", sans-serif;
          position: relative;
          overflow: hidden;
        }
        .container {
          position: relative;
          z-index: 2;
          max-width: 600px;
          width: 100%;
          opacity: 0;
          transform: translateY(20px);
          transition: opacity 0.6s ease, transform 0.6s ease;
        }
        .container.visible { opacity: 1; transform: translateY(0); }
        .back {
          background: none;
          border: none;
          color: rgba(255,255,255,0.3);
          font-family: "DM Sans", sans-serif;
          font-size: 0.85rem;
          cursor: pointer;
          padding: 0;
          margin-bottom: 2rem;
          transition: color 0.2s;
        }
        .back:hover { color: rgba(255,255,255,0.7); }
        .step-label {
          font-size: 0.7rem;
          letter-spacing: 0.15em;
          color: #ffc83c;
          margin-bottom: 1rem;
          font-weight: 600;
        }
        .title {
          font-family: "Syne", sans-serif;
          font-size: clamp(1.8rem, 4vw, 2.5rem);
          font-weight: 800;
          color: #fff;
          margin: 0 0 0.75rem;
          letter-spacing: -0.02em;
        }
        .subtitle {
          color: rgba(255,255,255,0.45);
          font-size: 0.95rem;
          line-height: 1.6;
          margin: 0 0 2rem;
        }
        .text-card {
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 16px;
          padding: 1.75rem;
          margin-bottom: 2rem;
          position: relative;
        }
        .sample-text {
          color: rgba(255,255,255,0.8);
          font-size: 1.05rem;
          line-height: 1.8;
          margin: 0;
        }
        .recording-indicator {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-top: 1rem;
          padding-top: 1rem;
          border-top: 1px solid rgba(255,255,255,0.06);
        }
        .rec-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #ff4444;
          animation: pulse 1s infinite;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        .rec-time {
          font-family: "DM Mono", monospace;
          color: #ff4444;
          font-size: 0.85rem;
        }
        .actions {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.75rem;
          margin-bottom: 2rem;
        }
        .btn-primary {
          background: #ffc83c;
          color: #0a0a0a;
          border: none;
          padding: 0.9rem 2.5rem;
          font-family: "Syne", sans-serif;
          font-weight: 700;
          font-size: 1rem;
          border-radius: 100px;
          cursor: pointer;
          transition: transform 0.15s ease, box-shadow 0.15s ease;
          width: 100%;
          max-width: 320px;
        }
        .btn-primary:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 24px rgba(255,200,60,0.25);
        }
        .btn-stop {
          background: rgba(255,68,68,0.15);
          border: 1px solid rgba(255,68,68,0.3);
          color: #ff6b6b;
          padding: 0.9rem 2.5rem;
          font-family: "Syne", sans-serif;
          font-weight: 700;
          font-size: 1rem;
          border-radius: 100px;
          cursor: pointer;
          width: 100%;
          max-width: 320px;
        }
        .btn-ghost {
          background: none;
          border: 1px solid rgba(255,255,255,0.12);
          color: rgba(255,255,255,0.5);
          padding: 0.75rem 2rem;
          font-family: "DM Sans", sans-serif;
          font-size: 0.9rem;
          border-radius: 100px;
          cursor: pointer;
          width: 100%;
          max-width: 320px;
        }
        .done-actions {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.75rem;
          width: 100%;
        }
        .done-label { color: #3ddc84; font-size: 0.85rem; margin: 0; }
        .analyzing {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1rem;
          color: rgba(255,255,255,0.5);
          font-size: 0.9rem;
        }
        .spinner {
          width: 32px;
          height: 32px;
          border: 2px solid rgba(255,200,60,0.2);
          border-top-color: #ffc83c;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .skip {
          background: none;
          border: none;
          color: rgba(255,255,255,0.2);
          font-size: 0.8rem;
          cursor: pointer;
          font-family: "DM Sans", sans-serif;
          text-align: center;
          display: block;
          margin: 0 auto;
          text-decoration: underline;
          text-underline-offset: 3px;
        }
        .skip:hover { color: rgba(255,255,255,0.5); }
        .orb {
          position: absolute;
          width: 600px;
          height: 600px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(255,200,60,0.06) 0%, transparent 70%);
          filter: blur(60px);
          top: -200px;
          left: 50%;
          transform: translateX(-50%);
          pointer-events: none;
        }
        .grain {
          position: fixed;
          inset: 0;
          opacity: 0.035;
          pointer-events: none;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
          background-size: 200px 200px;
          z-index: 1;
        }
      `}</style>
    </main>
  );
}