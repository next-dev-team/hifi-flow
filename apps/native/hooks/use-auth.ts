import { usePersistentState } from "./use-persistent-state";
import { verifyPodcastPassword } from "@/utils/auth";

export function usePodcastAuth() {
  const [isUnlocked, setIsUnlocked, isLoaded] = usePersistentState<boolean>(
    "podcast_unlocked",
    false
  );

  const unlock = (password: string): boolean => {
    if (verifyPodcastPassword(password)) {
      setIsUnlocked(true);
      return true;
    }
    return false;
  };

  const lock = () => {
    setIsUnlocked(false);
  };

  return {
    isUnlocked,
    isLoaded,
    unlock,
    lock,
  };
}
