"use client";

import { motion } from "framer-motion";
import type { Source } from "@/lib/types";

export function SourceCard({ source, index }: { source: Source; index: number }) {
  const domain = (() => {
    try { return new URL(source.url).hostname.replace("www.", ""); }
    catch { return ""; }
  })();

  // Varied rotation for pinned-to-board feel
  const rotations = [-2.5, 1.8, -1.2, 3, -0.8, 2.2, -1.6, 0.5];
  const rotation = rotations[index % rotations.length];

  return (
    <motion.a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      initial={{ opacity: 0, scale: 0.9, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ delay: index * 0.15, duration: 0.4, ease: [0.25, 0.1, 0, 1] }}
      style={{ rotate: rotation }}
      className="block group relative"
    >
      {/* Push pin */}
      <div className="absolute -top-1.5 left-4 z-10">
        <div className="pin" />
      </div>

      {/* Paper card */}
      <div className="paper-card p-3 pt-4 relative overflow-hidden">
        {/* Classification marker */}
        <div className="absolute top-1 right-2 font-display text-[6px] text-stamp/40 tracking-[0.3em]">
          UNCLASSIFIED
        </div>

        {/* Source number & domain */}
        <div className="font-mono text-[7px] text-stone-500/70 tracking-wider mb-1.5 flex items-center gap-2">
          <span>SRC-{String(index + 1).padStart(3, "0")}</span>
          <span className="w-px h-2 bg-stone-400/30" />
          <span className="truncate">{domain}</span>
        </div>

        {/* Title */}
        <h3 className="font-display text-[11px] text-stone-800 leading-snug line-clamp-2 group-hover:text-stone-950 transition-colors">
          {source.title}
        </h3>

        {/* Snippet */}
        {source.snippet && (
          <p className="text-[9px] text-stone-600/80 leading-relaxed line-clamp-3 mt-1.5 font-mono">
            {source.snippet}
          </p>
        )}

        {/* Bottom edge — torn paper effect via gradient */}
        <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-gradient-to-b from-transparent to-stone-400/10" />
      </div>
    </motion.a>
  );
}
