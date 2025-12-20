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

  // Handle case where item might be a string (the URL itself)
  if (typeof item === "string") return item;

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

  if (typeof directUrl === "string") {
    if (directUrl.startsWith("http")) return directUrl;

    // 2. If it looks like a Tidal UUID (contains dashes and is about 36 chars), use losslessAPI
    if (
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        directUrl
      )
    ) {
      // Check if it's likely a picture or cover based on field name or item type
      const isArtist =
        item.type === "artist" || !!item.subscribers || !!item.artistTypes;
      if (isArtist) {
        return losslessAPI.getArtistPictureUrl(directUrl);
      }
      return losslessAPI.getCoverUrl(directUrl, size);
    }
  }

  // 3. Try thumbnail object
  if (item.thumbnail?.url) return item.thumbnail.url;
  if (item.thumbnail && typeof item.thumbnail === "string")
    return item.thumbnail;

  // 4. Try thumbnails array
  if (Array.isArray(item.thumbnails) && item.thumbnails.length > 0) {
    // Try to find the largest/best quality one if they have dimensions
    const best = [...item.thumbnails].sort((a, b) => {
      const aSize = (a.width || 0) * (a.height || 0);
      const bSize = (b.width || 0) * (b.height || 0);
      return bSize - aSize;
    })[0];
    return best?.url || item.thumbnails[0]?.url;
  }

  // 5. Handle thumbnails as string
  if (typeof item.thumbnails === "string") return item.thumbnails;

  // 6. Check nested structures (sometimes artists have images inside a 'data' or 'artist' object)
  if (item.data) return resolveArtwork(item.data, size);
  if (item.artist && typeof item.artist === "object")
    return resolveArtwork(item.artist, size);
  if (item.author && typeof item.author === "object")
    return resolveArtwork(item.author, size);
  if (item.album && typeof item.album === "object")
    return resolveArtwork(item.album, size);

  return undefined;
};
