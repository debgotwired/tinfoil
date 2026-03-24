"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { Source, ResearchResult } from "@/lib/types";
import { SourceCard } from "./SourceCard";

const PAIRS = [
  ["IKEA", "the CIA"],
  ["Taylor Swift", "the Federal Reserve"],
  ["Minecraft", "the Vatican"],
  ["Costco", "Area 51"],
  ["LEGO", "the Bermuda Triangle"],
  ["Crocs", "the Illuminati"],
];

function seededRand(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

function addRedactions(text: string): (string | { redacted: string })[] {
  const words = text.split(" ");
  const parts: (string | { redacted: string })[] = [];
  let buf: string[] = [];
  let seed = 0;
  for (let c = 0; c < text.length; c++) seed += text.charCodeAt(c);

  for (let i = 0; i < words.length; i++) {
    const r = seededRand(seed + i * 7);
    if (words[i].length >= 5 && r < 0.25 && i < words.length - 2 && i > 3) {
      if (buf.length) { parts.push(buf.join(" ")); buf = []; }
      parts.push({ redacted: words[i] });
    } else {
      buf.push(words[i]);
    }
  }
  if (buf.length) parts.push(buf.join(" "));
  return parts;
}

function parseCitations(text: string): { clean: string; urls: string[] } {
  const urls: string[] = [];
  const clean = text.replace(/\[CITE:\s*(https?:\/\/[^\]]+)\]/g, (_, url) => {
    urls.push(url.trim());
    return "";
  });
  return { clean: clean.replace(/\s{2,}/g, " ").trim(), urls };
}

// Fetch TTS audio blob from the speak endpoint
async function fetchTTSBlob(text: string): Promise<Blob> {
  const res = await fetch("/api/speak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`TTS failed (${res.status}): ${err}`);
  }
  return res.blob();
}

export function ConspiracyBoard() {
  const [phase, setPhase] = useState<"input" | "researching" | "generating" | "broadcasting" | "done">("input");
  const [topicA, setTopicA] = useState("");
  const [topicB, setTopicB] = useState("");
  const [citedSources, setCitedSources] = useState<Source[]>([]);
  const [research, setResearch] = useState<ResearchResult | null>(null);
  const [transcript, setTranscript] = useState<string[]>([]);
  const [rawTranscript, setRawTranscript] = useState<string[]>([]);
  const [showDecrypted, setShowDecrypted] = useState(false);
  const [placeholder, setPlaceholder] = useState(PAIRS[0]);
  useEffect(() => {
    setPlaceholder(PAIRS[Math.floor(Math.random() * PAIRS.length)]);
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioBlobUrl, setAudioBlobUrl] = useState<string | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const inputBRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const abortRef = useRef(false);

  // Client-only timestamp (avoids hydration mismatch)
  const [clientTime, setClientTime] = useState<string | null>(null);
  useEffect(() => {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
    setClientTime(`DATE: ${now.getDate()} ${months[now.getMonth()]} 202X // ${hh}:${mm}`);
  }, [transcript.length]);

  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [transcript]);

  // Play a blob via Web Audio API or Audio element. Returns a Promise that resolves when playback ends.
  const playBlob = useCallback((blob: Blob): Promise<void> => {
    return new Promise(async (resolve) => {
      if (abortRef.current) { resolve(); return; }

      const ctx = audioCtxRef.current;

      // Strategy 1: Web Audio API (AudioContext was unlocked on user gesture)
      if (ctx && ctx.state !== "closed") {
        try {
          if (ctx.state === "suspended") await ctx.resume();
          const arrayBuffer = await blob.arrayBuffer();
          const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(ctx.destination);
          audioSourceRef.current = source;
          setIsPlaying(true);
          source.onended = () => {
            audioSourceRef.current = null;
            setIsPlaying(false);
            resolve();
          };
          source.start(0);
          return;
        } catch (e) {
          console.warn("Web Audio decode/play failed:", e);
        }
      }

      // Strategy 2: HTML Audio element
      try {
        const blobUrl = URL.createObjectURL(blob);
        const audio = new Audio(blobUrl);
        audioRef.current = audio;
        setIsPlaying(true);
        audio.onended = () => {
          setIsPlaying(false);
          URL.revokeObjectURL(blobUrl);
          audioRef.current = null;
          resolve();
        };
        audio.onerror = () => {
          setIsPlaying(false);
          URL.revokeObjectURL(blobUrl);
          audioRef.current = null;
          resolve();
        };
        await audio.play();
        return;
      } catch (e) {
        console.warn("Audio.play() rejected:", e);
      }

      // Strategy 3: Manual play button — store blob URL, resolve when user clicks play
      const blobUrl = URL.createObjectURL(blob);
      setAudioBlobUrl(blobUrl);
      setIsPlaying(false);
      // Don't resolve — playAudioManual will handle completion
      // Store resolve so manual play can call it
      manualResolveRef.current = resolve;
    });
  }, []);

  const manualResolveRef = useRef<(() => void) | null>(null);

  const playAudioManual = useCallback(async (blobUrl: string) => {
    try {
      const audio = new Audio(blobUrl);
      audioRef.current = audio;
      setIsPlaying(true);
      setAudioBlobUrl(null);
      audio.onended = () => {
        setIsPlaying(false);
        audioRef.current = null;
        if (manualResolveRef.current) {
          manualResolveRef.current();
          manualResolveRef.current = null;
        }
      };
      audio.onerror = () => {
        setIsPlaying(false);
        audioRef.current = null;
        if (manualResolveRef.current) {
          manualResolveRef.current();
          manualResolveRef.current = null;
        }
      };
      await audio.play();
    } catch {
      setIsPlaying(false);
      if (manualResolveRef.current) {
        manualResolveRef.current();
        manualResolveRef.current = null;
      }
    }
  }, []);

  const handleConnect = useCallback(async () => {
    if (!topicA.trim() || !topicB.trim()) return;

    // Reset all state
    setPhase("researching");
    setCitedSources([]);
    setTranscript([]);
    setRawTranscript([]);
    setShowDecrypted(false);
    setResearch(null);
    setError(null);
    setIsPlaying(false);
    setAudioBlobUrl(null);
    abortRef.current = false;

    // Create AudioContext NOW during user gesture — unlocks audio for Chrome
    if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
      audioCtxRef.current = new AudioContext();
    }
    if (audioCtxRef.current.state === "suspended") {
      await audioCtxRef.current.resume();
    }

    try {
      // ═══ 1. RESEARCH via Firecrawl ═══
      const researchRes = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topicA: topicA.trim(), topicB: topicB.trim() }),
      });
      if (!researchRes.ok) throw new Error("Firecrawl research failed");
      const data: ResearchResult = await researchRes.json();
      setResearch(data);

      // ═══ 2. STREAM conspiracy text from OpenAI ═══
      setPhase("generating");
      const genRes = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brief: data.brief,
          topicA: topicA.trim(),
          topicB: topicB.trim(),
        }),
      });
      if (!genRes.ok) throw new Error("Generation failed");

      const reader = genRes.body!.getReader();
      const decoder = new TextDecoder();
      let currentParagraph = "";
      const completedParagraphs: string[] = []; // clean text for TTS
      let firstTTSFired = false;
      let audioPlaybackPromise: Promise<void> | null = null;
      const FIRST_BATCH_SIZE = 3;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (abortRef.current) { reader.cancel(); break; }

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6);
          if (payload === "[DONE]") continue;
          try {
            const parsed = JSON.parse(payload);
            if (!parsed.text) continue;
            currentParagraph += parsed.text;

            if (currentParagraph.includes("\n\n")) {
              const paragraphs = currentParagraph.split("\n\n");
              for (let i = 0; i < paragraphs.length - 1; i++) {
                const p = paragraphs[i].trim();
                if (!p) continue;
                const { clean, urls } = parseCitations(p);
                if (clean) {
                  setTranscript((prev) => [...prev, clean]);
                  setRawTranscript((prev) => [...prev, clean]);
                  completedParagraphs.push(clean);
                }
                for (const url of urls) {
                  const matchedSource = data.sources.find(
                    (s) => url.includes(s.url) || s.url.includes(url)
                  );
                  if (matchedSource) {
                    setCitedSources((prev) =>
                      prev.some((s) => s.url === matchedSource.url) ? prev : [...prev, matchedSource]
                    );
                  }
                }
              }
              currentParagraph = paragraphs[paragraphs.length - 1];

              // ═══ Fire TTS + start playing after enough paragraphs (runs in background) ═══
              if (!firstTTSFired && completedParagraphs.length >= FIRST_BATCH_SIZE) {
                firstTTSFired = true;
                setPhase("broadcasting");
                const firstBatchText = completedParagraphs.slice(0, FIRST_BATCH_SIZE).join("\n\n");
                // Fire TTS and start playing IN BACKGROUND — SSE continues reading
                audioPlaybackPromise = (async () => {
                  const blob = await fetchTTSBlob(firstBatchText);
                  if (!abortRef.current) await playBlob(blob);
                })();
              }
            }
          } catch {
            // Skip malformed SSE chunks
          }
        }
      }

      // Flush remaining paragraph
      if (currentParagraph.trim()) {
        const { clean, urls } = parseCitations(currentParagraph.trim());
        if (clean) {
          setTranscript((prev) => [...prev, clean]);
          setRawTranscript((prev) => [...prev, clean]);
          completedParagraphs.push(clean);
        }
        for (const url of urls) {
          const matchedSource = data.sources.find(
            (s) => url.includes(s.url) || s.url.includes(url)
          );
          if (matchedSource) {
            setCitedSources((prev) =>
              prev.some((s) => s.url === matchedSource.url) ? prev : [...prev, matchedSource]
            );
          }
        }
      }

      if (abortRef.current) return;

      // ═══ 3. PLAY REMAINING AUDIO ═══
      if (firstTTSFired) {
        // First batch audio is already playing (or queued). Get remaining text.
        const remainingText = completedParagraphs.slice(FIRST_BATCH_SIZE).join("\n\n");

        // Pre-fetch second TTS while first audio still plays
        const secondTTSPromise = remainingText.trim() ? fetchTTSBlob(remainingText) : null;

        // Wait for first audio to finish
        if (audioPlaybackPromise) await audioPlaybackPromise;
        if (abortRef.current) return;

        // Play second chunk
        if (secondTTSPromise) {
          setPhase("broadcasting");
          const secondBlob = await secondTTSPromise;
          if (abortRef.current) return;
          await playBlob(secondBlob);
        }
      } else {
        // Short response — less than FIRST_BATCH_SIZE paragraphs. Send all at once.
        setPhase("broadcasting");
        const allText = completedParagraphs.join("\n\n");
        if (allText.trim()) {
          const blob = await fetchTTSBlob(allText);
          if (abortRef.current) return;
          await playBlob(blob);
        }
      }

      if (!abortRef.current) {
        setPhase("done");
        setIsPlaying(false);
      }
    } catch (err) {
      if (!abortRef.current) {
        console.error("Failed:", err);
        setError(String(err));
        setPhase("input");
      }
    }
  }, [topicA, topicB, playBlob]);

  const handleStop = useCallback(() => {
    abortRef.current = true;
    if (audioSourceRef.current) {
      try { audioSourceRef.current.stop(); } catch { /* already stopped */ }
      audioSourceRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (manualResolveRef.current) {
      manualResolveRef.current();
      manualResolveRef.current = null;
    }
    setIsPlaying(false);
    setAudioBlobUrl(null);
    setPhase("done");
  }, []);

  const handleReset = useCallback(() => {
    handleStop();
    abortRef.current = false;
    setPhase("input");
    setTranscript([]);
    setRawTranscript([]);
    setShowDecrypted(false);
    setCitedSources([]);
    setResearch(null);
    setError(null);
  }, [handleStop]);

  const handleDecryptLogs = useCallback(() => {
    setShowDecrypted((prev) => !prev);
  }, []);

  const handleArchiveEvidence = useCallback(() => {
    if (!transcript.length && !citedSources.length) return;
    const lines: string[] = [];
    lines.push("=== TINFOIL — DECLASSIFIED ARCHIVE ===");
    lines.push(`SUBJECTS: ${topicA} x ${topicB}`);
    lines.push(`SOURCES: ${citedSources.length}`);
    lines.push("");
    lines.push("--- TRANSCRIPT ---");
    for (const t of rawTranscript) lines.push(t + "\n");
    lines.push("");
    lines.push("--- CITED SOURCES ---");
    for (const s of citedSources) {
      lines.push(`[${s.title}]`);
      lines.push(`  ${s.url}`);
      if (s.snippet) lines.push(`  ${s.snippet}`);
      lines.push("");
    }
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tinfoil-${topicA.replace(/\s+/g, "-")}-${topicB.replace(/\s+/g, "-")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [transcript, rawTranscript, citedSources, topicA, topicB]);

  // Determine which transcript to show
  const displayTranscript = showDecrypted ? rawTranscript : transcript;

  return (
    <div className="crt-frame">
      <div className="h-dvh flex flex-col overflow-hidden ambient-flicker vignette">
        {/* ═══ TOP BAR ═══ */}
        <header className="dossier-header flex-shrink-0 flex items-center justify-between px-5 py-2.5">
          <div className="flex items-center gap-5">
            <h1 className="font-display text-lg tracking-[0.25em] text-bright uppercase">
              Project: <span className="redacted">TINFOIL</span>
            </h1>
            <div className="stamp-large">CLASSIFIED</div>
            {(phase === "broadcasting" || isPlaying) && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                className="stamp"
                style={{ transform: "rotate(-2deg)" }}
              >
                LIVE BROADCAST
              </motion.div>
            )}
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className={`w-2.5 h-2.5 rounded-full ${
                phase === "broadcasting" || isPlaying ? "bg-phosphor-bright led-pulse text-phosphor-bright" :
                phase === "generating" ? "bg-yellow-500 animate-pulse" :
                phase === "researching" ? "bg-yellow-500 animate-pulse" :
                "bg-muted/40"
              }`} />
              <span className="font-mono text-[9px] tracking-[0.15em] text-dim uppercase">
                {isPlaying ? "TX Active" :
                 phase === "broadcasting" ? "Buffering" :
                 phase === "generating" ? "Generating Intel" :
                 phase === "researching" ? "Scanning Frequencies" :
                 phase === "done" ? "Broadcast Complete" :
                 "Awaiting Input"}
              </span>
            </div>
            <span className="font-mono text-[8px] text-muted/30 tracking-[0.15em]">HACKATHON 20XX — INTEL v0.1 ALPHA</span>
          </div>
        </header>

        {/* ═══ SYSTEM STATUS BAR ═══ */}
        <div className="flex-shrink-0 px-5 py-1 bg-dark/80 border-b border-border flex items-center gap-4 overflow-hidden">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-phosphor-dim led-blink" />
            <span className="font-mono text-[7px] text-muted/50 tracking-wider">SYS</span>
          </div>
          <div className="h-px flex-1 bg-border" />
          {research && (
            <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="font-mono text-[7px] text-phosphor-dim/70 tracking-wider">
              {research.sources?.length || 0} SOURCES INDEXED // DOSSIER COMPILED
            </motion.span>
          )}
          {!research && (
            <span className="font-mono text-[7px] text-muted/30 tracking-wider">
              FIRECRAWL + OPENAI + ELEVENLABS // INTELLIGENCE PIPELINE READY
            </span>
          )}
          <div className="h-px flex-1 bg-border" />
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[7px] text-muted/50 tracking-wider">NET</span>
            <div className="w-1.5 h-1.5 rounded-full bg-phosphor-dim/50" />
          </div>
        </div>

        {/* ═══ MAIN 3-COLUMN LAYOUT ═══ */}
        <div className="flex-1 flex min-h-0">

          {/* ─── LEFT: EVIDENCE BOARD ─── */}
          <div className="w-[300px] flex-shrink-0 flex flex-col border-r border-border cork-bg">
            <div className="px-4 py-2 border-b border-black/20">
              <h2 className="font-display text-[11px] tracking-[0.2em] text-bright/70 uppercase">Key Evidence</h2>
              <div className="font-mono text-[7px] text-muted/40 mt-0.5">
                {citedSources.length} document{citedSources.length !== 1 ? "s" : ""} pinned
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              <AnimatePresence>
                {citedSources.length === 0 && (
                  <motion.div key="empty" exit={{ opacity: 0 }} className="h-full flex items-center justify-center">
                    <div className="text-center p-6">
                      <div className="w-20 h-24 mx-auto mb-3 border-2 border-dashed border-bright/10 rounded-sm flex items-center justify-center relative">
                        <div className="absolute -top-1.5 left-1/2 -translate-x-1/2">
                          <div className="pin" style={{ width: 10, height: 10 }} />
                        </div>
                        <span className="text-muted/20 text-2xl font-display">?</span>
                      </div>
                      <p className="font-display text-[10px] text-bright/20 leading-relaxed">
                        Evidence will be<br />pinned here during<br />the broadcast
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              {citedSources.map((source, i) => (
                <SourceCard key={source.url} source={source} index={i} />
              ))}
            </div>
          </div>

          {/* ─── CENTER: INTEL FEED ─── */}
          <div className="flex-1 flex flex-col min-w-0 relative">
            {/* Input area */}
            <div className="flex-shrink-0 px-6 py-5 border-b border-border bg-dark/80">
              <div className="flex items-end gap-4 max-w-2xl">
                <div className="flex-1">
                  <label htmlFor="subject-a" className="block font-display text-[10px] text-dim tracking-[0.2em] mb-1.5 uppercase">Subject A</label>
                  <input
                    id="subject-a" type="text" value={topicA} onChange={(e) => setTopicA(e.target.value)}
                    placeholder={placeholder[0]} disabled={phase !== "input"}
                    onKeyDown={(e) => { if (e.key === "Enter") inputBRef.current?.focus(); }}
                    className="w-full bg-void/60 border border-border-active text-bright font-display text-base tracking-wide px-3 py-2.5 placeholder:text-muted/15 focus:outline-none focus:border-phosphor-dim/60 transition-colors disabled:opacity-20"
                  />
                </div>
                <div className="pb-3 text-signal font-display text-lg">&times;</div>
                <div className="flex-1">
                  <label htmlFor="subject-b" className="block font-display text-[10px] text-dim tracking-[0.2em] mb-1.5 uppercase">Subject B</label>
                  <input
                    id="subject-b" ref={inputBRef} type="text" value={topicB} onChange={(e) => setTopicB(e.target.value)}
                    placeholder={placeholder[1]} disabled={phase !== "input"}
                    onKeyDown={(e) => { if (e.key === "Enter") handleConnect(); }}
                    className="w-full bg-void/60 border border-border-active text-bright font-display text-base tracking-wide px-3 py-2.5 placeholder:text-muted/15 focus:outline-none focus:border-phosphor-dim/60 transition-colors disabled:opacity-20"
                  />
                </div>
              </div>
              {error && (
                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-3 font-mono text-[10px] text-signal">
                  {error}
                </motion.p>
              )}
            </div>

            {/* Feed header */}
            <div className="flex-shrink-0 px-6 py-1.5 bg-paper-dark/90 border-b border-stone-400/30 flex items-center gap-3">
              <span className="font-display text-[10px] text-stone-700 tracking-[0.2em] uppercase">
                {showDecrypted ? "Decrypted Feed" : "Intel Feed / Anomaly Reports"}
              </span>
              <div className="flex-1 h-px bg-stone-400/30" />
              {isPlaying && (
                <div className="flex items-center gap-1.5">
                  <div className="waveform-bars flex gap-[2px]">
                    {[...Array(8)].map((_, i) => (
                      <motion.div key={i} className="w-[2px] rounded-full bg-phosphor"
                        animate={{ height: [1, 6 + Math.random() * 8, 1] }}
                        transition={{ duration: 0.3 + Math.random() * 0.3, repeat: Infinity, delay: i * 0.04, ease: "easeInOut" }}
                      />
                    ))}
                  </div>
                  <span className="font-mono text-[7px] text-stone-500 tracking-wider">TRANSMITTING</span>
                </div>
              )}
              {phase === "generating" && !isPlaying && (
                <div className="flex items-center gap-1.5">
                  <span className="typewriter-cursor font-mono text-[7px] text-stone-500 tracking-wider">DECRYPTING</span>
                </div>
              )}
            </div>

            {/* Feed content */}
            <div ref={feedRef} className="flex-1 overflow-y-auto px-6 py-5 relative paper-bg scanline">
              <AnimatePresence mode="wait">
                {phase === "input" && !transcript.length && (
                  <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="h-full flex items-center justify-center relative z-10">
                    <div className="text-center max-w-lg space-y-5">
                      <p className="font-display text-2xl text-stone-600/60 leading-relaxed">
                        Enter two subjects.<br />Get the conspiracy.
                      </p>
                      <p className="text-sm text-stone-500/60 leading-relaxed max-w-sm mx-auto">
                        We search the web for real facts, then AI weaves
                        the paranoid connection and broadcasts it live. Every source is verifiable.
                      </p>
                      <div className="flex items-center justify-center gap-3">
                        <div className="h-px w-12 bg-stamp/15" />
                        <p className="font-display text-[10px] text-stamp/30 tracking-[0.3em]">THE INTERPRETATION IS OURS</p>
                        <div className="h-px w-12 bg-stamp/15" />
                      </div>
                    </div>
                  </motion.div>
                )}

                {phase === "researching" && (
                  <motion.div key="scan" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="h-full flex items-center justify-center relative z-10">
                    <div className="text-center space-y-5">
                      <div className="flex justify-center gap-[3px]">
                        {[...Array(16)].map((_, i) => (
                          <motion.div key={i} className="w-[2px] rounded-sm bg-stone-500"
                            animate={{ height: [2, 24, 2] }}
                            transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.05, ease: "easeInOut" }}
                          />
                        ))}
                      </div>
                      <div>
                        <p className="font-display text-sm text-stone-700 mb-1">Scanning frequencies...</p>
                        <p className="font-mono text-[9px] text-stone-500/60">
                          FIRECRAWL search: &quot;{topicA}&quot; &times; &quot;{topicB}&quot;
                        </p>
                      </div>
                      <div className="font-mono text-[8px] text-stone-400 space-y-0.5">
                        <p>Querying public records...</p>
                        <p>Cross-referencing subjects...</p>
                        <p>Compiling dossier...</p>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Transcript entries */}
              {displayTranscript.length > 0 && (
                <div className="space-y-5 relative z-10">
                  {displayTranscript.map((msg, i) => {
                    const parts = showDecrypted ? [msg] : addRedactions(msg);
                    return (
                      <motion.div key={`${showDecrypted ? "d" : "r"}-${i}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
                        <div className="intel-entry">
                          {i === 0 && (
                            <div className="flex items-center gap-2 mb-2">
                              <span className="font-mono text-[7px] text-stone-500 tracking-[0.2em]">BROADCAST START</span>
                              <div className="h-px flex-1 bg-stone-400/30" />
                              <span className="font-mono text-[7px] text-stone-400" suppressHydrationWarning>
                                {clientTime || "DATE: — 202X // —:—"}
                              </span>
                            </div>
                          )}
                          <p className="text-[14px] text-stone-800 leading-[1.8] font-body">
                            {parts.map((part, j) =>
                              typeof part === "string" ? (
                                <span key={j}>{part} </span>
                              ) : (
                                <span key={j} className="redacted">{part.redacted}</span>
                              )
                            )}
                          </p>
                        </div>
                      </motion.div>
                    );
                  })}

                  {/* Active indicator */}
                  {(phase === "generating" || phase === "broadcasting") && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                      className="flex items-center gap-2 pl-3.5 pt-1">
                      <div className="flex gap-[2px]">
                        {[...Array(6)].map((_, i) => (
                          <motion.div key={i} className="w-[2px] rounded-full bg-stone-500/60"
                            animate={{ height: [2, 10 + Math.random() * 6, 2] }}
                            transition={{ duration: 0.35 + Math.random() * 0.3, repeat: Infinity, delay: i * 0.05, ease: "easeInOut" }}
                          />
                        ))}
                      </div>
                      <span className="typewriter-cursor font-mono text-[8px] text-stone-400 tracking-wider" />
                    </motion.div>
                  )}
                </div>
              )}

              {/* Generating but no text yet */}
              {phase === "generating" && transcript.length === 0 && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="h-full flex items-center justify-center relative z-10">
                  <div className="text-center space-y-3">
                    <p className="font-display text-sm text-stone-500 animate-pulse">Generating intel report...</p>
                    <p className="font-mono text-[8px] text-stone-400/50">OPENAI GPT-4o // PROCESSING DOSSIER</p>
                  </div>
                </motion.div>
              )}

              {/* Manual play button (fallback if autoplay blocked) */}
              {audioBlobUrl && !isPlaying && (
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                  className="flex flex-col items-center gap-3 py-6 relative z-10">
                  <button onClick={() => playAudioManual(audioBlobUrl)}
                    className="ops-button px-8 py-3 text-sm animate-pulse" style={{ background: "rgba(74, 106, 26, 0.3)", borderColor: "var(--color-phosphor-dim)" }}>
                    <span className="ops-button-led ops-button-led-green" />
                    ▶ START BROADCAST
                  </button>
                  <span className="font-mono text-[9px] text-stone-500">Audio ready — click to begin transmission</span>
                </motion.div>
              )}

              {/* Broadcasting — waiting for TTS */}
              {phase === "broadcasting" && !isPlaying && !audioBlobUrl && transcript.length > 0 && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="flex items-center gap-2 pl-3.5 pt-3 relative z-10">
                  <span className="font-mono text-[8px] text-stone-500 animate-pulse tracking-wider">BUFFERING AUDIO STREAM...</span>
                </motion.div>
              )}
            </div>
          </div>

          {/* ─── RIGHT: OPERATIONS PANEL ─── */}
          <div className="w-[220px] flex-shrink-0 flex flex-col border-l border-border bg-dark">
            <div className="px-4 py-2 border-b border-border">
              <h2 className="font-display text-[10px] tracking-[0.2em] text-dim/60 uppercase">Operations</h2>
            </div>
            <div className="flex-1 p-3 space-y-2">
              {phase === "input" ? (
                <button onClick={handleConnect} disabled={!topicA.trim() || !topicB.trim()}
                  className="ops-button w-full">
                  <span className="ops-button-led ops-button-led-green" />
                  Connect the Dots
                </button>
              ) : phase === "done" ? (
                <button onClick={handleReset} className="ops-button w-full">
                  <span className="ops-button-led ops-button-led-green" />
                  New Investigation
                </button>
              ) : (phase === "broadcasting" || phase === "generating") ? (
                <button onClick={handleStop} className="ops-button ops-button-danger w-full">
                  <span className="ops-button-led ops-button-led-red" />
                  Cut Signal
                </button>
              ) : (
                <div className="ops-button w-full opacity-60 cursor-wait">
                  <span className="ops-button-led ops-button-led-yellow" />
                  Scanning...
                </div>
              )}
              <button
                onClick={handleDecryptLogs}
                disabled={transcript.length === 0}
                className="ops-button w-full"
              >
                {showDecrypted ? "Re-Redact Logs" : "Decrypt Logs"}
              </button>
              <button
                onClick={handleArchiveEvidence}
                disabled={transcript.length === 0 && citedSources.length === 0}
                className="ops-button w-full"
              >
                Archive Evidence
              </button>
            </div>

            {/* Stats panel */}
            <div className="p-3 border-t border-border space-y-2.5">
              <div className="font-mono text-[7px] text-muted/30 tracking-[0.2em] mb-1">TELEMETRY</div>
              <div className="flex justify-between items-center">
                <span className="font-mono text-[8px] text-muted/50 tracking-wider">SOURCES</span>
                <span className="font-mono text-[9px] text-phosphor-dim font-medium">{citedSources.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="font-mono text-[8px] text-muted/50 tracking-wider">STATUS</span>
                <span className={`font-mono text-[9px] tracking-wider font-medium ${
                  phase === "broadcasting" || isPlaying ? "text-phosphor-bright" :
                  phase === "generating" ? "text-yellow-500" :
                  phase === "researching" ? "text-yellow-500" :
                  phase === "done" ? "text-dim/50" :
                  "text-muted/40"
                }`}>
                  {isPlaying ? "ACTIVE" :
                   phase === "broadcasting" ? "BUFFERING" :
                   phase === "generating" ? "GENERATING" :
                   phase === "researching" ? "SCAN" :
                   phase === "done" ? "COMPLETE" :
                   "IDLE"}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="font-mono text-[8px] text-muted/50 tracking-wider">FEED</span>
                <span className="font-mono text-[9px] text-dim/50">{transcript.length} entries</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="font-mono text-[8px] text-muted/50 tracking-wider">AUDIO</span>
                <span className={`font-mono text-[9px] tracking-wider ${isPlaying ? "text-phosphor-bright" : "text-muted/30"}`}>
                  {isPlaying ? "TX" : "—"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ═══ FOOTER ═══ */}
        <footer className="flex-shrink-0 px-5 py-1.5 bg-dark/90 border-t border-border flex items-center justify-between">
          <span className="font-mono text-[7px] text-muted/20 tracking-[0.2em]">TINFOIL v0.2 // UNCLASSIFIED</span>
          <span className="font-mono text-[7px] text-muted/20 tracking-[0.2em]">FIRECRAWL + OPENAI + ELEVENLABS // #ELEVENHACKS 2026</span>
        </footer>
      </div>
    </div>
  );
}
