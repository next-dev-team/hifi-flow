import { useInfiniteQuery } from "@tanstack/react-query";
import { getWeAndPodcastsPage } from "@/utils/podcast-api";

const DEFAULT_LIMIT = 20;

export function usePodcastWeAnd(options?: { limit?: number }) {
  const limit = options?.limit ?? DEFAULT_LIMIT;

  const query = useInfiniteQuery({
    queryKey: ["podcasts", "weand", { limit }],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      getWeAndPodcastsPage({ cursor: pageParam, limit, signal }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const episodes = query.data?.pages.flatMap((p) => p.items) ?? [];
  const total = query.data?.pages[0]?.total ?? null;

  return { ...query, episodes, total };
}

