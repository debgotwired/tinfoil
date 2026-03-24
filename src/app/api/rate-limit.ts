import { NextRequest, NextResponse } from "next/server";

const DAILY_LIMIT = 3;

// In-memory store: IP → { count, resetAt }
// Resets on cold start (fine for hackathon). For production, use Redis/KV.
const store = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(req: NextRequest): NextResponse | null {
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";

  const now = Date.now();
  const entry = store.get(ip);

  if (entry && now < entry.resetAt) {
    if (entry.count >= DAILY_LIMIT) {
      return NextResponse.json(
        {
          error: "rate_limited",
          message: "You've used all 3 investigations for today. Come back tomorrow for more conspiracies...",
        },
        { status: 429 }
      );
    }
    entry.count++;
  } else {
    // New day or first request
    const midnight = new Date();
    midnight.setHours(24, 0, 0, 0);
    store.set(ip, { count: 1, resetAt: midnight.getTime() });
  }

  return null; // Allowed
}
