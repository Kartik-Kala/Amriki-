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

// Realistic mock for dev without keys
function mockAssessment(referenceText: string) {
  const words = referenceText.split(" ").map((word) => {
    const score = Math.floor(Math.random() * 40) + 60; // 60–100
    return {
      word,
      accuracyScore: score,
      errorType: score < 68 ? "Mispronunciation" : "None",
      phonemes: [],
    };
  });

  const avgScore =
    words.reduce((sum, w) => sum + w.accuracyScore, 0) / words.length;

  return {
    recognizedText: referenceText,
    accuracyScore: Math.round(avgScore),
    fluencyScore: Math.floor(Math.random() * 20) + 75,
    completenessScore: 95,
    pronunciationScore: Math.round(avgScore - 3),
    words,
  };
}