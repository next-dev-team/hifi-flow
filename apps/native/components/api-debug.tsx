import { Card, Chip } from "heroui-native";
import React, { useState } from "react";
import { ScrollView, Text, View } from "react-native";

interface ApiDebugProps<TData = unknown, TError = unknown> {
	title?: string;
	data?: TData;
	error?: TError;
}

export function ApiDebug<TData = unknown, TError = unknown>({
	title,
	data,
	error,
}: ApiDebugProps<TData, TError>) {
  const [open, setOpen] = useState(false);

  if (!data && !error) {
    return null;
  }

	return (
		<View className="mt-4">
			<View className="flex-row items-center justify-between mb-2 px-1">
				<Text className="text-default-500 text-xs">{title ?? "API debug"}</Text>
				<Chip
					variant={open ? "primary" : "secondary"}
					className="h-7 px-3"
					onPress={() => setOpen((v) => !v)}
				>
          <Text className="text-xs">
            {open ? "Hide response" : "Show response"}
          </Text>
        </Chip>
      </View>
      {open ? (
        <Card className="bg-content2 max-h-64">
          <Card.Body className="p-3">
            <ScrollView>
              {error ? (
                <View className="mb-3">
                  <Text className="text-danger text-xs mb-1">Error</Text>
                  <Text
                    className="text-danger-foreground text-[11px]"
                    selectable
                  >
                    {JSON.stringify(error, null, 2)}
                  </Text>
                </View>
              ) : null}
              {data ? (
                <View>
                  <Text className="text-default-500 text-xs mb-1">Data</Text>
                  <Text className="text-xs text-foreground" selectable>
                    {JSON.stringify(data, null, 2)}
                  </Text>
                </View>
              ) : null}
            </ScrollView>
          </Card.Body>
        </Card>
      ) : null}
    </View>
  );
}
