# Audio Playback - Single Player Architecture

This document describes the audio playback system in HiFi Flow, designed for instant playback and robust queue management.

## Core Principles

### 1. Single Player Pattern

**ONLY ONE audio player can exist at any time.** This prevents:

- Concurrent audio playback (multiple tracks playing simultaneously)
- Resource leaks from orphaned players
- Race conditions during track transitions

```typescript
// Before creating any new player, ALL existing players are destroyed
const destroyAllPlayers = useCallback(() => {
  if (activePlayerRef.current) {
    activePlayerRef.current.remove();
    activePlayerRef.current = null;
  }
  if (preBufferedPlayerRef.current) {
    preBufferedPlayerRef.current.player.remove();
    preBufferedPlayerRef.current = null;
  }
}, []);
```

### 2. Mutex Lock for Playback Operations

A `playLockRef` prevents concurrent play operations:

```typescript
if (playLockRef.current) {
  console.log("[Player] Play operation already in progress, skipping");
  return false;
}
playLockRef.current = true;
try {
  // ... playback logic
} finally {
  playLockRef.current = false;
}
```

### 3. Instant First Click

The first track clicked starts playing immediately with no delay. The system uses:

- LOSSLESS quality for faster initial load (instead of HI_RES_LOSSLESS which requires more API calls)
- No pre-buffering until first track is playing

### 4. Smart Pre-buffering

After the first track starts playing (2 second delay), the system:

- Pre-buffers the next track in queue
- Shows visual indicator (pulsing orange = buffering, green checkmark = ready)
- Enables instant playback when user clicks "next"

## Pre-buffer Status States

| Status      | Visual             | Meaning                                  |
| ----------- | ------------------ | ---------------------------------------- |
| `none`      | No indicator       | No pre-buffering in progress             |
| `buffering` | 🟠 Pulsing orange  | Currently buffering next track           |
| `ready`     | ✅ Green checkmark | Next track ready for instant play        |
| `failed`    | No indicator       | Pre-buffer failed (will fetch on demand) |

## Error Recovery

### Automatic Skip on Failure

If a track fails to play, the system automatically skips to the next track:

```typescript
if (!success) {
  consecutiveFailuresRef.current++;
  if (consecutiveFailuresRef.current >= MAX_CONSECUTIVE_FAILURES) {
    showToast({
      message: "Too many playback errors, stopping.",
      type: "error",
    });
    return;
  }
  showToast({ message: "Playback failed, skipping...", type: "info" });
  await playNext();
}
```

### Consecutive Failure Protection

To prevent infinite loops when all tracks are unavailable:

- Maximum 5 consecutive failures allowed
- After 5 failures, playback stops with user notification
- Counter resets on successful playback

## Stream URL Caching

URLs are cached for 30 minutes to avoid redundant API calls:

```typescript
const streamUrlCacheRef = useRef<
  Map<string, { url: string; timestamp: number }>
>(new Map());
const STREAM_URL_CACHE_TTL = 30 * 60 * 1000; // 30 minutes
```

## Audio Content Caching (Web Only)

For the Web platform, an IndexedDB-based caching layer is implemented to optimize repeated playback of the same tracks.

### Mechanism

1. **Resolution**: When a track is about to be played (or pre-buffered), the `audioCacheService` checks if the audio file is fully cached in IndexedDB.
2. **Hit**: If cached, a `blob:` URL is created from the cached data and returned. This allows for instant playback without network requests.
3. **Miss**: If not cached, the original remote URL is returned for immediate playback.
4. **Background Caching**: If a cache miss occurs, a background process is triggered to download the audio file in chunks and store it in IndexedDB for future use.

This logic is handled in `utils/audio-cache.web.ts` (active implementation) and `utils/audio-cache.ts` (no-op for native).

## Playback Flow

### First Track Click

1. User clicks track
2. `playLockRef` acquired
3. All existing players destroyed
4. Stream URL fetched (LOSSLESS quality for speed)
5. New player created and starts playing
6. `playLockRef` released
7. After 2 seconds: pre-buffer next track

### Next Track (with pre-buffer ready)

1. User clicks next / track finishes
2. `playLockRef` acquired
3. Check if pre-buffered player exists for next track
4. If yes: promote pre-buffered player to active (instant!)
5. If no: destroy all, fetch URL, create new player
6. `playLockRef` released
7. Pre-buffer next-next track

### Track Switch (click different track)

1. User clicks different track
2. `playLockRef` acquired
3. ALL players destroyed (including pre-buffered)
4. New player created for clicked track
5. `playLockRef` released
6. Pre-buffer next track after 2 seconds

## Background Playback

### iOS Configuration

Background audio enabled via `UIBackgroundModes` in `app.json`:

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

Required permissions:

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

## Media Session Integration

The `media-session.ts` utility provides lock screen and notification controls:

- Play/Pause
- Next/Previous track
- Seek forward/backward
- Seek to position

## Expected Performance

| Scenario                      | Expected Latency                |
| ----------------------------- | ------------------------------- |
| First track click             | 1-3 seconds (network dependent) |
| Next track (pre-buffered)     | < 100ms (instant)               |
| Next track (not pre-buffered) | 1-3 seconds                     |
| Cached URL resolution         | Immediate                       |

## Troubleshooting

### Audio plays multiple tracks simultaneously

This should not happen with the single-player architecture. If it does:

1. Check that `destroyAllPlayers()` is being called
2. Verify `playLockRef` is working (no concurrent operations)
3. Check console for "[Player]" prefixed logs

### Audio gets stuck / won't play

1. Check for consecutive failures (max 5)
2. Verify network connectivity
3. Check if track URL is valid
4. Look for player creation errors in console

### Pre-buffer not working

1. Ensure queue has more than 1 track
2. Wait 2 seconds after first track starts
3. Check `nextTrackBufferStatus` in React DevTools
4. Look for "[PreBuffer]" prefixed logs
