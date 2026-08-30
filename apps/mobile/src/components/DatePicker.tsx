import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Calendar } from 'lucide-react-native';

// tripspend/src/components/DatePicker.tsx wraps a native HTML <input type="date">, which
// gives it a platform date-picker UI for free -- there's no RN equivalent from a plain
// TextInput. Adding a real native picker (@react-native-community/datetimepicker) would
// pull in a new native module this sandbox has no device to visually verify, for a
// component only needed by the two fields on TripSettingsScreen -- a validated
// YYYY-MM-DD text field gets the same data in and out with none of that risk. Swap this
// for a real native picker later if the plain text entry feels wrong on a device; nothing
// else would need to change, since this already returns/accepts the same 'YYYY-MM-DD'
// string shape update_trip_details expects.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default function DatePicker({
  value,
  onChange,
  minDate,
}: {
  value: string;
  onChange: (value: string) => void;
  minDate?: string;
}) {
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);

  const invalid = text.length > 0 && (!DATE_RE.test(text) || Number.isNaN(Date.parse(text)));
  const belowMin = !invalid && !!minDate && text < minDate;

  return (
    <View>
      <View
        className={`flex-row items-center gap-2 input-field ${focused ? 'input-field-focused' : ''} ${
          invalid || belowMin ? 'border-red-300' : ''
        }`}
      >
        <Calendar size={16} color="#94a3b8" />
        <TextInput
          className="flex-1 text-sm text-slate-900"
          value={text}
          onChangeText={setText}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            if (DATE_RE.test(text) && !Number.isNaN(Date.parse(text))) onChange(text);
            else setText(value);
          }}
          placeholder="YYYY-MM-DD"
          placeholderTextColor="#94a3b8"
          keyboardType="numbers-and-punctuation"
          maxLength={10}
        />
      </View>
      {invalid && <Text className="text-xs text-red-500 font-semibold mt-1">Use YYYY-MM-DD.</Text>}
      {belowMin && <Text className="text-xs text-red-500 font-semibold mt-1">Can't be before the start date.</Text>}
    </View>
  );
}
