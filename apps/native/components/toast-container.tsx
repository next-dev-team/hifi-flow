import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, Platform } from 'react-native';
import Animated, { 
  useSharedValue, 
  useAnimatedStyle, 
  withSpring, 
  withTiming,
  runOnJS
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useToast } from '../contexts/toast-context';

export const ToastContainer: React.FC = () => {
  const { toast, hideToast } = useToast();
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(-100);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (toast) {
      translateY.value = withSpring(insets.top + 10, {
        damping: 15,
        stiffness: 100,
      });
      opacity.value = withTiming(1, { duration: 300 });
    } else {
      translateY.value = withTiming(-100, { duration: 300 });
      opacity.value = withTiming(0, { duration: 300 });
    }
  }, [toast, insets.top, translateY, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  const getBackgroundColor = () => {
    if (!toast) return 'bg-blue-500';
    switch (toast.type) {
      case 'success':
        return 'bg-green-500';
      case 'error':
        return 'bg-red-500';
      case 'info':
      default:
        return 'bg-blue-500';
    }
  };

  const getIcon = () => {
    if (!toast) return 'information-circle';
    switch (toast.type) {
      case 'success':
        return 'checkmark-circle';
      case 'error':
        return 'alert-circle';
      case 'info':
      default:
        return 'information-circle';
    }
  };

  return (
    <Animated.View
      pointerEvents={toast ? 'auto' : 'none'}
      style={[
        {
          position: 'absolute',
          top: 0,
          left: 16,
          right: 16,
          zIndex: 9999,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.25,
          shadowRadius: 3.84,
          elevation: 5,
        },
        animatedStyle,
      ]}
    >
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={hideToast}
        className={`${getBackgroundColor()} rounded-2xl p-4 flex-row items-center`}
      >
        <Ionicons name={getIcon() as any} size={24} color="white" />
        <View className="ml-3 flex-1">
          <Text className="text-white font-semibold text-sm">
            {toast?.type === 'error' ? 'Error' : toast?.type === 'success' ? 'Success' : 'Info'}
          </Text>
          <Text className="text-white text-xs opacity-90" numberOfLines={2}>
            {toast?.message}
          </Text>
        </View>
        <Ionicons name="close" size={20} color="white" className="opacity-70" />
      </TouchableOpacity>
    </Animated.View>
  );
};
