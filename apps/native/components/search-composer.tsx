import { Ionicons } from "@expo/vector-icons";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import { useThemeColor } from "heroui-native";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { withUniwind } from "uniwind";
import { useToast } from "@/contexts/toast-context";
import { fetchRelatedKeywords } from "../utils/ai";
import { ThinkingDots } from "./thinking-dots";

const StyledView = withUniwind(View);
const StyledScrollView = withUniwind(ScrollView);
const StyledTextInput = withUniwind(TextInput);
const StyledText = withUniwind(Text);

interface SearchComposerProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  className?: string;
  multiline?: boolean;
}

interface LanguageOption {
  label: string;
  value: string;
}

const LANGUAGES: LanguageOption[] = [
  { label: "EN", value: "en-US" },
  { label: "KH", value: "km-KH" },
];

/**
 * A highly styled search input component matching the "Message Copilot" UI.
 * Features nested borders, soft shadows, and integrated voice search with language support.
 */
export function SearchComposer({
  value,
  onChangeText,
  placeholder = "Search songs, artists, albums",
  className = "",
  multiline = false,
}: SearchComposerProps) {
  const themeColorMuted = useThemeColor("muted");
  const { showToast } = useToast();
  const voiceSearchOwnerRef = useRef(false);
  const [isListening, setIsListening] = useState(false);
  const [selectedLang, setSelectedLang] = useState(LANGUAGES[0]);
  const selectedLangRef = useRef(selectedLang);
  selectedLangRef.current = selectedLang;

  const [status, setStatus] = useState<"idle" | "listening" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [relatedKeywords, setRelatedKeywords] = useState<string[]>([]);
  const [isLoadingKeywords, setIsLoadingKeywords] = useState(false);
  const keywordsRequestIdRef = useRef(0);
  const keywordsAbortRef = useRef<AbortController | null>(null);

  // Fetch related keywords when value changes (debounced-ish)
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (value.trim().length >= 2) {
        keywordsAbortRef.current?.abort();
        const controller = new AbortController();
        keywordsAbortRef.current = controller;
        keywordsRequestIdRef.current += 1;
        const requestId = keywordsRequestIdRef.current;
        setIsLoadingKeywords(true);
        try {
          const keywords = await fetchRelatedKeywords(value, {
            signal: controller.signal,
          });
          if (keywordsRequestIdRef.current === requestId) {
            setRelatedKeywords(keywords);
          }
        } catch (e) {
          const error = e as any;
          const isAbort =
            error?.name === "AbortError" ||
            error?.message?.includes?.("aborted") ||
            error?.message?.includes?.("AbortError");
          if (!isAbort) {
            console.error("Failed to fetch keywords:", e);
          }
        } finally {
          if (keywordsRequestIdRef.current === requestId) {
            setIsLoadingKeywords(false);
          }
        }
      } else {
        setRelatedKeywords([]);
        setIsLoadingKeywords(false);
      }
    }, 800);

    return () => {
      clearTimeout(timer);
      keywordsAbortRef.current?.abort();
    };
  }, [value]);

  // Auto-stop timer
  const silenceTimerRef = useRef<any>(null);
  const SILENCE_DEBOUNCE_MS = 2000; // 2 seconds of silence to auto-stop

  const stopRecording = useCallback(() => {
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch (e) {
      // Ignore if already stopped
    }
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  // Toggle Language
  const toggleLanguage = useCallback(() => {
    const currentIndex = LANGUAGES.findIndex(
      (l) => l.value === selectedLang.value
    );
    const nextIndex = (currentIndex + 1) % LANGUAGES.length;
    setSelectedLang(LANGUAGES[nextIndex]);
  }, [selectedLang]);

  // Voice Search Event Listeners
  useSpeechRecognitionEvent("start", () => {
    if (!voiceSearchOwnerRef.current) return;
    setIsListening(true);
    setStatus("listening");
    setErrorMessage(null);
  });

  useSpeechRecognitionEvent("end", () => {
    if (!voiceSearchOwnerRef.current) return;
    setIsListening(false);
    setStatus((prev) => (prev === "error" ? "error" : "idle"));
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    voiceSearchOwnerRef.current = false;
  });

  useSpeechRecognitionEvent("result", (event) => {
    if (!voiceSearchOwnerRef.current) return;
    const transcript = event.results.map((r) => r.transcript).join(" ");
    if (transcript) {
      onChangeText(transcript);

      // Reset silence timer on every new result
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
      }

      silenceTimerRef.current = setTimeout(() => {
        stopRecording();
      }, SILENCE_DEBOUNCE_MS);
    }
  });

  useSpeechRecognitionEvent("error", (event) => {
    if (!voiceSearchOwnerRef.current) return;
    console.error("Speech recognition error:", event.error, event.message);
    setIsListening(false);
    setStatus("error");
    voiceSearchOwnerRef.current = false;

    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    let msg = event.message || event.error || "Error";

    // Better error messages for Web/General
    if (event.error === "network") {
      msg = Platform.OS === "web" ? "Network/Browser Error" : "Network Error";
    } else if (
      event.error === "not-allowed" ||
      event.error === "service-not-allowed"
    ) {
      msg = "Permission Denied";
    } else if (event.error === "no-speech") {
      msg = "No speech detected";
    }

    setErrorMessage(msg);
    showToast({
      message: msg,
      type: "error",
    });

    setTimeout(() => {
      setStatus("idle");
      setErrorMessage(null);
    }, 3000);
  });

  const handleVoiceSearch = useCallback(async () => {
    if (isListening) {
      stopRecording();
      return;
    }

    // Check availability first (especially for Web)
    const isAvailable =
      await ExpoSpeechRecognitionModule.isRecognitionAvailable();
    if (!isAvailable) {
      setStatus("error");
      setErrorMessage(
        Platform.OS === "web"
          ? "Not supported in this browser"
          : "Speech unavailable"
      );
      setTimeout(() => {
        setStatus("idle");
        setErrorMessage(null);
      }, 3000);
      return;
    }

    const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!result.granted) {
      setStatus("error");
      setErrorMessage("Permissions needed");
      setTimeout(() => {
        setStatus("idle");
        setErrorMessage(null);
      }, 3000);
      return;
    }

    try {
      setStatus("listening");
      voiceSearchOwnerRef.current = true;
      ExpoSpeechRecognitionModule.start({
        lang: selectedLangRef.current.value,
        interimResults: true,
        continuous: true,
        androidIntentOptions: {
          EXTRA_LANGUAGE_MODEL: "web_search",
        },
      });
    } catch (e) {
      setIsListening(false);
      setStatus("error");
      setErrorMessage("Failed to start");
      voiceSearchOwnerRef.current = false;
      setTimeout(() => {
        setStatus("idle");
        setErrorMessage(null);
      }, 3000);
    }
  }, [isListening, stopRecording]);

  return (
    <StyledView className={`relative ${className}`}>
      <StyledView className="relative max-h-full w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 p-1 rounded-2xl shadow-sm">
        <StyledView className="bg-white/60 dark:bg-black/20 rounded-xl">
          <StyledView className="relative flex-col overflow-hidden w-auto rounded-xl">
            <StyledView className="flex-row items-center min-h-[42px] w-auto px-3">
              <StyledView className="justify-center mr-2">
                <Ionicons
                  name="search"
                  size={18}
                  color={themeColorMuted}
                  className="opacity-50"
                />
              </StyledView>
              <StyledView className="flex-1 justify-center">
                <StyledTextInput
                  className="w-full bg-transparent text-foreground text-[14px] py-1.5 font-medium"
                  style={
                    {
                      minHeight: 42,
                      textAlignVertical: "center",
                      includeFontPadding: false,
                    } as any
                  }
                  placeholder={
                    status === "listening"
                      ? "Listening..."
                      : status === "error"
                      ? errorMessage || "Error"
                      : placeholder
                  }
                  placeholderTextColor={
                    status === "error" ? "#FF3B30" : themeColorMuted
                  }
                  value={value}
                  onChangeText={onChangeText}
                  returnKeyType="search"
                  autoCapitalize="none"
                  autoCorrect={false}
                  cursorColor={themeColorMuted}
                  multiline={multiline}
                  spellCheck={false}
                />
              </StyledView>

              {/* Actions Group */}
              <StyledView className="flex-row items-center gap-x-1">
                {/* Clear Button */}
                {value.length > 0 && (
                  <TouchableOpacity
                    onPress={() => onChangeText("")}
                    className="p-1.5"
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name="close-circle"
                      size={18}
                      color={themeColorMuted}
                      className="opacity-40"
                    />
                  </TouchableOpacity>
                )}

                {/* Language Toggle Button */}
                <TouchableOpacity
                  onPress={toggleLanguage}
                  className="px-2 py-0.5 rounded-lg bg-black/5 dark:bg-white/10 flex-row items-center justify-center"
                  activeOpacity={0.7}
                >
                  <StyledText className="text-[10px] font-bold text-foreground opacity-60 uppercase">
                    {selectedLang.label}
                  </StyledText>
                </TouchableOpacity>

                {/* Mic Button */}
                <TouchableOpacity
                  onPress={handleVoiceSearch}
                  activeOpacity={0.7}
                  className={`p-1 rounded-lg ${
                    isListening ? "bg-primary/15" : ""
                  }`}
                >
                  <Ionicons
                    name={isListening ? "mic" : "mic-outline"}
                    size={20}
                    color={
                      status === "error"
                        ? "#FF3B30"
                        : isListening
                        ? "#007AFF"
                        : themeColorMuted
                    }
                    className={isListening ? "opacity-100" : "opacity-70"}
                  />
                </TouchableOpacity>
              </StyledView>
            </StyledView>
          </StyledView>
        </StyledView>
      </StyledView>

      {/* Related Keywords UI */}
      {(isLoadingKeywords || relatedKeywords.length > 0) && (
        <StyledScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="mt-2 px-1"
          contentContainerStyle={{
            alignItems: "center",
            minHeight: 44,
            paddingRight: 16,
          }}
          style={{ zIndex: 100 }}
        >
          {isLoadingKeywords ? (
            <StyledView className="flex-row items-center ml-2">
              <StyledText className="text-[12px] text-foreground/40 font-semibold uppercase tracking-tighter">
                Thinking
              </StyledText>
              <ThinkingDots
                size={12}
                color={themeColorMuted}
                className="opacity-40"
              />
            </StyledView>
          ) : (
            relatedKeywords.map((keyword) => (
              <TouchableOpacity
                key={keyword}
                onPress={() => {
                  onChangeText(keyword);
                }}
                className="bg-black/5 dark:bg-white/5 px-4 py-2 rounded-xl mr-2 border border-black/10 dark:border-white/10"
                activeOpacity={0.6}
              >
                <StyledText className="text-[13px] text-foreground font-semibold">
                  {keyword}
                </StyledText>
              </TouchableOpacity>
            ))
          )}
        </StyledScrollView>
      )}
    </StyledView>
  );
}
