type PlaybackStateResult = { state?: unknown };

const TrackPlayer = {} as unknown;

const usePlaybackState = (): PlaybackStateResult => ({ state: undefined });

const useProgress = (_intervalMs?: number) => ({
  position: 0,
  buffered: 0,
  duration: 0,
});

const useTrackPlayerEvents = (
  _events: unknown[],
  _handler: (event: unknown) => void
) => {
  return;
};

const Capability = {} as unknown;
const Event = {} as unknown;
const RepeatMode = {} as unknown;
const State = {} as unknown;
const AppKilledPlaybackBehavior = {} as unknown;

export default TrackPlayer;
export {
  AppKilledPlaybackBehavior,
  Capability,
  Event,
  RepeatMode,
  State,
  usePlaybackState,
  useProgress,
  useTrackPlayerEvents,
};
