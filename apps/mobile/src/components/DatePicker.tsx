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
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function pad2(n: number): string { return n < 10 ? `0${n}` : `${n}`; }
function toIsoString(y: number, m: number, d: number) { return `${y}-${pad2(m)}-${pad2(d)}`; }
function parseIso(iso: string) {
  if (!iso) { const n = new Date(); return { year: n.getFullYear(), month: n.getMonth()+1, day: n.getDate() }; }
  const p = iso.split('-').map(Number);
  if (p.length === 3 && !p.some(Number.isNaN)) return { year: p[0], month: p[1], day: p[2] };
  const n = new Date(); return { year: n.getFullYear(), month: n.getMonth()+1, day: n.getDate() };
}
function formatDisplay(iso: string) {
  if (!iso) return 'Select date';
  const { year, month, day } = parseIso(iso);
  const d = new Date(year, month-1, day);
  const wd = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
  const mn = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][month-1];
  return `${wd}, ${mn} ${day}, ${year}`;
}
function getTodayIso() {
  const n = new Date(); return toIsoString(n.getFullYear(), n.getMonth()+1, n.getDate());
}
function getDaysInMonth(y: number, m: number) { return new Date(y, m, 0).getDate(); }

export default function DatePicker({
  value, onChange, minDate, label,
}: {
  value: string; onChange: (v: string) => void; minDate?: string; label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [selectedIso, setSelectedIso] = useState(value || getTodayIso());
  const initial = useMemo(() => parseIso(selectedIso), [selectedIso]);
  const [viewYear, setViewYear] = useState(initial.year);
  const [viewMonth, setViewMonth] = useState(initial.month);

  function openModal() {
    const c = parseIso(value || getTodayIso());
    setSelectedIso(value || getTodayIso());
    setViewYear(c.year); setViewMonth(c.month); setOpen(true);
  }
  function prevMonth() {
    if (viewMonth === 1) { setViewMonth(12); setViewYear(y => y-1); }
    else setViewMonth(m => m-1);
  }
  function nextMonth() {
    if (viewMonth === 12) { setViewMonth(1); setViewYear(y => y+1); }
    else setViewMonth(m => m+1);
  }
  function applyPreset(days: number) {
    const t = new Date(); t.setDate(t.getDate() + days);
    const iso = toIsoString(t.getFullYear(), t.getMonth()+1, t.getDate());
    if (!minDate || iso >= minDate) { setSelectedIso(iso); setViewYear(t.getFullYear()); setViewMonth(t.getMonth()+1); }
  }
  function confirm(iso?: string) { onChange(iso || selectedIso); setOpen(false); }

  const daysInMonth = getDaysInMonth(viewYear, viewMonth);
  const firstDow = new Date(viewYear, viewMonth-1, 1).getDay();
  const prevMonthDays = getDaysInMonth(viewMonth===1 ? viewYear-1 : viewYear, viewMonth===1 ? 12 : viewMonth-1);
  const todayIso = getTodayIso();

  const grid = useMemo(() => {
    const cells: Array<{ day:number; iso:string; isCurrentMonth:boolean; isDisabled:boolean; isSelected:boolean; isToday:boolean; }> = [];
    for (let i = firstDow-1; i >= 0; i--) {
      const day = prevMonthDays - i;
      const m = viewMonth===1 ? 12 : viewMonth-1;
      const y = viewMonth===1 ? viewYear-1 : viewYear;
      cells.push({ day, iso: toIsoString(y,m,day), isCurrentMonth:false, isDisabled:true, isSelected:false, isToday:false });
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const iso = toIsoString(viewYear, viewMonth, day);
      cells.push({ day, iso, isCurrentMonth:true, isDisabled: !!minDate && iso < minDate, isSelected: selectedIso===iso, isToday: todayIso===iso });
    }
    const rem = (7 - (cells.length % 7)) % 7;
    for (let day = 1; day <= rem; day++) {
      const m = viewMonth===12 ? 1 : viewMonth+1;
      const y = viewMonth===12 ? viewYear+1 : viewYear;
      cells.push({ day, iso: toIsoString(y,m,day), isCurrentMonth:false, isDisabled:true, isSelected:false, isToday:false });
    }
    return cells;
  }, [viewYear, viewMonth, selectedIso, minDate, daysInMonth, firstDow, prevMonthDays, todayIso]);

  return (
    <View>
      {/* Trigger */}
      <Pressable
        onPress={openModal}
        style={({ pressed }) => [s.trigger, pressed && s.triggerPressed]}
      >
        <View style={s.triggerLeft}>
          <View style={s.triggerIcon}>
            <CalendarIcon size={16} color="#2563eb" />
          </View>
          <View style={s.triggerTextWrap}>
            {!!label && <Text style={s.triggerLabel} numberOfLines={1}>{label}</Text>}
            <Text style={s.triggerValue} numberOfLines={1}>{formatDisplay(value)}</Text>
          </View>
        </View>
        <View style={s.changePill}>
          <Text style={s.changePillText}>Change</Text>
        </View>
      </Pressable>

      {/* Modal — all inline styles to avoid NativeWind first-parse race (#1536) */}
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableWithoutFeedback onPress={() => setOpen(false)}>
          <View style={{ flex:1, alignItems:'center', justifyContent:'center', paddingHorizontal:24, backgroundColor:'rgba(15,23,42,0.45)' }}>
            <TouchableWithoutFeedback onPress={e => e.stopPropagation()}>
              <View style={s.modal}>

                {/* Header */}
                <View style={s.modalHeader}>
                  <View>
                    <Text style={s.modalTitle}>{label || 'Select Date'}</Text>
                    <Text style={s.modalSelected}>{formatDisplay(selectedIso)}</Text>
                  </View>
                  <TouchableOpacity onPress={() => setOpen(false)} style={s.closeBtn}>
                    <X size={16} color="#64748b" />
                  </TouchableOpacity>
                </View>

                {/* Presets */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom:16 }}>
                  {[['Today',0],['+3 Days',3],['+1 Week',7],['+2 Weeks',14]].map(([lbl, d]) => (
                    <TouchableOpacity
                      key={String(lbl)}
                      onPress={() => applyPreset(Number(d))}
                      disabled={!!minDate && Number(d)===0 && getTodayIso() < minDate}
                      style={s.preset}
                    >
                      <Text style={s.presetText}>{lbl}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                {/* Month nav */}
                <View style={s.monthNav}>
                  <Text style={s.monthTitle}>{MONTH_NAMES[viewMonth-1]} {viewYear}</Text>
                  <View style={s.monthNavBtns}>
                    <TouchableOpacity onPress={prevMonth} style={s.navBtn}>
                      <ChevronLeft size={18} color="#334155" />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={nextMonth} style={s.navBtn}>
                      <ChevronRight size={18} color="#334155" />
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Weekdays */}
                <View style={s.weekRow}>
                  {WEEKDAYS.map((w, i) => (
                    <View key={w} style={s.weekCell}>
                      <Text style={[s.weekLabel, (i===0||i===6) && s.weekLabelWknd]}>{w}</Text>
                    </View>
                  ))}
                </View>

                {/* Day grid */}
                <View style={s.dayGrid}>
                  {grid.map((item, idx) => {
                    if (!item.isCurrentMonth || item.isDisabled) {
                      return (
                        <View key={idx} style={s.dayCell}>
                          <Text style={[s.dayText, s.dayTextDisabled]}>{item.day}</Text>
                        </View>
                      );
                    }
                    return (
                      <TouchableOpacity
                        key={idx}
                        onPress={() => setSelectedIso(item.iso)}
                        style={[
                          s.dayCell,
                          item.isSelected ? s.dayCellSelected : item.isToday ? s.dayCellToday : null,
                        ]}
                      >
                        <Text style={[
                          s.dayText,
                          item.isSelected ? s.dayTextSelected : item.isToday ? s.dayTextToday : s.dayTextNormal,
                        ]}>
                          {item.day}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Actions */}
                <View style={s.actions}>
                  <TouchableOpacity onPress={() => setOpen(false)} style={s.cancelBtn}>
                    <Text style={s.cancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => confirm()} style={s.confirmBtn}>
                    <View style={s.confirmInner}>
                      <Check size={16} color="#fff" />
                      <Text style={s.confirmText}>Select Date</Text>
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

const s = StyleSheet.create({
  // Trigger
  trigger: { flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:16, paddingVertical:14, backgroundColor:'#f8fafc', borderWidth:1, borderColor:'#e2e8f0', borderRadius:16 },
  triggerPressed: { backgroundColor:'#f1f5f9' },
  triggerLeft: { flexDirection:'row', alignItems:'center', gap:12, flex:1, minWidth:0 },
  triggerIcon: { width:32, height:32, borderRadius:10, backgroundColor:'#eff6ff', alignItems:'center', justifyContent:'center', flexShrink:0 },
  triggerTextWrap: { flexShrink:1, minWidth:0 },
  triggerLabel: { fontSize:10, fontWeight:'700', color:'#94a3b8', textTransform:'uppercase', letterSpacing:0.5 },
  triggerValue: { fontSize:13, fontWeight:'600', color:'#1e293b' },
  changePill: { backgroundColor:'#fff', borderWidth:1, borderColor:'#e2e8f0', borderRadius:10, paddingHorizontal:10, paddingVertical:4, flexShrink:0 },
  changePillText: { fontSize:11, fontWeight:'700', color:'#2563eb' },

  // Modal card
  modal: { backgroundColor:'#fff', borderRadius:24, paddingTop:24, paddingBottom:24, paddingHorizontal:24, borderWidth:1, borderColor:'#f1f5f9', width:'100%', maxWidth:360, shadowColor:'#0f172a', shadowOffset:{width:0,height:20}, shadowOpacity:0.25, shadowRadius:40, elevation:12 },

  // Modal header
  modalHeader: { flexDirection:'row', alignItems:'flex-start', justifyContent:'space-between', paddingBottom:12, borderBottomWidth:1, borderBottomColor:'#f1f5f9', marginBottom:12 },
  modalTitle: { fontSize:15, fontWeight:'800', color:'#0f172a' },
  modalSelected: { fontSize:12, fontWeight:'600', color:'#2563eb', marginTop:2 },
  closeBtn: { width:32, height:32, borderRadius:16, backgroundColor:'#f1f5f9', alignItems:'center', justifyContent:'center' },

  // Presets
  preset: { marginRight:8, paddingHorizontal:12, paddingVertical:6, borderRadius:10, backgroundColor:'#f1f5f9', borderWidth:1, borderColor:'#e2e8f0' },
  presetText: { fontSize:12, fontWeight:'600', color:'#475569' },

  // Month nav
  monthNav: { flexDirection:'row', alignItems:'center', justifyContent:'space-between', marginBottom:12 },
  monthTitle: { fontSize:15, fontWeight:'800', color:'#0f172a' },
  monthNavBtns: { flexDirection:'row', gap:6 },
  navBtn: { width:32, height:32, borderRadius:10, backgroundColor:'#f1f5f9', alignItems:'center', justifyContent:'center' },

  // Weekdays
  weekRow: { flexDirection:'row', justifyContent:'space-between', marginBottom:8 },
  weekCell: { width:40, alignItems:'center' },
  weekLabel: { fontSize:11, fontWeight:'700', color:'#94a3b8' },
  weekLabelWknd: { color:'#60a5fa' },

  // Day grid
  dayGrid: { flexDirection:'row', flexWrap:'wrap', justifyContent:'space-between', marginBottom:20 },
  dayCell: { width:40, height:40, borderRadius:12, alignItems:'center', justifyContent:'center', marginVertical:4 },
  dayCellSelected: { backgroundColor:'#2563eb', shadowColor:'#2563eb', shadowOffset:{width:0,height:2}, shadowOpacity:0.3, shadowRadius:4, elevation:3 },
  dayCellToday: { backgroundColor:'#eff6ff', borderWidth:1, borderColor:'#bfdbfe' },
  dayText: { fontSize:13, fontWeight:'700' },
  dayTextNormal: { color:'#1e293b' },
  dayTextSelected: { color:'#fff' },
  dayTextToday: { color:'#2563eb' },
  dayTextDisabled: { color:'#cbd5e1' },

  // Actions
  actions: { flexDirection:'row', gap:12 },
  cancelBtn: { flex:1, paddingVertical:14, backgroundColor:'#f1f5f9', borderRadius:16, alignItems:'center', justifyContent:'center' },
  cancelText: { fontSize:13, fontWeight:'700', color:'#475569' },
  confirmBtn: { flex:1, paddingVertical:14, backgroundColor:'#2563eb', borderRadius:16, alignItems:'center', justifyContent:'center', shadowColor:'#2563eb', shadowOffset:{width:0,height:4}, shadowOpacity:0.25, shadowRadius:8, elevation:4 },
  confirmInner: { flexDirection:'row', alignItems:'center', gap:6 },
  confirmText: { fontSize:13, fontWeight:'700', color:'#fff' },
});
