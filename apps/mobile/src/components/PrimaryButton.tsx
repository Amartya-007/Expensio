import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

export type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'ghost';

export default function PrimaryButton({
  children,
  icon,
  onPress,
  disabled,
  loading,
  variant = 'primary',
  style,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: ButtonVariant;
  style?: StyleProp<ViewStyle>;
}) {
  const isPrimary = variant === 'primary';
  const isSecondary = variant === 'secondary';
  const isDestructive = variant === 'destructive';
  const isGhost = variant === 'ghost';
  const isDisabled = disabled || loading;

  const content = loading ? (
    <ActivityIndicator
      color={isPrimary ? '#ffffff' : isDestructive ? '#ef4444' : '#2563eb'}
      size="small"
    />
  ) : (
    <View style={styles.row}>
      {icon}
      <Text
        style={[
          styles.label,
          isPrimary && styles.primaryLabel,
          isSecondary && styles.secondaryLabel,
          isDestructive && styles.destructiveLabel,
          isGhost && styles.ghostLabel,
        ]}
      >
        {children}
      </Text>
    </View>
  );

  // Primary is the app's main call-to-action style, so it's the one that gets the
  // blue gradient treatment (matching the Dashboard hero card) -- secondary/
  // destructive/ghost stay flat, since a gradient on every button everywhere would
  // undercut the "primary action" signal a gradient CTA is meant to carry.
  if (isPrimary && !isDisabled) {
    return (
      <Pressable
        onPress={onPress}
        disabled={isDisabled}
        style={({ pressed }) => [styles.base, styles.primaryShadow, pressed && styles.pressedScale, style]}
      >
        {({ pressed }) => (
          <>
            <LinearGradient
              colors={pressed ? ['#1d4ed8', '#1e3a8a'] : ['#2563eb', '#1e40af']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[StyleSheet.absoluteFill, styles.gradientFill]}
            />
            {content}
          </>
        )}
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        isSecondary && styles.secondary,
        isDestructive && styles.destructive,
        isGhost && styles.ghost,
        pressed && !isDisabled && (
          isSecondary ? styles.secondaryPressed :
          isDestructive ? styles.destructivePressed :
          styles.ghostPressed
        ),
        disabled && styles.disabled,
        style,
      ]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 48,
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    flexDirection: 'row',
  },
  primaryShadow: {
    shadowColor: '#1e40af',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 8,
    elevation: 4,
  },
  gradientFill: {
    borderRadius: 12,
  },
  pressedScale: {
    transform: [{ scale: 0.99 }],
  },
  secondary: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  secondaryPressed: {
    backgroundColor: '#f8fafc',
    transform: [{ scale: 0.99 }],
  },
  destructive: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecdd3',
  },
  destructivePressed: {
    backgroundColor: '#fee2e2',
    transform: [{ scale: 0.99 }],
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  ghostPressed: {
    backgroundColor: '#eff4ff',
  },
  disabled: {
    opacity: 0.5,
    shadowOpacity: 0,
    elevation: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.01,
  },
  primaryLabel: {
    color: '#ffffff',
  },
  secondaryLabel: {
    color: '#0f172a',
  },
  destructiveLabel: {
    color: '#ef4444',
  },
  ghostLabel: {
    color: '#2563eb',
  },
});
