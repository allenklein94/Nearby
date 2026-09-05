import React from 'react';
import { Platform } from 'react-native';
import DateTimePickerNative from '@react-native-community/datetimepicker';

function pad(n) {
  return String(n).padStart(2, '0');
}

function toLocalInputValue(date, mode) {
  if (!date) return '';
  const d = new Date(date);
  const datePart = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const timePart = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (mode === 'date') return datePart;
  if (mode === 'time') return timePart;
  return `${datePart}T${timePart}`;
}

function fromLocalInputValue(value, mode, fallback) {
  if (!value) return fallback ?? null;
  if (mode === 'time') {
    const base = fallback ? new Date(fallback) : new Date();
    const [h, m] = value.split(':').map(Number);
    base.setHours(h, m, 0, 0);
    return base;
  }
  const parsed = new Date(mode === 'date' ? `${value}T00:00` : value);
  return Number.isNaN(parsed.getTime()) ? (fallback ?? null) : parsed;
}

// Phase 7 (Business Web, CLAUDE.md) -- @react-native-community/datetimepicker
// has no react-native-web support at all. On web this renders a plain
// <input> (a real, standard DOM element -- react-native-web/react-dom
// render it directly; this branch never executes on native, so it's a
// no-op dead path there, not a runtime risk). Preserves the exact same
// onChange(event, selectedDate) two-arg signature the native picker uses,
// so an existing call site needs no change beyond swapping the import.
export default function PlatformDateTimeInput({ value, mode = 'datetime', minimumDate, onChange, ...rest }) {
  if (Platform.OS === 'web') {
    const inputType = mode === 'time' ? 'time' : mode === 'date' ? 'date' : 'datetime-local';
    return (
      <input
        type={inputType}
        value={toLocalInputValue(value, mode)}
        min={minimumDate ? toLocalInputValue(minimumDate, mode) : undefined}
        onChange={(e) => onChange({ nativeEvent: {} }, fromLocalInputValue(e.target.value, mode, value))}
        style={{ fontSize: 16, padding: 8, borderRadius: 8, border: '1px solid #ccc', width: '100%' }}
      />
    );
  }
  return <DateTimePickerNative value={value} mode={mode} minimumDate={minimumDate} onChange={onChange} {...rest} />;
}
