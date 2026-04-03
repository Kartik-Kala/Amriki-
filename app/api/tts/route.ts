import { NextRequest, NextResponse } from "next/server";

const VOICES = [
  "EXAVITQu4vr4xnSDxMaL", // Bella — warm female
  "pNInz6obpgDQGcFmaJgB", // Adam — clear male
  "21m00Tcm4TlvDq8ikWAM", // Rachel — professional female
];

export async function POST(req: NextRequest) {
  let text = "";
  try {
    const body = await req.json();
    text = body.text ?? "";
    const voiceIndex: number = body.voiceIndex ?? 0;

    if (!text) return NextResponse.json({ error: "Missing text" }, { status: 400 });

    const key = process.env.ELEVENLABS_API_KEY;
    if (!key) return NextResponse.json({ mock: true, text });

    const voiceId = VOICES[voiceIndex % VOICES.length];

    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
      {
        method: "POST",
        headers: {
          "xi-api-key": key,
          "Content-Type": "application/json",
          "Accept": "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_turbo_v2",
          voice_settings: {
            stability: 0.4,
            similarity_boost: 0.8,
            style: 0.2,
            use_speaker_boost: true,
          },
        }),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      console.error("ElevenLabs error:", err);
      return NextResponse.json({ mock: true, text });
    }

    const audioBuffer = await res.arrayBuffer();
    return new NextResponse(audioBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": audioBuffer.byteLength.toString(),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("TTS error:", err);
    return NextResponse.json({ mock: true, text });
  }
}