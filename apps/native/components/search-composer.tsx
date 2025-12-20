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
import { fetchRelatedKeywords } from "../utils/ai";

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
  const [isListening, setIsListening] = useState(false);
  const [selectedLang, setSelectedLang] = useState(LANGUAGES[0]);
  const selectedLangRef = useRef(selectedLang);
  selectedLangRef.current = selectedLang;

  const [status, setStatus] = useState<"idle" | "listening" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [relatedKeywords, setRelatedKeywords] = useState<string[]>([]);
  const [isLoadingKeywords, setIsLoadingKeywords] = useState(false);

  // Fetch related keywords when value changes (debounced-ish)
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (value.trim().length >= 2) {
        setIsLoadingKeywords(true);
        try {
          const keywords = await fetchRelatedKeywords(value);
          setRelatedKeywords(keywords);
        } catch (e) {
          console.error("Failed to fetch keywords:", e);
        } finally {
          setIsLoadingKeywords(false);
        }
      } else {
        setRelatedKeywords([]);
        setIsLoadingKeywords(false);
      }
    }, 800);

    return () => clearTimeout(timer);
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
    setIsListening(true);
    setStatus("listening");
    setErrorMessage(null);
  });

  useSpeechRecognitionEvent("end", () => {
    setIsListening(false);
    setStatus((prev) => (prev === "error" ? "error" : "idle"));
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  });

  useSpeechRecognitionEvent("result", (event) => {
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
    console.error("Speech recognition error:", event.error, event.message);
    setIsListening(false);
    setStatus("error");

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
      setTimeout(() => {
        setStatus("idle");
        setErrorMessage(null);
      }, 3000);
    }
  }, [isListening, stopRecording]);

  return (
    <StyledView className={`relative ${className}`}>
      <StyledView
        className="relative max-h-full w-full bg-linear-to-b from-default-400/5 to-default-400/8 dark:from-default-200/65 dark:to-default-200/65 p-1.5 rounded-[32px]"
        style={{ boxShadow: "rgb(255, 255, 255) 0px 0px 0px 1px inset" } as any}
      >
        <StyledView className="bg-white/90 dark:bg-background/45 rounded-[26px]">
          <StyledView className="relative flex-col overflow-hidden w-auto rounded-[24px] border-2 border-transparent">
            <StyledView className="flex-row items-center min-h-[44px] w-auto px-3">
              <StyledView className="justify-center mr-2">
                <Ionicons
                  name="search"
                  size={18}
                  color={themeColorMuted}
                  className="opacity-60"
                />
              </StyledView>
              <StyledView className="flex-1 justify-center">
                <StyledTextInput
                  className="w-full bg-transparent text-foreground text-[16px] py-2"
                  style={
                    {
                      minHeight: 44,
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
              <StyledView className="flex-row items-center gap-x-0.5">
                {/* Clear Button */}
                {value.length > 0 && (
                  <TouchableOpacity
                    onPress={() => onChangeText("")}
                    className="p-1"
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name="close-circle"
                      size={18}
                      color={themeColorMuted}
                      className="opacity-50"
                    />
                  </TouchableOpacity>
                )}

                {/* Language Toggle Button */}
                <TouchableOpacity
                  onPress={toggleLanguage}
                  className="px-2 py-0.5 rounded-full bg-default-100/50 flex-row items-center justify-center"
                  activeOpacity={0.7}
                >
                  <StyledText className="text-[10px] font-bold text-foreground opacity-70">
                    {selectedLang.label}
                  </StyledText>
                </TouchableOpacity>

                {/* Mic Button */}
                <TouchableOpacity
                  onPress={handleVoiceSearch}
                  activeOpacity={0.7}
                  className={`p-1 rounded-full ${
                    isListening ? "bg-primary/20" : ""
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
                    className={isListening ? "opacity-100" : "opacity-80"}
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
          className="mt-1 px-2"
          contentContainerStyle={{
            alignItems: "center",
            minHeight: 44,
            paddingRight: 16,
          }}
          style={{ zIndex: 100 }}
        >
          {isLoadingKeywords ? (
            <StyledView className="flex-row items-center ml-2">
              <ActivityIndicator size="small" color={themeColorMuted} />
              <StyledText className="text-[12px] text-foreground/40 font-medium ml-2 italic">
                Suggesting...
              </StyledText>
            </StyledView>
          ) : (
            relatedKeywords.map((keyword) => (
              <TouchableOpacity
                key={keyword}
                onPress={() => {
                  onChangeText(keyword);
                }}
                className="bg-default-100 dark:bg-default-200/30 px-4 py-2 rounded-full mr-2 border border-default-300/50 dark:border-default-400/30 shadow-md"
                activeOpacity={0.6}
                style={{
                  elevation: 4,
                  shadowColor: "#000",
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.2,
                  shadowRadius: 4,
                }}
              >
                <StyledText className="text-[14px] text-foreground font-bold">
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
