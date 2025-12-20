import { losslessAPI } from "./api";

export const resolveName = (value?: { name?: string } | string) => {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  return value.name;
};

export const resolveArtwork = (
  item: any,
  size: "1280" | "640" | "320" | "160" | "80" = "640"
): string | undefined => {
  if (!item) return undefined;

  const normalizeString = (value: unknown): string | undefined => {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  };

  const resolveTidalImageId = (id: string, kind: "cover" | "picture") => {
    if (kind === "picture") return losslessAPI.getArtistPictureUrl(id);
    return losslessAPI.getCoverUrl(id, size);
  };

  const looksLikeTidalId = (value: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    );

  // Handle case where item might be a string (the URL itself)
  if (typeof item === "string") {
    const candidate = normalizeString(item);
    if (!candidate) return undefined;
    if (candidate.startsWith("http")) return candidate;
    if (looksLikeTidalId(candidate))
      return resolveTidalImageId(candidate, "cover");
    return candidate;
  }

  // 1. Try common direct URL fields
  const directUrl =
    item.image ||
    item.picture_url || // Some APIs use picture_url
    item.avatar_url ||
    item.picture ||
    item.avatar ||
    item.profile ||
    item.cover ||
    item.artworkUrl ||
    item.artwork;

  const directCandidate = normalizeString(directUrl);
  if (directCandidate) {
    if (directCandidate.startsWith("http")) return directCandidate;

    // 2. If it looks like a Tidal UUID (contains dashes and is about 36 chars), use losslessAPI
    if (looksLikeTidalId(directCandidate)) {
      const isPictureSource =
        typeof item.picture === "string" ||
        typeof item.picture_url === "string" ||
        typeof item.avatar === "string" ||
        typeof item.avatar_url === "string" ||
        typeof item.profile === "string";
      return resolveTidalImageId(
        directCandidate,
        isPictureSource ? "picture" : "cover"
      );
    }
  }

  // 3. Try thumbnail object
  const thumbnailUrl = normalizeString(item.thumbnail?.url);
  if (thumbnailUrl) return thumbnailUrl;
  const thumbnailString = normalizeString(item.thumbnail);
  if (thumbnailString) return thumbnailString;

  // 4. Try thumbnails array
  if (Array.isArray(item.thumbnails) && item.thumbnails.length > 0) {
    // Try to find the largest/best quality one if they have dimensions
    const best = [...item.thumbnails].sort((a, b) => {
      const aSize = (a.width || 0) * (a.height || 0);
      const bSize = (b.width || 0) * (b.height || 0);
      return bSize - aSize;
    })[0];
    const bestUrl = normalizeString(best?.url);
    if (bestUrl) return bestUrl;
    const firstUrl = normalizeString(item.thumbnails[0]?.url);
    if (firstUrl) return firstUrl;
  }

  // 5. Handle thumbnails as string
  const thumbnailsString = normalizeString(item.thumbnails);
  if (thumbnailsString) return thumbnailsString;

  // 6. Check nested structures (sometimes artists have images inside a 'data' or 'artist' object)
  const nestedCandidates = [
    item.album,
    item.data,
    item.item,
    item.track,
    item.artist,
    item.author,
  ];

  for (const candidate of nestedCandidates) {
    if (!candidate) continue;
    const resolved = resolveArtwork(candidate, size);
    if (resolved) return resolved;
  }

  return undefined;
};
