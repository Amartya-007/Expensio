import { Text, TextProps } from 'react-native';
import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';

// Replicates TripSpend's `.page-title` class (index.css):
//   bg-gradient-to-r from-blue-700 to-blue-500 bg-clip-text text-transparent
// RN Text has no CSS background-clip equivalent, so the gradient is rendered separately
// and masked to the text's shape instead. See global.css's header comment and
// docs/architecture/expensio-ui-port-plan.md for why this needed its own component rather
// than being expressible as a className.
export default function GradientText({ children, style, ...rest }: TextProps) {
  // page-title is always font-black (900) in TripSpend -- Android needs the actual
  // Inter_900Black family name, not just fontWeight: '900' on the generic Inter_400Regular
  // family. See tailwind.config.js's fontFamily comment.
  const weightFix = { fontFamily: 'Inter_900Black' as const };
  return (
    <MaskedView
      maskElement={<Text {...rest} style={[style, weightFix, { backgroundColor: 'transparent' }]}>{children}</Text>}
    >
      <LinearGradient
        colors={['#1d4ed8', '#3b82f6']} // tailwind blue-700 -> blue-500, matching the original
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
      >
        <Text {...rest} style={[style, weightFix, { opacity: 0 }]}>
          {children}
        </Text>
      </LinearGradient>
    </MaskedView>
  );
}
