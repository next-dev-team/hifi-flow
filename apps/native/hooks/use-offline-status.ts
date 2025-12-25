import { useState, useEffect } from "react";
import * as Network from "expo-network";

export function useOfflineStatus() {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    // Initial check
    Network.getNetworkStateAsync().then((state) => {
      setIsOffline(state.isConnected === false);
    });

    // Currently expo-network doesn't have a listener for web?
    // We can fallback to window events on web
    if (typeof window !== "undefined") {
      const handleOnline = () => setIsOffline(false);
      const handleOffline = () => setIsOffline(true);

      window.addEventListener("online", handleOnline);
      window.addEventListener("offline", handleOffline);

      // Check navigator.onLine as well
      if (navigator.onLine === false) {
        setIsOffline(true);
      }

      return () => {
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("offline", handleOffline);
      };
    }
  }, []);

  return isOffline;
}
