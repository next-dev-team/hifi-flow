import type { Track } from "@/components/track-item";
import { podcaseWeAnd } from "@/utils/podcase";

export type PodcastTabKey = "weand";

export type PodcastEpisode = {
  id: number;
  cover?: string;
  title: string;
  author?: string;
  detail?: string;
  audioUrl: string;
  manuScript?: unknown;
  quotations?: string;
};

export type PodcastPage = {
  items: Track[];
  nextCursor: number | null;
  total: number;
};

const DEFAULT_LIMIT = 20;

function toPodcastTrack(episode: PodcastEpisode): Track {
  return {
    id: `podcast:weand:${episode.id}`,
    title: episode.title,
    artist: episode.author || "WeAnd",
    artwork: episode.cover,
    url: episode.audioUrl,
  };
}

function getWeAndData(): PodcastEpisode[] {
  return podcaseWeAnd as unknown as PodcastEpisode[];
}

function parseNumber(value: unknown, fallback: number): number {
  const n = typeof value === "string" ? Number(value) : (value as number);
  return Number.isFinite(n) ? n : fallback;
}

function buildWeAndPage(params: {
  cursor?: unknown;
  limit?: unknown;
}): PodcastPage {
  const all = getWeAndData();
  const cursor = Math.max(0, parseNumber(params.cursor, 0));
  const limit = Math.max(
    1,
    Math.min(50, parseNumber(params.limit, DEFAULT_LIMIT))
  );

  const slice = all.slice(cursor, cursor + limit);
  const items = slice.map(toPodcastTrack);
  const nextCursor = cursor + limit < all.length ? cursor + limit : null;

  return { items, nextCursor, total: all.length };
}

export async function getWeAndPodcastsPage(options?: {
  cursor?: number;
  limit?: number;
  signal?: AbortSignal;
}): Promise<PodcastPage> {
  if (options?.signal?.aborted) {
    throw new Error("Aborted");
  }

  return buildWeAndPage({
    cursor: options?.cursor ?? 0,
    limit: options?.limit ?? DEFAULT_LIMIT,
  });
}
