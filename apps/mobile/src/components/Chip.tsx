import { Pressable, StyleSheet, Text } from 'react-native';

export default function Chip({
  selected,
  label,
  onPress,
}: {
  selected: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        selected ? styles.selected : styles.unselected,
        pressed && !selected && styles.pressed,
      ]}
    >
      <Text style={[styles.label, selected ? styles.labelSelected : styles.labelUnselected]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  selected: {
    backgroundColor: '#2563eb',
    borderColor: '#2563eb',
  },
  unselected: {
    backgroundColor: '#fff',
    borderColor: '#e2e8f0',
  },
  pressed: {
    backgroundColor: '#f1f5f9',
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
  },
  labelSelected: {
    color: '#fff',
  },
  labelUnselected: {
    color: '#475569',
  },
});
