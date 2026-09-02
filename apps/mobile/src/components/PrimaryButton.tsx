import React from 'react';
import { Pressable, Text, View, ActivityIndicator, PressableProps, StyleProp, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

export default function PrimaryButton({
  children,
  icon,
  onPress,
  disabled,
  loading,
  style,
  ...rest
}: PressableProps & {
  children: React.ReactNode;
  icon?: React.ReactNode;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        {
          transform: [{ scale: pressed && !disabled && !loading ? 0.96 : 1 }],
          opacity: disabled ? 0.6 : 1,
        },
        style,
      ]}
      {...rest}
    >
      <LinearGradient
        colors={disabled ? ['#94a3b8', '#64748b'] : ['#2563eb', '#1d4ed8']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          paddingHorizontal: 24,
          paddingVertical: 14,
          borderRadius: 18,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: '#2563eb',
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: disabled ? 0 : 0.35,
          shadowRadius: 12,
          elevation: disabled ? 0 : 6,
        }}
      >
        {loading ? (
          <ActivityIndicator color="#ffffff" size="small" />
        ) : (
          <View className="flex-row items-center justify-center gap-2">
            {icon}
            <Text
              className="text-white text-base font-bold tracking-tight text-center"
              style={{ fontFamily: 'Inter_600SemiBold' }}
            >
              {children}
            </Text>
          </View>
        )}
      </LinearGradient>
    </Pressable>
  );
}
