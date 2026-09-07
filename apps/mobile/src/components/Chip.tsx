import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

export default function Chip({
  selected,
  label,
  icon,
  onPress,
}: {
  selected: boolean;
  label: string;
  icon?: React.ReactNode;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.base,
        selected ? styles.selected : styles.unselected,
        pressed && !selected && styles.pressed,
        pressed && selected && styles.selectedPressed,
      ]}
    >
      {icon}
      <Text
        style={[
          styles.label,
          selected ? styles.labelSelected : styles.labelUnselected,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  selected: {
    backgroundColor: '#0b1c30',
    borderColor: '#0b1c30',
  },
  selectedPressed: {
    backgroundColor: '#213145',
  },
  unselected: {
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
  },
  pressed: {
    backgroundColor: '#f8f9ff',
    borderColor: '#cbdbf5',
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.01,
  },
  labelSelected: {
    color: '#ffffff',
  },
  labelUnselected: {
    color: '#434655',
  },
});
