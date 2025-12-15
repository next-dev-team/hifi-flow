import { useSearchSearchGet } from "api-hifi/src/gen/hooks";
import { Card, Chip, useThemeColor } from "heroui-native";
import { Text, TouchableOpacity, View } from "react-native";
import { Container } from "@/components/container";

export default function Home() {
  const { data, isLoading, error } = useSearchSearchGet({ s: "kh" });

  return (
    <Container className="p-6">
      <View className="py-4 mb-6">
        <Text className="text-4xl font-bold text-foreground mb-2">
          BETTER T STACK
        </Text>
      </View>
    </Container>
  );
}
