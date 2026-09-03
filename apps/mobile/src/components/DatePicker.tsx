import { useState, useMemo } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Check, X } from 'lucide-react-native';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function toIsoString(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function parseIso(iso: string): { year: number; month: number; day: number } {
  if (!iso || typeof iso !== 'string') {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
  }
  const parts = iso.split('-').map(Number);
  if (parts.length === 3 && !parts.some(Number.isNaN)) {
    return { year: parts[0], month: parts[1], day: parts[2] };
  }
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

function formatDisplayDate(iso: string): string {
  if (!iso) return 'Select date';
  const { year, month, day } = parseIso(iso);
  const dateObj = new Date(year, month - 1, day);
  const weekdayShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dateObj.getDay()];
  const monthShort = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ][month - 1];
  return `${weekdayShort}, ${monthShort} ${day}, ${year}`;
}

function getTodayIso(): string {
  const now = new Date();
  return toIsoString(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export default function DatePicker({
  value,
  onChange,
  minDate,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  minDate?: string;
  label?: string;
}) {
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedIso, setSelectedIso] = useState(value || getTodayIso());

  const initial = useMemo(() => parseIso(selectedIso), [selectedIso]);
  const [viewYear, setViewYear] = useState(initial.year);
  const [viewMonth, setViewMonth] = useState(initial.month);

  function openModal() {
    const current = parseIso(value || getTodayIso());
    setSelectedIso(value || getTodayIso());
    setViewYear(current.year);
    setViewMonth(current.month);
    setModalVisible(true);
  }

  function prevMonth() {
    if (viewMonth === 1) {
      setViewMonth(12);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  }

  function nextMonth() {
    if (viewMonth === 12) {
      setViewMonth(1);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  }

  function applyPreset(daysFromToday: number) {
    const target = new Date();
    target.setDate(target.getDate() + daysFromToday);
    const iso = toIsoString(target.getFullYear(), target.getMonth() + 1, target.getDate());
    if (!minDate || iso >= minDate) {
      setSelectedIso(iso);
      setViewYear(target.getFullYear());
      setViewMonth(target.getMonth() + 1);
    }
  }

  function confirmSelection(isoToConfirm?: string) {
    const finalIso = isoToConfirm || selectedIso;
    onChange(finalIso);
    setModalVisible(false);
  }

  // Generate calendar grid
  const daysInCurrentMonth = getDaysInMonth(viewYear, viewMonth);
  const firstDayOfWeek = new Date(viewYear, viewMonth - 1, 1).getDay(); // 0 = Sun, 1 = Mon ...
  const prevMonthDays = getDaysInMonth(
    viewMonth === 1 ? viewYear - 1 : viewYear,
    viewMonth === 1 ? 12 : viewMonth - 1
  );

  const todayIso = getTodayIso();

  const calendarGrid = useMemo(() => {
    const cells: Array<{
      day: number;
      month: number;
      year: number;
      iso: string;
      isCurrentMonth: boolean;
      isDisabled: boolean;
      isSelected: boolean;
      isToday: boolean;
    }> = [];

    // Leading days from previous month
    for (let i = firstDayOfWeek - 1; i >= 0; i--) {
      const day = prevMonthDays - i;
      const month = viewMonth === 1 ? 12 : viewMonth - 1;
      const year = viewMonth === 1 ? viewYear - 1 : viewYear;
      const iso = toIsoString(year, month, day);
      cells.push({
        day,
        month,
        year,
        iso,
        isCurrentMonth: false,
        isDisabled: true,
        isSelected: selectedIso === iso,
        isToday: todayIso === iso,
      });
    }

    // Days in current month
    for (let day = 1; day <= daysInCurrentMonth; day++) {
      const iso = toIsoString(viewYear, viewMonth, day);
      const isPastMin = minDate ? iso < minDate : false;
      cells.push({
        day,
        month: viewMonth,
        year: viewYear,
        iso,
        isCurrentMonth: true,
        isDisabled: isPastMin,
        isSelected: selectedIso === iso,
        isToday: todayIso === iso,
      });
    }

    // Trailing days from next month to fill grid
    const remaining = (7 - (cells.length % 7)) % 7;
    for (let day = 1; day <= remaining; day++) {
      const month = viewMonth === 12 ? 1 : viewMonth + 1;
      const year = viewMonth === 12 ? viewYear + 1 : viewYear;
      const iso = toIsoString(year, month, day);
      cells.push({
        day,
        month,
        year,
        iso,
        isCurrentMonth: false,
        isDisabled: true,
        isSelected: selectedIso === iso,
        isToday: todayIso === iso,
      });
    }

    return cells;
  }, [viewYear, viewMonth, selectedIso, minDate, daysInCurrentMonth, firstDayOfWeek, prevMonthDays, todayIso]);

  return (
    <View>
      {/* Trigger Button Field */}
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={openModal}
        className="flex-row items-center justify-between px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl active:bg-slate-100"
      >
        <View className="flex-row items-center gap-3">
          <View className="w-8 h-8 rounded-xl bg-blue-50 items-center justify-center">
            <CalendarIcon size={16} color="#2563eb" />
          </View>
          <View>
            {!!label && <Text className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{label}</Text>}
            <Text className="text-sm font-semibold text-slate-800">{formatDisplayDate(value)}</Text>
          </View>
        </View>
        <View className="px-2.5 py-1 bg-white rounded-lg border border-slate-200">
          <Text className="text-xs font-bold text-blue-600">Change</Text>
        </View>
      </TouchableOpacity>

      {/* Calendar dialog, centered.
          NOTE: shadow-* and bg-color/opacity classNames (e.g. bg-black/40) are
          deliberately NOT used anywhere in this Modal. NativeWind's CSS
          interop has a documented race condition where parsing those exact
          utility patterns for the first time -- which is exactly what
          happens the moment this Modal's content mounts fresh -- can throw
          "Couldn't find a navigation context"
          (nativewind/nativewind#1536, #1711). Inline styles sidestep it. */}
      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={() => setModalVisible(false)}>
        <TouchableWithoutFeedback onPress={() => setModalVisible(false)}>
          <View
            className="flex-1 items-center justify-center px-6"
            style={{ backgroundColor: 'rgba(15, 23, 42, 0.45)' }}
          >
            <TouchableWithoutFeedback onPress={(e) => e.stopPropagation()}>
              <View
                className="bg-white rounded-3xl pt-6 pb-6 px-6 border border-slate-100 w-full max-w-sm"
                style={{
                  shadowColor: '#0f172a',
                  shadowOffset: { width: 0, height: 20 },
                  shadowOpacity: 0.25,
                  shadowRadius: 40,
                  elevation: 12,
                }}
              >
                {/* Modal Header */}
                <View className="flex-row items-center justify-between pb-3 border-b border-slate-100 mb-3">
                  <View>
                    <Text className="text-base font-black text-slate-900">{label || 'Select Date'}</Text>
                    <Text className="text-xs font-medium text-blue-600 mt-0.5">{formatDisplayDate(selectedIso)}</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => setModalVisible(false)}
                    className="w-8 h-8 rounded-full bg-slate-100 items-center justify-center"
                  >
                    <X size={16} color="#64748b" />
                  </TouchableOpacity>
                </View>

                {/* Quick Presets */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row mb-4 py-1">
                  <TouchableOpacity
                    onPress={() => applyPreset(0)}
                    disabled={!!minDate && getTodayIso() < minDate}
                    className="mr-2 px-3 py-1.5 rounded-xl bg-slate-100 active:bg-slate-200 border border-slate-200"
                  >
                    <Text className="text-xs font-semibold text-slate-700">Today</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => applyPreset(3)}
                    className="mr-2 px-3 py-1.5 rounded-xl bg-slate-100 active:bg-slate-200 border border-slate-200"
                  >
                    <Text className="text-xs font-semibold text-slate-700">+3 Days</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => applyPreset(7)}
                    className="mr-2 px-3 py-1.5 rounded-xl bg-slate-100 active:bg-slate-200 border border-slate-200"
                  >
                    <Text className="text-xs font-semibold text-slate-700">+1 Week</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => applyPreset(14)}
                    className="mr-2 px-3 py-1.5 rounded-xl bg-slate-100 active:bg-slate-200 border border-slate-200"
                  >
                    <Text className="text-xs font-semibold text-slate-700">+2 Weeks</Text>
                  </TouchableOpacity>
                </ScrollView>

                {/* Month Navigation */}
                <View className="flex-row items-center justify-between mb-3 px-1">
                  <Text className="text-base font-black text-slate-800">
                    {MONTH_NAMES[viewMonth - 1]} {viewYear}
                  </Text>
                  <View className="flex-row items-center gap-1">
                    <TouchableOpacity
                      onPress={prevMonth}
                      className="w-8 h-8 rounded-xl bg-slate-100 items-center justify-center active:bg-slate-200"
                    >
                      <ChevronLeft size={18} color="#334155" />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={nextMonth}
                      className="w-8 h-8 rounded-xl bg-slate-100 items-center justify-center active:bg-slate-200"
                    >
                      <ChevronRight size={18} color="#334155" />
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Weekday Labels */}
                <View className="flex-row justify-between mb-2 px-1">
                  {WEEKDAYS.map((w, index) => (
                    <View key={w} className="w-10 items-center">
                      <Text
                        className={`text-xs font-bold ${index === 0 || index === 6 ? 'text-blue-500' : 'text-slate-400'
                          }`}
                      >
                        {w}
                      </Text>
                    </View>
                  ))}
                </View>

                {/* Day Grid */}
                <View className="flex-row flex-wrap justify-between mb-5">
                  {calendarGrid.map((item, idx) => {
                    if (!item.isCurrentMonth) {
                      return (
                        <View key={idx} className="w-10 h-10 items-center justify-center my-1.5">
                          <Text className="text-xs text-slate-300 font-medium">{item.day}</Text>
                        </View>
                      );
                    }

                    if (item.isDisabled) {
                      return (
                        <View key={idx} className="w-10 h-10 items-center justify-center my-1.5">
                          <Text className="text-xs text-slate-300 line-through font-medium">{item.day}</Text>
                        </View>
                      );
                    }

                    return (
                      <TouchableOpacity
                        key={idx}
                        onPress={() => {
                          setSelectedIso(item.iso);
                        }}
                        className={`w-10 h-10 rounded-2xl items-center justify-center my-1.5 ${item.isSelected
                            ? 'bg-blue-600'
                            : item.isToday
                              ? 'bg-blue-50 border border-blue-200'
                              : 'active:bg-slate-100'
                          }`}
                        style={
                          item.isSelected
                            ? {
                              shadowColor: '#2563eb',
                              shadowOffset: { width: 0, height: 2 },
                              shadowOpacity: 0.3,
                              shadowRadius: 4,
                              elevation: 3,
                            }
                            : undefined
                        }
                      >
                        <Text
                          className={`text-sm font-bold ${item.isSelected
                              ? 'text-white'
                              : item.isToday
                                ? 'text-blue-600'
                                : 'text-slate-800'
                            }`}
                        >
                          {item.day}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Action Buttons */}
                <View className="flex-row gap-3">
                  <TouchableOpacity
                    onPress={() => setModalVisible(false)}
                    className="flex-1 py-3.5 bg-slate-100 rounded-2xl items-center justify-center active:bg-slate-200"
                  >
                    <Text className="text-sm font-bold text-slate-600">Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => confirmSelection()}
                    className="flex-1 py-3.5 bg-blue-600 rounded-2xl items-center justify-center active:bg-blue-700"
                    style={{
                      shadowColor: '#2563eb',
                      shadowOffset: { width: 0, height: 6 },
                      shadowOpacity: 0.2,
                      shadowRadius: 10,
                      elevation: 4,
                    }}
                  >
                    <View className="flex-row items-center gap-1.5">
                      <Check size={16} color="#ffffff" />
                      <Text className="text-sm font-bold text-white">Select Date</Text>
                    </View>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  );
}
