import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { radius, space, useTheme } from '../theme';

export function Screen({
  children,
  scroll = true,
  padded = true,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  padded?: boolean;
}) {
  const c = useTheme();
  const style = { padding: padded ? space.lg : 0, gap: space.md, paddingBottom: space.xl * 2 };
  if (!scroll) return <View style={[{ flex: 1, backgroundColor: c.bg }, style]}>{children}</View>;
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={style}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useTheme();
  return (
    <View
      style={[
        { backgroundColor: c.card, borderRadius: radius.lg, padding: space.lg, gap: space.sm, borderWidth: 1, borderColor: c.border },
        style,
      ]}
    >
      {children}
    </View>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading,
  disabled,
  icon,
  compact,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  compact?: boolean;
}) {
  const c = useTheme();
  const bg = { primary: c.primary, secondary: c.primarySoft, danger: c.dangerSoft, ghost: 'transparent' }[variant];
  const fg = { primary: c.primaryText, secondary: c.primary, danger: c.danger, ghost: c.primary }[variant];
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: off ? 0.55 : pressed ? 0.8 : 1 },
        compact && { paddingVertical: 8, paddingHorizontal: 12 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={18} color={fg} /> : null}
          <Text style={{ color: fg, fontWeight: '600', fontSize: compact ? 14 : 16 }}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({
  name,
  onPress,
  label,
  color,
}: {
  name: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  label: string;
  color?: string;
}) {
  const c = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={10} onPress={onPress} style={{ padding: 4 }}>
      <Ionicons name={name} size={22} color={color ?? c.primary} />
    </Pressable>
  );
}

export function TextField({
  label,
  error,
  hint,
  ...props
}: TextInputProps & { label?: string; error?: string | null; hint?: string }) {
  const c = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {label ? <Text style={{ color: c.text, fontWeight: '600' }}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={c.muted}
        {...props}
        style={[
          styles.input,
          { backgroundColor: c.input, color: c.text, borderColor: error ? c.danger : c.border },
          props.multiline && { minHeight: 90, textAlignVertical: 'top' },
          props.style,
        ]}
      />
      {error ? <Text style={{ color: c.danger, fontSize: 13 }}>{error}</Text> : null}
      {!error && hint ? <Text style={{ color: c.muted, fontSize: 13 }}>{hint}</Text> : null}
    </View>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  color,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  color?: string;
}) {
  const c = useTheme();
  const accent = color ?? c.primary;
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={{
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: selected ? accent : c.border,
        backgroundColor: selected ? accent + '22' : c.card,
      }}
    >
      <Text style={{ color: selected ? accent : c.text, fontWeight: selected ? '600' : '400', fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}

export function Pill({ label, color }: { label: string; color: string }) {
  return (
    <View style={{ paddingVertical: 2, paddingHorizontal: 8, borderRadius: radius.pill, backgroundColor: color + '22' }}>
      <Text style={{ color, fontSize: 12, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

export function ProgressBar({ value, color }: { value: number; color?: string }) {
  const c = useTheme();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: value }}
      style={{ height: 6, borderRadius: 3, backgroundColor: c.border, overflow: 'hidden' }}
    >
      <View style={{ width: `${Math.max(0, Math.min(100, value))}%`, height: '100%', backgroundColor: color ?? c.primary }} />
    </View>
  );
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  const c = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.sm }}>
      <Text style={{ color: c.muted, fontWeight: '700', fontSize: 13, letterSpacing: 0.6, textTransform: 'uppercase' }}>
        {children}
      </Text>
      {right}
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  const c = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: space.xl * 1.5, gap: space.sm }}>
      <Ionicons name={icon} size={44} color={c.muted} />
      <Text style={{ color: c.text, fontSize: 17, fontWeight: '600', textAlign: 'center' }}>{title}</Text>
      {body ? <Text style={{ color: c.muted, textAlign: 'center', maxWidth: 300 }}>{body}</Text> : null}
      {action ? <View style={{ marginTop: space.sm }}>{action}</View> : null}
    </View>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const c = useTheme();
  return (
    <View style={{ backgroundColor: c.dangerSoft, padding: space.md, borderRadius: radius.md, gap: space.sm }}>
      <Text style={{ color: c.danger }}>{message}</Text>
      {onRetry ? <Button title="Try again" variant="ghost" compact onPress={onRetry} /> : null}
    </View>
  );
}

export function Loading() {
  const c = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg }}>
      <ActivityIndicator color={c.primary} size="large" />
    </View>
  );
}

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const c = useTheme();
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
  // Stable hue per name so friends are easy to tell apart.
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return (
    <View
      accessible
      accessibilityLabel={name}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: `hsl(${h}, 55%, 55%)`,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 2,
        borderColor: c.card,
      }}
    >
      <Text style={{ color: '#fff', fontWeight: '700', fontSize: size * 0.38 }}>{initials || '?'}</Text>
    </View>
  );
}

export function Muted({ children, style }: { children: React.ReactNode; style?: object }) {
  const c = useTheme();
  return <Text style={[{ color: c.muted, fontSize: 14 }, style]}>{children}</Text>;
}

export function Body({ children, style, numberOfLines }: { children: React.ReactNode; style?: object; numberOfLines?: number }) {
  const c = useTheme();
  return (
    <Text numberOfLines={numberOfLines} style={[{ color: c.text, fontSize: 15, lineHeight: 21 }, style]}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    paddingHorizontal: 18,
    borderRadius: radius.md,
  },
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
});
