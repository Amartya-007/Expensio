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
import GradientText from './GradientText';

export interface ScreenHeaderProps {
  /** Called when the back button is pressed. */
  onBack: () => void;
  /** Main heading, rendered inside GradientText. */
  title: string;
  /** Optional small caption line below the title. */
  subtitle?: string;
  /** Pre-computed safe-area top offset: Math.max(insets.top, 16). */
  paddingTop?: number;
  /** Optional content rendered on the right edge (badges, counts, etc.). */
  right?: React.ReactNode;
  /** Disable the back button while an operation is in flight. */
  backDisabled?: boolean;
  /** NativeWind class(es) forwarded to GradientText. Default: "text-2xl font-black". */
  titleClassName?: string;
}

export default function ScreenHeader({
  onBack,
  title,
  subtitle,
  paddingTop = 16,
  right,
  backDisabled = false,
  titleClassName = 'text-2xl font-black',
}: ScreenHeaderProps) {
  return (
    <View style={[s.container, { paddingTop }]}>
      <Pressable
        onPress={onBack}
        disabled={backDisabled}
        style={({ pressed }) => [s.backBtn, pressed && s.backBtnPressed]}
        hitSlop={8}
      >
        <ArrowLeft size={18} color="#334155" />
      </Pressable>

      <View style={s.body}>
        <GradientText className={titleClassName} numberOfLines={1}>
          {title}
        </GradientText>
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
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  backBtnPressed: { backgroundColor: '#e2e8f0' },
  body: { flex: 1 },
  subtitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94a3b8',
    marginTop: 2,
  },
  right: { flexShrink: 0 },
});
