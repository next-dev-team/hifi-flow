import TrackPlayer, { Event } from "react-native-track-player";

export const playbackService = async () => {
  TrackPlayer.addEventListener(Event.RemotePlay, () => TrackPlayer.play());
  TrackPlayer.addEventListener(Event.RemotePause, () => TrackPlayer.pause());
  TrackPlayer.addEventListener(Event.RemoteStop, () => TrackPlayer.stop());
  TrackPlayer.addEventListener(Event.RemoteNext, () => TrackPlayer.skipToNext());
  TrackPlayer.addEventListener(Event.RemotePrevious, () => TrackPlayer.skipToPrevious());
  TrackPlayer.addEventListener(Event.RemoteSeek, (event) => {
    const position = (event as { position?: unknown }).position;
    if (typeof position === "number") {
      void TrackPlayer.seekTo(position);
    }
  });

  TrackPlayer.addEventListener(Event.RemoteJumpForward, (event) => {
    const interval = (event as { interval?: unknown }).interval;
    if (typeof interval === "number") {
      void TrackPlayer.seekBy(interval);
    }
  });

  TrackPlayer.addEventListener(Event.RemoteJumpBackward, (event) => {
    const interval = (event as { interval?: unknown }).interval;
    if (typeof interval === "number") {
      void TrackPlayer.seekBy(-interval);
    }
  });

  TrackPlayer.addEventListener(Event.RemoteDuck, async (event) => {
    const payload = event as { paused?: unknown; permanent?: unknown };
    if (payload.paused === true) {
      await TrackPlayer.pause();
      return;
    }
    if (payload.permanent === true) {
      await TrackPlayer.stop();
      return;
    }
    await TrackPlayer.play();
  });
};
