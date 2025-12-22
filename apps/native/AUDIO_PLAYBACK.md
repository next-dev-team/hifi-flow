# Audio Playback Optimization and Background Audio

This document describes the audio playback optimizations and background audio implementation in HiFi Flow.

## Queue Management & Buffer Optimization

### Fast-Start Mode

For the first track in a queue, we use "fast-start" mode which:

1. **Uses LOSSLESS quality initially** instead of HI_RES_LOSSLESS
   - LOSSLESS requires 1 API call (getTrack → extractManifest)
   - HI_RES_LOSSLESS requires 2-3 API calls (getTrack → getDashManifest → parse)
2. **Defers all preloading** until the first track starts playing

   - First track gets 100% of network bandwidth
   - No competing requests during initial load

3. **Preloads subsequent tracks in full quality**
   - After 2 seconds of playback, next tracks are preloaded
   - Preloading uses requested quality (including HI_RES_LOSSLESS)

```typescript
// Fast-start uses LOSSLESS for faster API response
const getFastStartQuality = (requestedQuality: AudioQuality): AudioQuality => {
  if (requestedQuality === "HI_RES_LOSSLESS") {
    return "LOSSLESS";
  }
  return requestedQuality;
};
```

### Stream URL Caching

Stream URLs are cached for 30 minutes to avoid redundant API calls:

```typescript
// Cache structure with 30-minute TTL
const streamUrlCacheRef = useRef<
  Map<string, { url: string; timestamp: number }>
>(new Map());
const STREAM_URL_CACHE_TTL = 30 * 60 * 1000; // 30 minutes
```

### Parallel Preloading

Next tracks are now preloaded in parallel instead of sequentially for faster loading:

```typescript
// Run all preloads in parallel
await Promise.allSettled(preloadPromises);
```

### Aggressive Preloading

Preloading now triggers as soon as there is a current track and queue, not just when playing:

```typescript
useEffect(() => {
  if (currentTrack && queue.length > 0) {
    void preloadNextTracks();
  }
}, [currentTrack, queue, preloadNextTracks]);
```

### Queue URL Prefetching

When a new queue is started, URLs for the first few tracks are prefetched in parallel:

```typescript
const prefetchQueueStreamUrls = useCallback(
  async (tracks: Track[], startIndex: number) => {
    const prefetchIndices = [startIndex, startIndex + 1, startIndex + 2].filter(
      (i) => i >= 0 && i < tracks.length
    );
    await Promise.allSettled(
      prefetchIndices.map((i) => getStreamUrlForTrack(tracks[i], quality))
    );
  },
  [getStreamUrlForTrack, quality]
);
```

## Expected Performance

With these optimizations, users should experience:

- **First track:** ~1-3 seconds to start (depending on network/API response)
- **Subsequent tracks:** Near-instant playback if preloaded
- **Cached tracks:** Immediate URL resolution

## Background Playback

### iOS Configuration

Background audio is enabled via `UIBackgroundModes` in `app.json`:

```json
{
  "ios": {
    "infoPlist": {
      "UIBackgroundModes": ["audio"]
    }
  }
}
```

### Android Configuration

For Android, the following permissions are required:

```json
{
  "android": {
    "permissions": [
      "android.permission.FOREGROUND_SERVICE",
      "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK"
    ]
  }
}
```

### Media Session Service

The `media-session.ts` utility provides lock screen and notification controls on supported platforms:

**Features:**

- Web: Uses Media Session API for browser media controls
- Future: Can be extended for native platforms

**Supported Actions:**

- Play/Pause
- Next/Previous track
- Seek forward/backward
- Seek to position

## Full Native Background Playback (Optional)

For the most robust background playback experience with native lock screen controls and notification bar, consider migrating to `react-native-track-player`:

### Installation

```bash
npx expo install react-native-track-player
```

### Key Benefits

1. **Lock Screen Controls:** Native media controls on both iOS and Android lock screens
2. **Notification Bar:** Persistent media notification with controls
3. **Background Playback:** Robust background audio that works even when app is backgrounded
4. **Remote Controls:** Support for headphone buttons and car Bluetooth
5. **Buffer Management:** Built-in buffering and caching

### Migration Considerations

If migrating to `react-native-track-player`:

1. Replace `expo-audio` player creation with Track Player queue management
2. Update playback controls to use Track Player events
3. Configure notification appearance
4. Set up remote controls/capabilities

### Example Setup

```typescript
import TrackPlayer, { Capability, Event } from "react-native-track-player";

// Initialize player
await TrackPlayer.setupPlayer({});

// Set capabilities
await TrackPlayer.updateOptions({
  capabilities: [
    Capability.Play,
    Capability.Pause,
    Capability.SkipToNext,
    Capability.SkipToPrevious,
    Capability.SeekTo,
  ],
  compactCapabilities: [
    Capability.Play,
    Capability.Pause,
    Capability.SkipToNext,
  ],
  notificationCapabilities: [
    Capability.Play,
    Capability.Pause,
    Capability.SkipToNext,
    Capability.SkipToPrevious,
  ],
});

// Add tracks
await TrackPlayer.add([
  {
    id: "1",
    url: streamUrl,
    title: "Track Title",
    artist: "Artist Name",
    artwork: artworkUrl,
  },
]);

// Control playback
await TrackPlayer.play();
await TrackPlayer.pause();
await TrackPlayer.skipToNext();
```

## Web Platform

On web, the Media Session API provides browser-level media controls:

- Chrome/Edge: Media controls in browser toolbar
- macOS: Now Playing widget and Touch Bar
- Windows: Media keys and notification area

The current implementation automatically uses Media Session API when available.

## Troubleshooting

### Audio stops when app is backgrounded (iOS)

1. Verify `UIBackgroundModes` contains `audio`
2. Run a production build (not Expo Go)
3. Check audio session category is set correctly

### Audio stops when app is backgrounded (Android)

1. Verify foreground service permissions are granted
2. Check for battery optimization exclusions
3. Consider using `react-native-track-player` for reliable background playback

### Slow initial playback

1. Check network connectivity
2. API response times may vary by region
3. Lower quality setting will generally load faster
