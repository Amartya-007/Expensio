/**
 * ScreenHeader
 *
 * The standard white top-bar used by all stack screens:
 *   [BackButton]  [GradientText title + subtitle]  [optional right slot]
 *
 * Extracted because ActivityLogScreen, MembersScreen, TripDetailScreen
 * and RecurringScreen all contained identical ~20-line header blocks.
 *
 * TripSettingsScreen and DashboardScreen intentionally do NOT use this —
 * they have custom gradient heroes.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';

export interface ScreenHeaderProps {
  /** Called when the back button is pressed. */
  onBack: () => void;
  /** Main heading. */
  title: string;
  /** Optional small caption line below the title. */
  subtitle?: string;
  /** Pre-computed safe-area top offset: Math.max(insets.top, 16). */
  paddingTop?: number;
  /** Optional content rendered on the right edge (badges, counts, etc.). */
  right?: React.ReactNode;
  /** Disable the back button while an operation is in flight. */
  backDisabled?: boolean;
  /** Optional class name override for title */
  titleClassName?: string;
}

export default function ScreenHeader({
  onBack,
  title,
  subtitle,
  paddingTop = 16,
  right,
  backDisabled = false,
  titleClassName,
}: ScreenHeaderProps) {
  return (
    <View style={[s.container, { paddingTop }]}>
      <Pressable
        onPress={onBack}
        disabled={backDisabled}
        style={({ pressed }) => [s.backBtn, pressed && s.backBtnPressed]}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <ArrowLeft size={20} color="#0b1c30" strokeWidth={2.2} />
      </Pressable>

      <View style={s.body}>
        <Text style={s.title} className={titleClassName} numberOfLines={1}>
          {title}
        </Text>
        {!!subtitle && <Text style={s.subtitle}>{subtitle}</Text>}
      </View>

      {right != null && <View style={s.right}>{right}</View>}
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 14,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#eff4ff',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  backBtnPressed: {
    backgroundColor: '#dce9ff',
  },
  body: { flex: 1 },
  title: {
    fontSize: 20,
    fontWeight: '700',
    fontFamily: 'Inter_700Bold',
    color: '#0b1c30',
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 13,
    fontWeight: '400',
    fontFamily: 'Inter_400Regular',
    color: '#434655',
    marginTop: 2,
  },
  right: { flexShrink: 0 },
});
