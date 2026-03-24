export interface Source {
  title: string;
  url: string;
  snippet: string;
}

export interface ResearchResult {
  topicA: string;
  topicB: string;
  sources: Source[];
  brief: string; // compiled research brief for the agent
}

export interface ConspiracyState {
  phase: "input" | "researching" | "generating" | "broadcasting" | "done";
  topicA: string;
  topicB: string;
  research: ResearchResult | null;
  citedSources: Source[];
  transcript: string[];
}
