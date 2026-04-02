import { NextRequest, NextResponse } from "next/server";
import * as sdk from "microsoft-cognitiveservices-speech-sdk";

// American English voices — varied so conversation feels natural
const VOICES = [
  "en-US-AndrewMultilingualNeural", // warm male
  "en-US-AvaMultilingualNeural",    // clear female
  "en-US-BrianMultilingualNeural",  // natural male
];

export async function POST(req: NextRequest) {
  try {
    const { text, voiceIndex = 0, rate = 0, pitch = 0 } = await req.json();

    if (!text) {
      return NextResponse.json({ error: "Missing text" }, { status: 400 });
    }

    const key = process.env.AZURE_SPEECH_KEY;
    const region = process.env.AZURE_SPEECH_REGION;

    // Mock mode — return silence placeholder
    if (!key || !region) {
      return NextResponse.json({
        mock: true,
        text,
        message: "TTS mock mode — add AZURE_SPEECH_KEY to hear audio",
      });
    }

    const voice = VOICES[voiceIndex % VOICES.length];
    const speechConfig = sdk.SpeechConfig.fromSubscription(key, region);
    speechConfig.speechSynthesisVoiceName = voice;
    speechConfig.speechSynthesisOutputFormat =
      sdk.SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3;

    // Build SSML for rate/pitch control
    const ssml = `
      <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">
        <voice name="${voice}">
          <prosody rate="${rate > 0 ? "+" : ""}${rate}%" pitch="${pitch > 0 ? "+" : ""}${pitch}Hz">
            ${escapeXml(text)}
          </prosody>
        </voice>
      </speak>
    `.trim();

    const synthesizer = new sdk.SpeechSynthesizer(speechConfig, undefined);

    const result = await new Promise<sdk.SpeechSynthesisResult>(
      (resolve, reject) => {
        synthesizer.speakSsmlAsync(ssml, resolve, reject);
      }
    );

    synthesizer.close();

    if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
      const audioData = Buffer.from(result.audioData);
      return new NextResponse(audioData, {
        headers: {
          "Content-Type": "audio/mpeg",
          "Content-Length": audioData.length.toString(),
          "Cache-Control": "no-store",
        },
      });
    } else {
      // CancellationDetails works for both recognizer and synthesizer results
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const errDetail = (result as any).errorDetails ?? "Unknown TTS error";
      console.error("TTS failed:", errDetail);
      return NextResponse.json({ error: "TTS synthesis failed" }, { status: 500 });
    }
  } catch (err) {
    console.error("TTS error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}