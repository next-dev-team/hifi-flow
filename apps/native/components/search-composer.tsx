import { Ionicons } from "@expo/vector-icons";
import { useThemeColor } from "heroui-native";
import { Platform, TextInput, TouchableOpacity, View } from "react-native";
import { withUniwind } from "uniwind";

const StyledView = withUniwind(View);
const StyledTextInput = withUniwind(TextInput);

interface SearchComposerProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  className?: string;
  multiline?: boolean;
}

/**
 * A highly styled search input component matching the "Message Copilot" UI.
 * Features nested borders and soft shadows for a modern, glass-like look.
 */
export function SearchComposer({
  value,
  onChangeText,
  placeholder = "Search songs, artists, albums",
  className = "",
  multiline = false,
}: SearchComposerProps) {
  const themeColorMuted = useThemeColor("muted");

  return (
    <StyledView className={`relative ${className}`}>
      {/* Outer Layer: Gradient background and soft border shadow */}
      <StyledView
        className="relative max-h-full w-full bg-gradient-to-b from-default-400/5 to-default-400/8 dark:from-default-200/65 dark:to-default-200/65 p-1.5 rounded-[32px]"
        style={
          {
            boxShadow: "rgb(255, 255, 255) 0px 0px 0px 1px inset",
          } as any
        }
      >
        {/* Middle Layer: Glass-like background */}
        <StyledView className="bg-white/90 dark:bg-background/45 rounded-[26px]">
          {/* Inner Layer: Main Container with Border */}
          <StyledView className="relative flex-col overflow-hidden w-auto rounded-[24px] border-2 border-transparent">
            {/* Content Area */}
            <StyledView className="flex-row items-center min-h-[44px] w-auto px-4">
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
                  style={{
                    minHeight: 44,
                    textAlignVertical: "center",
                    includeFontPadding: false,
                  }}
                  placeholder={placeholder}
                  placeholderTextColor={themeColorMuted}
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

              {/* Voice Search Icon */}
              <StyledView className="justify-center ml-2">
                <TouchableOpacity
                  onPress={() => {
                    // Placeholder for Voice Search (Google feature)
                    console.log("Voice search triggered");
                  }}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name="mic"
                    size={20}
                    color={themeColorMuted}
                    className="opacity-80"
                  />
                </TouchableOpacity>
              </StyledView>
            </StyledView>
          </StyledView>
        </StyledView>
      </StyledView>
    </StyledView>
  );
}
