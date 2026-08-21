import { Pressable, Text, ActivityIndicator, PressableProps } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

const AnimatedGradient = Animated.createAnimatedComponent(LinearGradient);

// Replicates TripSpend's `.btn-primary` (index.css):
//   px-6 py-3 text-white font-semibold rounded-2xl shadow-lg hover:shadow-xl
//   active:scale-95 transition-all duration-200
//   background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)
//   box-shadow: 0 10px 25px rgba(37, 99, 235, 0.25)
// hover: has no RN equivalent (dropped). active:scale-95 + transition-all duration-200 is
// reproduced here with Reanimated instead of a className, since there's no CSS transition
// mechanism to animate a style change from a class alone. The gradient itself can't be a
// className either (see global.css's header comment) — LinearGradient renders it directly.
export default function PrimaryButton({
  children,
  onPress,
  disabled,
  loading,
  ...rest
}: PressableProps & { children: React.ReactNode; loading?: boolean }) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Pressable
      onPressIn={() => {
        scale.value = withTiming(0.95, { duration: 200 });
      }}
      onPressOut={() => {
        scale.value = withTiming(1, { duration: 200 });
      }}
      onPress={onPress}
      disabled={disabled || loading}
      {...rest}
    >
      <AnimatedGradient
        colors={disabled ? ['#e2e8f0', '#e2e8f0'] : ['#2563eb', '#1d4ed8']} // tailwind blue-600 -> blue-700
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[
          {
            paddingHorizontal: 24,
            paddingVertical: 12,
            borderRadius: 16,
            alignItems: 'center',
            justifyContent: 'center',
            shadowColor: '#2563eb',
            shadowOffset: { width: 0, height: 10 },
            shadowOpacity: disabled ? 0 : 0.25,
            shadowRadius: 25,
            elevation: disabled ? 0 : 6,
          },
          animatedStyle,
        ]}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          // fontFamily set explicitly (not just the font-semibold class) -- see
          // tailwind.config.js's fontFamily comment on why Android needs this.
          <Text
            className={`text-sm ${disabled ? 'text-slate-400' : 'text-white'}`}
            style={{ fontFamily: 'Inter_600SemiBold' }}
          >
            {children}
          </Text>
        )}
      </AnimatedGradient>
    </Pressable>
  );
}
