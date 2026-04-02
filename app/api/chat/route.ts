import { NextRequest, NextResponse } from "next/server";
// Groq is used for conversation (free tier)
// Anthropic is used for correction tips if key is available
import Anthropic from "@anthropic-ai/sdk";

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

async function groqChat(messages: { role: string; content: string }[], system: string): Promise<string> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      max_tokens: 150,
      messages: [
        { role: "system", content: system },
        ...messages,
      ],
    }),
  });
  if (!res.ok) throw new Error(`Groq error: ${res.status}`);
  const data = await res.json();
  return data.choices[0].message.content as string;
}

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
  casual: `You are Maya, a friendly American accent coach running a casual conversation practice session with an Indian English speaker learning an American accent.
Your job is BOTH to have a real conversation AND actively coach their pronunciation.
After responding to what they said (1 sentence max), if they mispronounced something, call it out directly and naturally — like a friend helping them. 
Say things like "Oh and hey — you said 'vater', it's actually 'WAH-der', try saying it: water" or "Quick tip — 'the' starts with your tongue between your teeth, not D. Say: the, the, the."
If pronunciation was good, just continue the conversation naturally.
Keep total response under 3 sentences. Be warm and encouraging, not robotic.`,

  interview: `You are a US hiring manager AND accent coach running a mock interview with an Indian English speaker practicing American pronunciation.
Ask one interview question per turn. If they mispronounced a word, briefly correct it before asking your next question.
Example: "Good answer! One thing — you said 'important' with stress on IM, Americans say it as 'im-POR-tant'. Now: tell me about a challenge you overcame."
Keep it professional but supportive. Max 3 sentences total.`,

  customer_call: `You are a US customer service rep AND accent coach practicing with an Indian English speaker.
Play out a realistic customer service scenario. If they mispronounce a word, correct it naturally mid-conversation.
Example: "Got it! By the way — 'water' is WAH-der in American English, not VAH-ter. Let me pull up your account."
Keep responses to 2-3 sentences max.`,
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

    const worstWord = problemWords.length > 0 && !isRetry
      ? problemWords.sort((a, b) => a.accuracyScore - b.accuracyScore)[0]
      : null;

    const systemPrompt = SCENARIO_PROMPTS[scenario];

    // Mock mode — no Groq key
    if (!process.env.GROQ_API_KEY) {
      return NextResponse.json({
        type: "continue",
        content: getMockResponse(scenario, messages.length),
        problemWords,
        worstWord: worstWord ?? undefined,
      });
    }

    // Build messages — inject pronunciation note if there's a problem word
    const chatMessages = messages.map((m) => ({ role: m.role, content: m.content }));
    
    if (worstWord) {
      const errorInfo = INDIAN_EN_ERRORS[worstWord.word.toLowerCase()];
      const pronunciationNote = errorInfo
        ? `[COACH NOTE: The learner just mispronounced "${worstWord.word}". They likely said "${errorInfo.youSay}" instead of "${errorInfo.shouldSay}". ${errorInfo.tip}. Naturally weave a correction into your response — acknowledge what they said, correct the word, have them repeat it, then continue.]`
        : `[COACH NOTE: The learner mispronounced "${worstWord.word}" (score: ${worstWord.accuracyScore}%). Briefly correct it in your response — tell them what they said wrong and the right way to say it, then continue the conversation.]`;
      
      // Append note to last user message
      if (chatMessages.length > 0) {
        const last = chatMessages[chatMessages.length - 1];
        chatMessages[chatMessages.length - 1] = {
          ...last,
          content: last.content + " " + pronunciationNote,
        };
      }
    }

    const content = await groqChat(chatMessages, systemPrompt);

    return NextResponse.json({
      type: "continue",
      content,
      problemWords,
      worstWord: worstWord ?? undefined,
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

// Word-specific Indian English error patterns
const INDIAN_EN_ERRORS: Record<string, { youSay: string; shouldSay: string; tip: string }> = {
  // W/V confusion
  "water":   { youSay: "VAH-ter",    shouldSay: "WAH-der",   tip: "Round your lips into a W like you're about to whistle — don't touch your teeth. WAH-der, the T flaps to a soft D." },
  "we":      { youSay: "VEE",        shouldSay: "WEE",       tip: "W needs rounded lips, not teeth on lip. Pucker up like you're saying 'ooh' then slide to 'ee'. WEE." },
  "were":    { youSay: "VER",        shouldSay: "WUR",       tip: "Round lips for W, then the American R — tongue tip back, never touching. WUR-r-r." },
  "would":   { youSay: "VOOD",       shouldSay: "WUUD",      tip: "W not V — rounded lips. And the vowel is 'uh' not 'oo'. WUUD. Same as 'wood'." },
  "word":    { youSay: "VURD",       shouldSay: "WURD",      tip: "Round lips for W. The 'or' in American English is a strong R sound — WURD, rhymes with 'bird'." },
  "work":    { youSay: "VURK",       shouldSay: "WURK",      tip: "Round your lips for W, not teeth on lip. WURK — the vowel is like 'uh' with an R flavor." },
  "world":   { youSay: "VORLD",      shouldSay: "WURLD",     tip: "W with rounded lips, then that 'url' sound. WURLD — say 'girl' then swap the G for W." },
  "well":    { youSay: "VEL",        shouldSay: "WEL",       tip: "Lips rounded and pushed out for W. Don't let your top teeth touch your bottom lip. WEL." },
  "with":    { youSay: "VIT",        shouldSay: "WITH",      tip: "Two things: W not V (rounded lips), and end with TH — tongue between teeth. WITH." },
  // TH sounds
  "the":     { youSay: "DUH/DUH",    shouldSay: "THUH",      tip: "Stick your tongue tip just between your teeth and blow air. 'The' — that buzzing TH. Don't pull it back to make a D." },
  "this":    { youSay: "DIS",        shouldSay: "THIHS",     tip: "Tongue tip between teeth for TH. Feel the air flowing over your tongue. THIHS — not DIS." },
  "that":    { youSay: "DAT",        shouldSay: "THAT",      tip: "Tongue between teeth — TH. THAT. Your tongue tip literally peeks out between your teeth for a split second." },
  "they":    { youSay: "DAY",        shouldSay: "THAY",      tip: "Start with tongue between teeth — TH. Then 'ay'. THAY. The TH here is voiced (buzzing), like humming while doing the tongue thing." },
  "them":    { youSay: "DEM",        shouldSay: "THEM",      tip: "Tongue tip between teeth, blow air — TH. THEM not DEM. Practice: 'the them they' — all start with tongue out." },
  "their":   { youSay: "DAIR",       shouldSay: "THAIR",     tip: "Tongue between teeth for TH, then 'air'. THAIR. Same pronunciation as 'there' and 'they're'." },
  "there":   { youSay: "DAIR",       shouldSay: "THAIR",     tip: "TH — tongue peeks between teeth. THAIR. The R at the end is silent in most US speech. THEH-r softly." },
  "through": { youSay: "TROO",       shouldSay: "THROO",     tip: "TH then R — tongue out for TH, then curl back for R. THROO. It's not 'troo', the H matters." },
  "think":   { youSay: "TINK",       shouldSay: "THINK",     tip: "Tongue between teeth for TH — this one is unvoiced (no buzzing). THINK. Tongue out, air out, then pull back for INK." },
  "three":   { youSay: "TREE",       shouldSay: "THREE",     tip: "TH before the R — tongue peeks out, then immediately curls back. THREE not TREE. Slow it down: th-r-ee." },
  "thank":   { youSay: "TANK",       shouldSay: "THANK",     tip: "Tongue between teeth — TH. Unvoiced, just air. THANK not TANK. Your tongue tip touches the edge of your upper teeth." },
  "other":   { youSay: "UH-DER",     shouldSay: "UH-THER",   tip: "The middle TH — tongue between teeth. UH-THER not UH-DER. Voiced TH like in 'the'." },
  "mother":  { youSay: "MUH-DER",    shouldSay: "MUH-THER",  tip: "The TH in 'mother' is voiced — tongue between teeth with humming. MUH-THER not MUH-DER." },
  "father":  { youSay: "FAH-DER",    shouldSay: "FAH-THER",  tip: "Tongue between teeth for the TH. FAH-THER. The R at the end is pronounced with tongue curled back." },
  "weather": { youSay: "VEH-DER",    shouldSay: "WEH-THER",  tip: "Two issues: W not V at the start, and TH not D in the middle. WEH-THER. Lips round for W, tongue out for TH." },
  // Flap T (American T → sounds like D between vowels)
  "better":  { youSay: "BET-ter",    shouldSay: "BEH-der",   tip: "In American English the T between vowels becomes a quick flap — almost a D. BEH-der, not BET-ter. Tongue barely taps the ridge." },
  "butter":  { youSay: "BUT-ter",    shouldSay: "BUH-der",   tip: "That middle T flaps to a D sound. BUH-der. Rhymes with 'udder'. Tongue tap is very light and fast." },
  "city":    { youSay: "SIT-ee",     shouldSay: "SIH-dee",   tip: "American T between vowels → D. SIH-dee not SIT-ee. It's a very fast, light tongue tap." },
  "little":  { youSay: "LIT-tul",    shouldSay: "LIH-dul",   tip: "Both T's flap in American English. LIH-dul — the T barely taps and the final L is light." },
  "totally": { youSay: "TOH-tal-ee", shouldSay: "TOH-duh-lee", tip: "The T in the middle flaps — TOH-duh-lee. Americans never really enunciate that T hard." },
  "actually": { youSay: "AK-choo-al-ee", shouldSay: "AK-choo-uh-lee", tip: "Reduce that middle syllable — AK-choo-uh-lee. Americans swallow the 'al' into 'ul'. Fast and relaxed." },
  "literally": { youSay: "LIT-er-al-ee", shouldSay: "LIH-duh-ruh-lee", tip: "Every T flaps: LIH-duh-ruh-lee. Americans barely pronounce those T's. It almost sounds like 'lidrully'." },
  // Stress patterns
  "about":   { youSay: "UH-bout",    shouldSay: "uh-BOUT",   tip: "Stress is on the SECOND syllable — uh-BOUT not AH-bout. The first syllable is reduced to a quick schwa 'uh'." },
  "again":   { youSay: "UH-gen",     shouldSay: "uh-GEN",    tip: "Stress on GEN — uh-GEN. The first 'a' is a schwa, almost swallowed. uh-GEN." },
  "important": { youSay: "im-POR-tant", shouldSay: "im-POR-dnt", tip: "The T in the middle flaps — im-POR-dnt. And the last syllable collapses: not 'tant' but 'dnt'." },
};

async function generateCorrection(
  word: string,
  scenario: Scenario
): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return mockCorrection(word);
  }

  const errorInfo = INDIAN_EN_ERRORS[word.toLowerCase()];
  const context = errorInfo
    ? `The learner likely says "${errorInfo.youSay}" instead of the correct American pronunciation "${errorInfo.shouldSay}".`
    : `This word is commonly mispronounced by Indian English speakers targeting an American accent.`;

  const correctionSystem = `You are an American accent coach for Indian English speakers. 
Be specific: tell them exactly what sound they are making wrong (e.g. V instead of W, D instead of TH, hard T instead of flap T) and exactly how to fix it physically (tongue position, lip shape, airflow).
Format: 1 sentence on what they are doing wrong → 1 sentence on exact mouth/tongue fix → 1 short example.
Plain text only. Maximum 3 sentences. Be direct, not generic.`;

  const correctionPrompt = `Word: "${word}". ${context} Give a specific correction.`;

  // Try Anthropic first (better quality), fall back to Groq, then mock
  try {
    if (anthropic) {
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 150,
        system: correctionSystem,
        messages: [{ role: "user", content: correctionPrompt }],
      });
      return response.content[0].type === "text" ? response.content[0].text : mockCorrection(word);
    }
    if (process.env.GROQ_API_KEY) {
      return await groqChat([{ role: "user", content: correctionPrompt }], correctionSystem);
    }
  } catch (err) {
    console.error("Correction API failed:", err);
  }
  return mockCorrection(word);
}

function mockCorrection(word: string): string {
  const w = word.toLowerCase();
  const info = INDIAN_EN_ERRORS[w];
  if (info) {
    return info.tip;
  }
  // Generic fallback by pattern
  if (/^w/.test(w)) return `You may be saying V instead of W at the start. Round your lips like you're about to whistle — don't let your teeth touch your lip. Try: "${word}"`;
  if (/th/.test(w)) return `The TH sound needs your tongue tip between your teeth. Stick it out slightly and blow air — don't substitute D or T. Try: "${word}"`;
  if (/t[aeiou]/.test(w) && w.length > 4) return `In American English, T between vowels flaps to a soft D sound. Don't hit that T hard — let it tap lightly. Try: "${word}"`;
  return `Focus on reduced stress — Americans swallow unstressed syllables. Say "${word}" quickly and casually, don't enunciate every syllable equally.`;
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