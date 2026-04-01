"use client";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";

export default function Home() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <main className="root">
      <div className={`hero ${mounted ? "visible" : ""}`}>
        <div className="badge">BETA · FREE TO TRY</div>

        <h1 className="headline">
          <span className="line1">Speak American.</span>
          <span className="line2">Sound Natural.</span>
        </h1>

        <p className="subtext">
          AI conversation coach built for Indian English speakers.
          <br />
          Talk. Get corrected. Repeat. No drills, no boring exercises.
        </p>

        <div className="cta-group">
          <button className="cta-primary" onClick={() => router.push("/onboarding")}>
            Start Speaking Free
          </button>
          <p className="no-signup">No signup needed to try</p>
        </div>

        <div className="sounds-like">
          <p className="sounds-label">Common errors we fix</p>
          <div className="pills">
            <span className="pill wrong">wery</span>
            <span className="arrow">→</span>
            <span className="pill right">very</span>
            <span className="pill wrong">dis</span>
            <span className="arrow">→</span>
            <span className="pill right">this</span>
            <span className="pill wrong">batter</span>
            <span className="arrow">→</span>
            <span className="pill right">butter</span>
            <span className="pill wrong">DEcide</span>
            <span className="arrow">→</span>
            <span className="pill right">deCIDE</span>
          </div>
        </div>
      </div>

      <div className="orb orb1" />
      <div className="orb orb2" />
      <div className="grain" />

      <style jsx>{`
        .root {
          min-height: 100vh;
          background: #0a0a0a;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 2rem;
          position: relative;
          overflow: hidden;
          font-family: "DM Sans", sans-serif;
        }
        .hero {
          position: relative;
          z-index: 2;
          max-width: 640px;
          text-align: center;
          opacity: 0;
          transform: translateY(24px);
          transition: opacity 0.8s ease, transform 0.8s ease;
        }
        .hero.visible {
          opacity: 1;
          transform: translateY(0);
        }
        .badge {
          display: inline-block;
          background: rgba(255, 200, 60, 0.12);
          border: 1px solid rgba(255, 200, 60, 0.3);
          color: #ffc83c;
          font-size: 0.7rem;
          letter-spacing: 0.15em;
          font-weight: 600;
          padding: 0.35rem 0.9rem;
          border-radius: 100px;
          margin-bottom: 2.5rem;
        }
        .headline {
          font-family: "Syne", sans-serif;
          font-weight: 800;
          font-size: clamp(3rem, 8vw, 5.5rem);
          line-height: 1.0;
          color: #fff;
          margin: 0 0 1.5rem;
          letter-spacing: -0.03em;
        }
        .line1 { display: block; color: #ffffff; }
        .line2 { display: block; color: #ffc83c; }
        .subtext {
          color: rgba(255, 255, 255, 0.5);
          font-size: 1.05rem;
          line-height: 1.7;
          margin: 0 0 2.5rem;
        }
        .cta-group { margin-bottom: 3rem; }
        .cta-primary {
          background: #ffc83c;
          color: #0a0a0a;
          border: none;
          padding: 1rem 2.5rem;
          font-family: "Syne", sans-serif;
          font-weight: 700;
          font-size: 1rem;
          border-radius: 100px;
          cursor: pointer;
          transition: transform 0.15s ease, box-shadow 0.15s ease;
        }
        .cta-primary:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 32px rgba(255, 200, 60, 0.3);
        }
        .no-signup {
          margin-top: 0.75rem;
          font-size: 0.8rem;
          color: rgba(255, 255, 255, 0.3);
        }
        .sounds-like {
          border-top: 1px solid rgba(255, 255, 255, 0.08);
          padding-top: 2rem;
        }
        .sounds-label {
          font-size: 0.75rem;
          color: rgba(255, 255, 255, 0.3);
          letter-spacing: 0.1em;
          text-transform: uppercase;
          margin: 0 0 1rem;
        }
        .pills {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
          justify-content: center;
          align-items: center;
        }
        .pill {
          padding: 0.35rem 0.9rem;
          border-radius: 100px;
          font-size: 0.9rem;
          font-weight: 600;
          font-family: "DM Mono", monospace;
        }
        .pill.wrong {
          background: rgba(255, 80, 80, 0.12);
          border: 1px solid rgba(255, 80, 80, 0.25);
          color: #ff6b6b;
          text-decoration: line-through;
          text-decoration-color: rgba(255, 80, 80, 0.5);
        }
        .pill.right {
          background: rgba(60, 220, 130, 0.12);
          border: 1px solid rgba(60, 220, 130, 0.25);
          color: #3ddc84;
        }
        .arrow { color: rgba(255, 255, 255, 0.2); font-size: 0.8rem; }
        .orb {
          position: absolute;
          border-radius: 50%;
          filter: blur(80px);
          pointer-events: none;
        }
        .orb1 {
          width: 500px;
          height: 500px;
          background: radial-gradient(circle, rgba(255, 200, 60, 0.08) 0%, transparent 70%);
          top: -100px;
          right: -100px;
        }
        .orb2 {
          width: 400px;
          height: 400px;
          background: radial-gradient(circle, rgba(100, 100, 255, 0.06) 0%, transparent 70%);
          bottom: -100px;
          left: -100px;
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