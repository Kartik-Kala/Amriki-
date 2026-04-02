import { NextRequest, NextResponse } from "next/server";
import * as sdk from "microsoft-cognitiveservices-speech-sdk";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const audioBlob = formData.get("audio") as Blob;
    const referenceText = formData.get("text") as string;

    if (!audioBlob || !referenceText) {
      return NextResponse.json(
        { error: "Missing audio or reference text" },
        { status: 400 }
      );
    }

    const key = process.env.AZURE_SPEECH_KEY;
    const region = process.env.AZURE_SPEECH_REGION;

    // Mock mode — no keys
    if (!key || !region) {
      return NextResponse.json(mockAssessment(referenceText));
    }

    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioBuffer = new Uint8Array(arrayBuffer);

    const speechConfig = sdk.SpeechConfig.fromSubscription(key, region);
    speechConfig.speechRecognitionLanguage = "en-US";

    const pronunciationConfig = new sdk.PronunciationAssessmentConfig(
      referenceText,
      sdk.PronunciationAssessmentGradingSystem.HundredMark,
      sdk.PronunciationAssessmentGranularity.Phoneme,
      true
    );
    pronunciationConfig.enableProsodyAssessment = true;

    const pushStream = sdk.AudioInputStream.createPushStream();
    // SDK type definition is wrong — write() accepts ArrayBufferView at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pushStream.write(audioBuffer as any);
    pushStream.close();

    const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);
    const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
    pronunciationConfig.applyTo(recognizer);

    const result = await new Promise<sdk.SpeechRecognitionResult>(
      (resolve, reject) => {
        recognizer.recognizeOnceAsync(resolve, reject);
      }
    );

    recognizer.close();

    if (
      result.reason === sdk.ResultReason.RecognizedSpeech ||
      result.reason === sdk.ResultReason.NoMatch
    ) {
      const assessmentResult =
        sdk.PronunciationAssessmentResult.fromResult(result);

      const words =
        assessmentResult.detailResult?.Words?.map((w) => ({
          word: w.Word,
          accuracyScore: w.PronunciationAssessment?.AccuracyScore ?? 0,
          errorType: w.PronunciationAssessment?.ErrorType ?? "None",
          phonemes: w.Phonemes?.map((p) => ({
            phoneme: p.Phoneme,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            accuracyScore: (p as any).PronunciationAssessment?.AccuracyScore ?? 0,
          })) ?? [],
        })) ?? [];

      return NextResponse.json({
        recognizedText: result.text,
        accuracyScore: assessmentResult.accuracyScore,
        fluencyScore: assessmentResult.fluencyScore,
        completenessScore: assessmentResult.completenessScore,
        pronunciationScore: assessmentResult.pronunciationScore,
        words,
      });
    } else {
      return NextResponse.json(
        { error: "Speech recognition failed", reason: result.reason },
        { status: 500 }
      );
    }
  } catch (err) {
    console.error("Assessment error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// Realistic mock for dev without Azure keys
// Simulates what a user might actually say back, with pronunciation scores
const MOCK_USER_REPLIES = [
  "It's going pretty good, thanks for asking",
  "I'm doing well, just been really busy lately",
  "Not bad, I had a very long day at work",
  "Pretty good! I went to the market this morning",
  "I'm doing great, the weather was nice today",
  "Good good, I was thinking about taking a walk",
  "It's been okay, I had some trouble sleeping though",
  "Really good actually, I finished a big project",
];

function mockAssessment(_referenceText: string) {
  // Pick a random plausible user reply
  const userReply = MOCK_USER_REPLIES[Math.floor(Math.random() * MOCK_USER_REPLIES.length)];
  
  const words = userReply.split(" ").map((word) => {
    // Bias scores — most words fine, occasional mispronunciation
    const roll = Math.random();
    const score = roll < 0.15
      ? Math.floor(Math.random() * 30) + 40  // bad: 40–70 (15% of words)
      : Math.floor(Math.random() * 20) + 78; // good: 78–98 (85% of words)
    return {
      word: word.replace(/[^a-zA-Z']/g, ""),
      accuracyScore: score,
      errorType: score < 68 ? "Mispronunciation" : "None",
      phonemes: [],
    };
  }).filter(w => w.word.length > 0);

  const avgScore =
    words.reduce((sum, w) => sum + w.accuracyScore, 0) / words.length;

  return {
    recognizedText: userReply,
    accuracyScore: Math.round(avgScore),
    fluencyScore: Math.floor(Math.random() * 15) + 78,
    completenessScore: 95,
    pronunciationScore: Math.round(avgScore - 3),
    words,
  };
}