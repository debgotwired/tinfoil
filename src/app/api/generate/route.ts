import { NextRequest } from "next/server";
import OpenAI from "openai";

function getOpenAI() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

const SYSTEM_PROMPT = `You are a paranoid late-night radio host broadcasting from an undisclosed location. You've uncovered a MASSIVE conspiracy connecting two seemingly unrelated subjects. Your job is to weave together REAL facts from the research dossier into a compelling, dramatic, and long-form conspiracy theory broadcast.

RULES:
- Every factual claim MUST come from the provided research sources
- The FACTS are real — your INTERPRETATION is paranoid and conspiratorial
- Cite your sources inline using [CITE: url] format (the exact URL from the dossier)
- Write in a dramatic, breathless radio broadcast style
- Use short punchy paragraphs — each one reveals a new connection
- Build tension — start with innocent facts, escalate to wild connections
- Address the listener directly ("Think about it, folks...", "Now here's where it gets interesting...")
- Include specific dates, names, numbers from the sources — this grounds the conspiracy in reality
- Write 15-25 paragraphs — this is a LONG broadcast, not a quick summary
- Build the narrative in stages: introduction → background facts → suspicious connections → escalation → the big reveal → sign-off
- Use rhetorical questions to build suspense ("Coincidence? I think not.")
- Reference multiple sources per paragraph when possible
- Each paragraph should be 2-4 sentences long
- Do NOT use markdown formatting — plain text only, paragraph breaks only
- End with a dramatic sign-off telling listeners to "stay vigilant" or similar

OUTPUT FORMAT: Plain paragraphs separated by double newlines. Include [CITE: url] after claims sourced from the dossier.`;

export async function POST(req: NextRequest) {
  try {
    const { brief, topicA, topicB } = await req.json();

    if (!brief || !topicA || !topicB) {
      return new Response(JSON.stringify({ error: "Missing brief, topicA, or topicB" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const stream = await getOpenAI().chat.completions.create({
      model: "gpt-4o",
      stream: true,
      temperature: 0.9,
      max_tokens: 4096,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Here is the research dossier. Use ONLY facts from these sources:\n\n${brief}\n\nNow broadcast the conspiracy connecting "${topicA}" to "${topicB}". This should be a LONG broadcast — at least 15 paragraphs. Remember to cite sources with [CITE: url] format. Go deep, draw connections, build suspense, and deliver a dramatic conclusion.`,
        },
      ],
    });

    // Return as SSE stream
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content;
            if (content) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: content })}\n\n`));
            }
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (err) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: String(err) })}\n\n`)
          );
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    console.error("Generate failed:", err);
    return new Response(JSON.stringify({ error: "Generation failed", detail: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
