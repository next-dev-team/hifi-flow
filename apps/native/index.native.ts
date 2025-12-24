import TrackPlayer from "react-native-track-player";
import { playbackService } from "./track-player-service";

TrackPlayer.registerPlaybackService(() => playbackService);

import "expo-router/entry";

