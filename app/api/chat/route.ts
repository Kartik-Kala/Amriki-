import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export type Scenario = "casual" | "interview" | "customer_call";

export interface Message {
  role: "user" | "assistant";
  content: string;
}

export interface WordScore {
  word: string;
  accuracyScore: number;
  errorType: string;
}

const SCENARIO_PROMPTS: Record<Scenario, string> = {
  casual: `You are Maya, a friendly American coworker having a casual conversation. 
Keep responses to 1-2 sentences, natural and warm. Topics: weekend plans, hobbies, 
food, pop culture, weather. Never break character. Never mention accent coaching.`,

  interview: `You are a hiring manager at a US tech company conducting a job interview.
Ask standard behavioral and technical questions. Keep responses professional and concise.
One question per turn. Never break character. Never mention accent coaching.`,

  customer_call: `You are a US customer service representative helping a customer. 
Present realistic customer service scenarios (billing issue, product return, tech support).
Keep responses professional but friendly, 1-2 sentences. Never break character. 
Never mention accent coaching.`,
};

const THRESHOLD = 68;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      messages,
      scenario,
      wordScores,
      isRetry,
      retryWord,
    }: {
      messages: Message[];
      scenario: Scenario;
      wordScores?: WordScore[];
      isRetry?: boolean;
      retryWord?: string;
    } = body;

    // Find words below threshold
    const problemWords =
      wordScores?.filter(
        (w) => w.accuracyScore < THRESHOLD && w.errorType !== "None"
      ) ?? [];

    // If there are problem words and it's not already a retry, return correction
    if (problemWords.length > 0 && !isRetry) {
      const worstWord = problemWords.sort(
        (a, b) => a.accuracyScore - b.accuracyScore
      )[0];
      const correction = await generateCorrection(worstWord.word, scenario);
      return NextResponse.json({
        type: "correction",
        word: worstWord.word,
        score: worstWord.accuracyScore,
        correction,
        continueAfterRetry: true,
      });
    }

    // Normal conversation continuation
    const systemPrompt = SCENARIO_PROMPTS[scenario];

    // Mock mode
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({
        type: "continue",
        content: getMockResponse(scenario, messages.length),
        problemWords: [],
      });
    }

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 150,
      system: systemPrompt,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });

    const content =
      response.content[0].type === "text" ? response.content[0].text : "";

    return NextResponse.json({
      type: "continue",
      content,
      problemWords,
      retryWordResult: isRetry
        ? {
            word: retryWord,
            passed: problemWords.length === 0,
          }
        : undefined,
    });
  } catch (err) {
    console.error("Chat error:", err);
    return NextResponse.json({ error: "Chat failed" }, { status: 500 });
  }
}

async function generateCorrection(
  word: string,
  scenario: Scenario
): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return mockCorrection(word);
  }

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 120,
    system: `You are an American accent coach. Give a single, friendly correction tip 
for the word provided. Include: how to position the mouth/tongue, a memory trick or 
rhyme, and an example sentence. Keep it under 3 sentences. Be encouraging. 
Respond in plain text only, no formatting.`,
    messages: [
      {
        role: "user",
        content: `The learner mispronounced the word: "${word}". Give them a correction tip.`,
      },
    ],
  });

  return response.content[0].type === "text"
    ? response.content[0].text
    : mockCorrection(word);
}

function mockCorrection(word: string): string {
  const tips: Record<string, string> = {
    water:
      'Say "WAH-der" — the T becomes a D sound in American English. Think of it like "wah" + "der". Try: "Can I get some water?"',
    butter:
      'It\'s "BUH-der" not "but-ter" — that middle T flaps to a D. Rhymes with "udder". Try: "Pass the butter please."',
    schedule:
      'Americans say "SKED-jool" not "SHED-jool". The SC makes a SK sound. Try: "What\'s your schedule today?"',
  };
  return (
    tips[word.toLowerCase()] ??
    `Focus on the "${word}" sound — relax your jaw and let the vowel flow naturally. Try saying it slowly, then speed up. Practice: "${word}, ${word}, ${word}".`
  );
}

function getMockResponse(scenario: Scenario, turn: number): string {
  const responses: Record<Scenario, string[]> = {
    casual: [
      "Hey! How's your week going so far?",
      "Oh nice! Did you do anything fun over the weekend?",
      "That sounds awesome! I've been meaning to try that too.",
      "Ha, totally! So what are your plans for the holidays?",
    ],
    interview: [
      "Thanks for coming in today. Can you tell me a little about yourself?",
      "Interesting background. Can you describe a challenging project you worked on?",
      "Great. How do you handle tight deadlines and competing priorities?",
      "Good answer. Where do you see yourself in five years?",
    ],
    customer_call: [
      "Thank you for calling support, this is Alex. How can I help you today?",
      "I understand, I'm sorry to hear that. Can I get your account number?",
      "Got it, I can see your account here. Let me look into that for you.",
      "I've gone ahead and processed that. Is there anything else I can help you with?",
    ],
  };

  const list = responses[scenario];
  return list[turn % list.length];
}