import * as SecureStore from "expo-secure-store";
import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

/**
 * A hook to persist state to local storage (web) or SecureStore (native).
 *
 * @param key The unique key for storage.
 * @param initialValue The initial value if no data is found in storage.
 * @returns [state, setState, isLoaded]
 */
export function usePersistentState<T>(key: string, initialValue: T) {
  const [state, setState] = useState<T>(initialValue);
  const [isLoaded, setIsLoaded] = useState(false);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    async function load() {
      try {
        let value: string | null = null;
        if (Platform.OS === "web") {
          value = localStorage.getItem(key);
        } else {
          value = await SecureStore.getItemAsync(key);
        }

        if (value !== null && isMounted.current) {
          try {
            setState(JSON.parse(value));
          } catch (parseError) {
            console.warn(
              `Failed to parse persistent state for key "${key}"`,
              parseError
            );
            // If parse fails, we keep the initial value
          }
        }
      } catch (e) {
        console.warn(`Failed to load persistent state for key "${key}"`, e);
      } finally {
        if (isMounted.current) {
          setIsLoaded(true);
        }
      }
    }
    load();

    return () => {
      isMounted.current = false;
    };
  }, [key]);

  // Sync state to storage whenever it changes (after initial load)
  useEffect(() => {
    if (!isLoaded) return;

    const save = async () => {
      try {
        const stringValue = JSON.stringify(state);
        if (Platform.OS === "web") {
          localStorage.setItem(key, stringValue);
        } else {
          await SecureStore.setItemAsync(key, stringValue);
        }
      } catch (e) {
        console.warn(`Failed to save persistent state for key "${key}"`, e);
      }
    };
    void save();
  }, [key, state, isLoaded]);

  return [state, setState, isLoaded] as const;
}
