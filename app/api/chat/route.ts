import { NextRequest, NextResponse } from "next/server";
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

// ── CLIP LIBRARY ──────────────────────────────────────────────────────
// Each clip targets specific Indian English → American English problem sounds
// errorTypes map to the categories in scoreWord()

export interface ClipChallenge {
  id: string;
  line: string;
  character: string;
  show: string;
  searchQuery: string;     // used to fetch a live YouTube ID at runtime
  youtubeId?: string;      // filled in at runtime by resolveYoutubeId()
  startTime: number;
  endTime: number;
  targetSounds: string[];
  hint: string;
}

// Fetch a live YouTube video ID for a search query using the YouTube Data API v3
async function resolveYoutubeId(searchQuery: string): Promise<string | null> {
  try {
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(searchQuery)}&type=video&key=${process.env.YOUTUBE_API_KEY}&maxResults=1`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data.items?.[0]?.id?.videoId ?? null;
  } catch {
    return null;
  }
}

const CLIP_LIBRARY: ClipChallenge[] = [
  // TH sounds
  {
    id: "friends-there",
    line: "I'll be there for you",
    character: "Theme Song",
    show: "Friends",
    searchQuery: "Friends I'll be there for you theme song official Rembrandts",
    startTime: 0,
    endTime: 8,
    targetSounds: ["TH"],
    hint: "Focus on 'there' — tongue tip between teeth, not D",
  },
  {
    id: "office-that",
    line: "That's what she said",
    character: "Michael Scott",
    show: "The Office",
    searchQuery: "The Office that's what she said Michael Scott compilation",
    startTime: 0,
    endTime: 4,
    targetSounds: ["TH"],
    hint: "Hit that TH in 'that' — tongue out between teeth",
  },
  {
    id: "breakingbad-this",
    line: "I am the one who knocks",
    character: "Walter White",
    show: "Breaking Bad",
    searchQuery: "Breaking Bad I am the one who knocks Walter White scene",
    startTime: 3,
    endTime: 15,
    targetSounds: ["TH"],
    hint: "Say 'the' with tongue between teeth — not 'da'",
  },
  // W/V confusion
  {
    id: "got-winter",
    line: "Winter is coming",
    character: "Ned Stark",
    show: "Game of Thrones",
    searchQuery: "Game of Thrones winter is coming Ned Stark scene",
    startTime: 0,
    endTime: 5,
    targetSounds: ["W"],
    hint: "Round your lips for W in 'winter' — not V",
  },
  {
    id: "matrix-welcome",
    line: "Welcome to the real world",
    character: "Morpheus",
    show: "The Matrix",
    searchQuery: "Matrix welcome to the real world Morpheus red pill scene",
    startTime: 0,
    endTime: 6,
    targetSounds: ["W", "TH"],
    hint: "Two W's and a TH — lips round for W, tongue out for 'the'",
  },
  {
    id: "forrest-wonder",
    line: "Life is like a box of chocolates",
    character: "Forrest Gump",
    show: "Forrest Gump",
    searchQuery: "Forrest Gump life is like a box of chocolates scene",
    startTime: 0,
    endTime: 6,
    targetSounds: ["W"],
    hint: "Soft relaxed American vowels — no sharp edges",
  },
  // Flap T
  {
    id: "friends-better",
    line: "Could this BE any more of a problem",
    character: "Chandler Bing",
    show: "Friends",
    searchQuery: "Friends Chandler could this BE any more funny compilation",
    startTime: 0,
    endTime: 5,
    targetSounds: ["FLAP_T"],
    hint: "American T between vowels taps soft like a D — 'butter' not 'but-ter'",
  },
  {
    id: "himym-literally",
    line: "I literally cannot even right now",
    character: "Various",
    show: "How I Met Your Mother",
    searchQuery: "How I Met Your Mother literally funny moments",
    startTime: 0,
    endTime: 5,
    targetSounds: ["FLAP_T"],
    hint: "The T in 'literally' flaps — say it fast, 'li-duh-ruh-lee'",
  },
  // Stress / schwa reduction
  {
    id: "darknight-why",
    line: "Why so serious",
    character: "The Joker",
    show: "The Dark Knight",
    searchQuery: "Dark Knight why so serious Joker Heath Ledger scene",
    startTime: 0,
    endTime: 6,
    targetSounds: ["STRESS"],
    hint: "Americans reduce unstressed syllables — 'serious' is 'SIR-ee-us' not 'see-ree-us'",
  },
  {
    id: "inception-idea",
    line: "What is the most resilient parasite — an idea",
    character: "Cobb",
    show: "Inception",
    searchQuery: "Inception what is the most resilient parasite an idea Cobb",
    startTime: 0,
    endTime: 8,
    targetSounds: ["STRESS", "TH"],
    hint: "Stress on 're-SIL-ient' — and TH in 'the'",
  },
  // Mixed / general American rhythm
  {
    id: "wolf-motivate",
    line: "The only thing standing between you and your goal is the story you keep telling yourself",
    character: "Jordan Belfort",
    show: "Wolf of Wall Street",
    searchQuery: "Wolf of Wall Street motivational speech Jordan Belfort",
    startTime: 0,
    endTime: 10,
    targetSounds: ["TH", "STRESS", "W"],
    hint: "Three TH sounds, two W's — focus on rhythm and linking words",
  },
  {
    id: "spiderman-power",
    line: "With great power comes great responsibility",
    character: "Uncle Ben",
    show: "Spider-Man",
    searchQuery: "Spider-Man with great power comes great responsibility Uncle Ben",
    startTime: 0,
    endTime: 6,
    targetSounds: ["W", "STRESS"],
    hint: "W in 'with' and 'power' — lips rounded, then natural American stress",
  },
];

// Map from error pattern → which targetSounds to look for
const ERROR_TO_SOUND: Record<string, string[]> = {
  w_confusion: ["W"],
  th_substitution: ["TH"],
  flap_t: ["FLAP_T"],
  stress: ["STRESS"],
};

// Detect dominant error type from accumulated word scores
function detectDominantError(allWordScores: WordScore[][]): string | null {
  const counts: Record<string, number> = { W: 0, TH: 0, FLAP_T: 0, STRESS: 0 };
  
  for (const turn of allWordScores) {
    for (const ws of turn) {
      if (ws.accuracyScore < 68) {
        const w = ws.word.toLowerCase();
        // Rough detection based on word patterns (mirrors scoreWord logic)
        if (/^w/.test(w) || ["we","were","would","well","with","world","work","water","word","wine","wide","wish"].includes(w)) counts.W++;
        if (/th/.test(w) || ["the","this","that","they","them","their","there","through","think","three","thank","other","mother","father","weather"].includes(w)) counts.TH++;
        if (["water","butter","better","little","city","totally","literally","actually","pretty","party"].includes(w)) counts.FLAP_T++;
        if (["about","again","important","because","together","another","beautiful"].includes(w)) counts.STRESS++;
      }
    }
  }

  const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (!dominant || dominant[1] === 0) return null;
  return dominant[0];
}

// Pick a clip targeting the dominant error, avoiding repeats
function pickClip(dominantError: string | null, usedClipIds: string[]): ClipChallenge | null {
  let candidates = CLIP_LIBRARY.filter(c => !usedClipIds.includes(c.id));
  
  if (dominantError) {
    const targeted = candidates.filter(c => c.targetSounds.includes(dominantError));
    if (targeted.length > 0) candidates = targeted;
  }

  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// ── SCENARIO PROMPTS (fixed — no more "try saying it" drilling) ───────
const SCENARIO_PROMPTS: Record<Scenario, string> = {
  casual: `You are Maya, a friendly American friend having a casual conversation with someone practicing their American accent.

Your ONLY job is to keep the conversation natural and fun. You happen to be good with accents, so if you notice a mispronunciation, you casually mention it in one clause — then immediately move the conversation forward.

Example: "Haha yeah, oh quick thing — it's WAH-der not VAH-ter, American thing — anyway what were you saying about your weekend?"

Rules:
- Continue the conversation topic FIRST, correction is a quick aside
- Never pause the conversation to drill a word
- Never ask them to repeat something
- If pronunciation was fine, just talk normally
- Max 2 sentences total
- Be warm, casual, like texting a friend`,

  interview: `You are a US hiring manager running a mock interview with someone practicing their American accent.

Ask one interview question per turn. If they mispronounced a word, drop a one-clause correction naturally, then ask your next question.

Example: "Good answer — quick note, 'important' is im-POR-dnt in American English — now tell me about a challenge you overcame."

Rules:
- Never ask them to repeat a word
- Correction is one clause only, then move on
- Keep it professional but warm
- Max 2 sentences total`,

  customer_call: `You are a US customer service rep practicing with someone learning American accent.

Play out a realistic service scenario. If they mispronounce something, correct it in one clause and keep going.

Example: "Got it — by the way, 'water' is WAH-der not VAH-ter — let me pull up your account."

Rules:
- Never ask them to repeat a word
- One correction clause max, then continue the scenario
- Max 2 sentences total`,
};

const THRESHOLD = 68;

// ── WORD ERROR DATABASE ───────────────────────────────────────────────
const INDIAN_EN_ERRORS: Record<string, { youSay: string; shouldSay: string; tip: string }> = {
  "water":   { youSay: "VAH-ter",    shouldSay: "WAH-der",   tip: "Round your lips into a W like you're about to whistle — don't touch your teeth. WAH-der, the T flaps to a soft D." },
  "we":      { youSay: "VEE",        shouldSay: "WEE",       tip: "W needs rounded lips, not teeth on lip. Pucker up like you're saying 'ooh' then slide to 'ee'. WEE." },
  "were":    { youSay: "VER",        shouldSay: "WUR",       tip: "Round lips for W, then the American R — tongue tip back, never touching. WUR-r-r." },
  "would":   { youSay: "VOOD",       shouldSay: "WUUD",      tip: "W not V — rounded lips. And the vowel is 'uh' not 'oo'. WUUD. Same as 'wood'." },
  "word":    { youSay: "VURD",       shouldSay: "WURD",      tip: "Round lips for W. The 'or' in American English is a strong R sound — WURD, rhymes with 'bird'." },
  "work":    { youSay: "VURK",       shouldSay: "WURK",      tip: "Round your lips for W, not teeth on lip. WURK — the vowel is like 'uh' with an R flavor." },
  "world":   { youSay: "VORLD",      shouldSay: "WURLD",     tip: "W with rounded lips, then that 'url' sound. WURLD — say 'girl' then swap the G for W." },
  "well":    { youSay: "VEL",        shouldSay: "WEL",       tip: "Lips rounded and pushed out for W. Don't let your top teeth touch your bottom lip. WEL." },
  "with":    { youSay: "VIT",        shouldSay: "WITH",      tip: "Two things: W not V (rounded lips), and end with TH — tongue between teeth. WITH." },
  "the":     { youSay: "DUH",        shouldSay: "THUH",      tip: "Stick your tongue tip just between your teeth and blow air. 'The' — that buzzing TH. Don't pull it back to make a D." },
  "this":    { youSay: "DIS",        shouldSay: "THIHS",     tip: "Tongue tip between teeth for TH. Feel the air flowing over your tongue. THIHS — not DIS." },
  "that":    { youSay: "DAT",        shouldSay: "THAT",      tip: "Tongue between teeth — TH. THAT. Your tongue tip literally peeks out between your teeth for a split second." },
  "they":    { youSay: "DAY",        shouldSay: "THAY",      tip: "Start with tongue between teeth — TH. Then 'ay'. THAY." },
  "them":    { youSay: "DEM",        shouldSay: "THEM",      tip: "Tongue tip between teeth, blow air — TH. THEM not DEM." },
  "their":   { youSay: "DAIR",       shouldSay: "THAIR",     tip: "Tongue between teeth for TH, then 'air'. THAIR." },
  "there":   { youSay: "DAIR",       shouldSay: "THAIR",     tip: "TH — tongue peeks between teeth. THAIR." },
  "through": { youSay: "TROO",       shouldSay: "THROO",     tip: "TH then R — tongue out for TH, then curl back for R. THROO." },
  "think":   { youSay: "TINK",       shouldSay: "THINK",     tip: "Tongue between teeth for TH — unvoiced. THINK." },
  "three":   { youSay: "TREE",       shouldSay: "THREE",     tip: "TH before the R — tongue peeks out, then immediately curls back. THREE not TREE." },
  "thank":   { youSay: "TANK",       shouldSay: "THANK",     tip: "Tongue between teeth — TH. Unvoiced, just air. THANK not TANK." },
  "other":   { youSay: "UH-DER",     shouldSay: "UH-THER",   tip: "The middle TH — tongue between teeth. UH-THER not UH-DER." },
  "mother":  { youSay: "MUH-DER",    shouldSay: "MUH-THER",  tip: "The TH in 'mother' is voiced — tongue between teeth with humming. MUH-THER." },
  "father":  { youSay: "FAH-DER",    shouldSay: "FAH-THER",  tip: "Tongue between teeth for the TH. FAH-THER." },
  "weather": { youSay: "VEH-DER",    shouldSay: "WEH-THER",  tip: "Two issues: W not V at the start, and TH not D in the middle. WEH-THER." },
  "better":  { youSay: "BET-ter",    shouldSay: "BEH-der",   tip: "In American English the T between vowels becomes a quick flap — almost a D. BEH-der." },
  "butter":  { youSay: "BUT-ter",    shouldSay: "BUH-der",   tip: "That middle T flaps to a D sound. BUH-der." },
  "city":    { youSay: "SIT-ee",     shouldSay: "SIH-dee",   tip: "American T between vowels → D. SIH-dee not SIT-ee." },
  "little":  { youSay: "LIT-tul",    shouldSay: "LIH-dul",   tip: "Both T's flap in American English. LIH-dul." },
  "totally": { youSay: "TOH-tal-ee", shouldSay: "TOH-duh-lee", tip: "The T in the middle flaps — TOH-duh-lee." },
  "actually": { youSay: "AK-choo-al-ee", shouldSay: "AK-choo-uh-lee", tip: "Reduce that middle syllable — AK-choo-uh-lee." },
  "literally": { youSay: "LIT-er-al-ee", shouldSay: "LIH-duh-ruh-lee", tip: "Every T flaps: LIH-duh-ruh-lee." },
  "about":   { youSay: "UH-bout",    shouldSay: "uh-BOUT",   tip: "Stress is on the SECOND syllable — uh-BOUT. The first syllable is a quick schwa." },
  "again":   { youSay: "UH-gen",     shouldSay: "uh-GEN",    tip: "Stress on GEN — uh-GEN." },
  "important": { youSay: "im-POR-tant", shouldSay: "im-POR-dnt", tip: "The T flaps — im-POR-dnt. Last syllable collapses." },
};

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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      messages,
      scenario,
      wordScores,
      isRetry,
      retryWord,
      turnCount,
      allWordScores, // accumulated word scores from all previous turns
      usedClipIds,  // clips already shown this session
    }: {
      messages: Message[];
      scenario: Scenario;
      wordScores?: WordScore[];
      isRetry?: boolean;
      retryWord?: string;
      turnCount?: number;
      allWordScores?: WordScore[][];
      usedClipIds?: string[];
    } = body;

    // Find words below threshold
    const problemWords =
      wordScores?.filter((w) => w.accuracyScore < THRESHOLD && w.errorType !== "None") ?? [];

    const worstWord = problemWords.length > 0 && !isRetry
      ? problemWords.sort((a, b) => a.accuracyScore - b.accuracyScore)[0]
      : null;

    // ── CLIP CHALLENGE TRIGGER ────────────────────────────────────────
    // Fire after turn 2 (0-indexed), then every 3 turns after that
    // Only fire if we have accumulated error data
    const currentTurn = turnCount ?? 0;
    const shouldShowClip =
      !isRetry &&
      (currentTurn === 2 || (currentTurn > 2 && (currentTurn - 2) % 3 === 0)) &&
      allWordScores &&
      allWordScores.length > 0;

    let clipChallenge: ClipChallenge | null = null;
    let clipIntro = "";

    if (shouldShowClip) {
      const dominantError = detectDominantError(allWordScores ?? []);
      clipChallenge = pickClip(dominantError, usedClipIds ?? []);

      if (clipChallenge) {
        // Resolve a live YouTube ID at runtime so we never get stale/dead embeds
        const liveId = await resolveYoutubeId(clipChallenge.searchQuery);
        if (liveId) {
          clipChallenge = { ...clipChallenge, youtubeId: liveId };
          const errorLabel: Record<string, string> = {
            TH: "your TH sounds",
            W: "your W sounds",
            FLAP_T: "that American T",
            STRESS: "word stress",
          };
          const focusLabel = dominantError ? errorLabel[dominantError] ?? "your pronunciation" : "your pronunciation";
          clipIntro = `Hey, I want to try something - I noticed you're working on ${focusLabel}. Here's a line from ${clipChallenge.show}. Try saying it exactly like the character does:`;
        } else {
          // YouTube API failed or no results - skip clip this turn
          clipChallenge = null;
        }
      }
    }

    // Mock mode — no Groq key
    if (!process.env.GROQ_API_KEY) {
      return NextResponse.json({
        type: clipChallenge ? "clip_challenge" : "continue",
        content: clipChallenge ? clipIntro : getMockResponse(scenario, messages.length),
        problemWords,
        worstWord: worstWord ?? undefined,
        clipChallenge: clipChallenge ?? undefined,
      });
    }

    // Build messages for Groq — inject correction note if needed
    const chatMessages = messages.map((m) => ({ role: m.role, content: m.content }));

    if (worstWord && !clipChallenge) {
      const errorInfo = INDIAN_EN_ERRORS[worstWord.word.toLowerCase()];
      const pronunciationNote = errorInfo
        ? `[COACH NOTE: The learner mispronounced "${worstWord.word}" — they likely said "${errorInfo.youSay}" instead of "${errorInfo.shouldSay}". Drop a one-clause correction naturally mid-sentence, then immediately continue the conversation. Do NOT ask them to repeat it. Do NOT pause the conversation.]`
        : `[COACH NOTE: The learner mispronounced "${worstWord.word}" (score: ${worstWord.accuracyScore}%). Drop a one-clause correction naturally, then immediately continue. Do NOT ask them to repeat it.]`;

      if (chatMessages.length > 0) {
        const last = chatMessages[chatMessages.length - 1];
        chatMessages[chatMessages.length - 1] = {
          ...last,
          content: last.content + " " + pronunciationNote,
        };
      }
    }

    // If showing a clip, override the AI response with the intro
    if (clipChallenge) {
      return NextResponse.json({
        type: "clip_challenge",
        content: clipIntro,
        problemWords,
        worstWord: worstWord ?? undefined,
        clipChallenge,
      });
    }

    const content = await groqChat(chatMessages, SCENARIO_PROMPTS[scenario]);

    return NextResponse.json({
      type: "continue",
      content,
      problemWords,
      worstWord: worstWord ?? undefined,
      retryWordResult: isRetry ? { word: retryWord, passed: problemWords.length === 0 } : undefined,
    });
  } catch (err) {
    console.error("Chat error:", err);
    return NextResponse.json({ error: "Chat failed" }, { status: 500 });
  }
}