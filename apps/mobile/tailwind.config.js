/** @type {import('tailwindcss').Config} */
// Ported from tripspend/src/index.css's @theme block (Tailwind v4 CSS-first syntax there
// -- translated to v3's JS config here, since nativewind@4.2.6's actual engine
// (react-native-css-interop) requires tailwindcss ~3, not v4. See babel.config.js's
// comment and docs/architecture/expensio-ui-port-plan.md for why.
module.exports = {
  content: ['./App.tsx', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      fontFamily: {
        // Only covers the *regular* weight -- Android doesn't auto-resolve fontWeight to
        // the matching static Inter file the way CSS/iOS does with one @font-face family,
        // so font-semibold/font-bold/font-black classes still render in this weight on
        // Android unless a component also sets an explicit weight-specific fontFamily
        // (Inter_600SemiBold / Inter_700Bold / Inter_900Black -- see App.tsx's useFonts
        // call and GradientText.tsx/PrimaryButton.tsx for the pattern). Flagged in
        // docs/architecture/expensio-ui-port-plan.md so future screens don't rediscover it.
        sans: ['Inter_400Regular', 'System'],
      },
    },
  },
  plugins: [],
};
