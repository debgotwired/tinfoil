import { NextRequest, NextResponse } from "next/server";
import FirecrawlApp from "@mendable/firecrawl-js";
import { checkRateLimit } from "../rate-limit";

let _firecrawl: FirecrawlApp | null = null;
function getFirecrawl() {
  if (!_firecrawl) {
    _firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY! });
  }
  return _firecrawl;
}

// Strip control characters that break JSON
function sanitize(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim();
}

function extractTitleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.split("/").filter(Boolean).pop() || u.hostname;
    return path.replace(/[-_]/g, " ").replace(/\.\w+$/, "").slice(0, 60);
  } catch {
    return "Source";
  }
}

const searchErrors: string[] = [];

async function searchFirecrawl(query: string, limit = 5) {
  try {
    const result = await getFirecrawl().search(query, { limit });
    if (result.success && result.data) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return result.data.map((doc: any) => ({
        title: sanitize(doc.title || doc.metadata?.title || doc.metadata?.ogTitle || extractTitleFromUrl(doc.url || "")),
        url: doc.url || doc.metadata?.sourceURL || doc.metadata?.ogUrl || "",
        description: sanitize(doc.description || doc.metadata?.description || doc.metadata?.ogDescription || (doc.markdown ? doc.markdown.slice(0, 200) : "")),
        markdown: sanitize(doc.markdown || doc.description || ""),
      }));
    }
    searchErrors.push(`"${query}": no success (${JSON.stringify(result).slice(0, 200)})`);
    return [];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    searchErrors.push(`"${query}": ${msg}`);
    console.error(`Search failed for "${query}":`, err);
    return [];
  }
}

export async function POST(req: NextRequest) {
  // Rate limit: 3 investigations per IP per day
  const rateLimited = checkRateLimit(req);
  if (rateLimited) return rateLimited;

  try {
    const { topicA, topicB } = await req.json();

    if (!topicA || !topicB) {
      return NextResponse.json({ error: "Two topics required" }, { status: 400 });
    }

    // 8 parallel queries for deeper research — more material = longer, richer conspiracy
    const [
      resultsA, resultsB, directConnection,
      controversyA, controversyB,
      historyA, historyB, crossRef,
    ] = await Promise.all([
      searchFirecrawl(`${topicA} history facts overview`, 5),
      searchFirecrawl(`${topicB} history facts overview`, 5),
      searchFirecrawl(`"${topicA}" "${topicB}" connection relationship`, 5),
      searchFirecrawl(`${topicA} scandal controversy secret hidden`, 5),
      searchFirecrawl(`${topicB} scandal controversy secret hidden`, 5),
      searchFirecrawl(`${topicA} origin founding timeline key people`, 5),
      searchFirecrawl(`${topicB} origin founding timeline key people`, 5),
      searchFirecrawl(`${topicA} ${topicB} coincidence suspicious link`, 4),
    ]);

    // Deduplicate by URL
    const seen = new Set<string>();
    const allSources: { title: string; url: string; snippet: string; category: string }[] = [];

    const addResults = (
      results: { title: string; url: string; description: string; markdown: string }[],
      category: string
    ) => {
      for (const r of results) {
        if (!r.url || seen.has(r.url)) continue;
        seen.add(r.url);
        allSources.push({
          title: r.title,
          url: r.url,
          snippet: r.description || r.markdown.slice(0, 400),
          category,
        });
      }
    };

    addResults(resultsA, `About ${topicA}`);
    addResults(resultsB, `About ${topicB}`);
    addResults(directConnection, "Direct connections");
    addResults(controversyA, `${topicA} secrets`);
    addResults(controversyB, `${topicB} secrets`);
    addResults(historyA, `${topicA} history`);
    addResults(historyB, `${topicB} history`);
    addResults(crossRef, "Cross-references");

    // Build brief for the agent — include more content per source
    let brief = `=== RESEARCH DOSSIER ===\nSUBJECT A: ${topicA}\nSUBJECT B: ${topicB}\nSOURCES: ${allSources.length}\n\n`;

    const categories = new Map<string, typeof allSources>();
    for (const s of allSources) {
      if (!categories.has(s.category)) categories.set(s.category, []);
      categories.get(s.category)!.push(s);
    }

    for (const [category, items] of categories) {
      brief += `--- ${category.toUpperCase()} ---\n`;
      for (const item of items) {
        brief += `[${item.title}] (${item.url})\n  ${item.snippet.slice(0, 500)}\n\n`;
      }
    }

    brief += `=== END DOSSIER ===\nUsing ONLY these facts, construct a conspiracy theory connecting ${topicA} to ${topicB}. Facts must be real. Interpretation can be paranoid.`;

    return NextResponse.json({
      topicA,
      topicB,
      sources: allSources,
      brief,
      sourceCount: allSources.length,
      ...(searchErrors.length > 0 && { _debug: { errors: searchErrors, keySet: !!process.env.FIRECRAWL_API_KEY, keyPrefix: (process.env.FIRECRAWL_API_KEY || "").slice(0, 6) } }),
    });
  } catch (err) {
    console.error("Research failed:", err);
    return NextResponse.json(
      { error: "Research failed", detail: String(err) },
      { status: 500 }
    );
  }
}
