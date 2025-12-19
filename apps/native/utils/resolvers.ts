export const resolveName = (value?: { name?: string } | string) => {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  return value.name;
};

export const resolveArtwork = (item: any): string | undefined => {
  if (!item) return undefined;

  // Handle case where item might be a string (the URL itself)
  if (typeof item === "string") return item;

  // 1. Try common direct URL fields
  const directUrl =
    item.image ||
    item.picture ||
    item.avatar ||
    item.profile ||
    item.cover ||
    item.artworkUrl ||
    item.artwork;
  if (typeof directUrl === "string" && directUrl.startsWith("http"))
    return directUrl;

  // 2. Try thumbnail object
  if (item.thumbnail?.url) return item.thumbnail.url;
  if (item.thumbnail && typeof item.thumbnail === "string")
    return item.thumbnail;

  // 3. Try thumbnails array
  if (Array.isArray(item.thumbnails) && item.thumbnails.length > 0) {
    // Try to find the largest/best quality one if they have dimensions
    const best = [...item.thumbnails].sort((a, b) => {
      const aSize = (a.width || 0) * (a.height || 0);
      const bSize = (b.width || 0) * (b.height || 0);
      return bSize - aSize;
    })[0];
    return best?.url || item.thumbnails[0]?.url;
  }

  // 4. Handle thumbnails as string
  if (typeof item.thumbnails === "string") return item.thumbnails;

  // 5. Check nested structures (sometimes artists have images inside a 'data' or 'artist' object)
  if (item.data) return resolveArtwork(item.data);
  if (item.artist && typeof item.artist === "object")
    return resolveArtwork(item.artist);
  if (item.author && typeof item.author === "object")
    return resolveArtwork(item.author);

  return undefined;
};
