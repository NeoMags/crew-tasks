import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import React, { useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { formatDue } from '../lib/logic';
import { radius, useTheme } from '../theme';
import { Button } from './ui';

/** Picks a date, then a time. Android uses the native dialogs; iOS shows an inline picker. */
export function pickDateTime(initial: Date, onPicked: (d: Date) => void) {
  if (Platform.OS !== 'android') return;
  DateTimePickerAndroid.open({
    value: initial,
    mode: 'date',
    minimumDate: new Date(Date.now() - 365 * 86_400_000),
    onValueChange: (_e, date) => {
      DateTimePickerAndroid.open({
        value: date,
        mode: 'time',
        onValueChange: (_e2, time) => {
          const merged = new Date(date);
          merged.setHours(time.getHours(), time.getMinutes(), 0, 0);
          onPicked(merged);
        },
      });
    },
  });
}

export function defaultDue(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(18, 0, 0, 0);
  return d;
}

export function DateTimeField({
  label,
  value,
  onChange,
  clearable = true,
}: {
  label: string;
  value: Date | null;
  onChange: (d: Date | null) => void;
  clearable?: boolean;
}) {
  const c = useTheme();
  const [iosOpen, setIosOpen] = useState(false);
  const open = () => (Platform.OS === 'android' ? pickDateTime(value ?? defaultDue(), onChange) : setIosOpen((o) => !o));

  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: c.text, fontWeight: '600' }}>{label}</Text>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${value ? formatDue(value.getTime()) : 'not set'}`}
          onPress={open}
          style={{
            flex: 1,
            borderWidth: 1,
            borderColor: c.border,
            backgroundColor: c.input,
            borderRadius: radius.md,
            paddingHorizontal: 14,
            paddingVertical: 12,
          }}
        >
          <Text style={{ color: value ? c.text : c.muted, fontSize: 16 }}>
            {value ? formatDue(value.getTime()) : 'No date'}
          </Text>
        </Pressable>
        {clearable && value ? <Button title="Clear" variant="ghost" compact onPress={() => onChange(null)} /> : null}
      </View>
      {Platform.OS === 'ios' && iosOpen ? (
        <DateTimePicker
          value={value ?? defaultDue()}
          mode="datetime"
          display="inline"
          onValueChange={(_e, d) => onChange(d)}
        />
      ) : null}
    </View>
  );
}
