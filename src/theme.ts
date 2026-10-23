import { useColorScheme } from 'react-native';
import type { Priority, TaskStatus } from './lib/types';

const light = {
  bg: '#F6F6F9',
  card: '#FFFFFF',
  text: '#16161D',
  muted: '#6B6B7B',
  border: '#E4E4EC',
  primary: '#4F46E5',
  primaryText: '#FFFFFF',
  primarySoft: '#EEF0FF',
  danger: '#DC2626',
  dangerSoft: '#FDECEC',
  success: '#15803D',
  warning: '#B45309',
  input: '#FFFFFF',
};

const dark: typeof light = {
  bg: '#0E0E13',
  card: '#191920',
  text: '#F2F2F7',
  muted: '#9C9CAE',
  border: '#2C2C36',
  primary: '#8B85FF',
  primaryText: '#0E0E13',
  primarySoft: '#25233F',
  danger: '#F87171',
  dangerSoft: '#3A1D1D',
  success: '#4ADE80',
  warning: '#FBBF24',
  input: '#1F1F27',
};

export type Palette = typeof light;

export function useTheme(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}

export const STATUS_COLOR: Record<TaskStatus, string> = {
  todo: '#64748B',
  in_progress: '#2563EB',
  blocked: '#DC2626',
  review: '#9333EA',
  done: '#16A34A',
};

export const PRIORITY_COLOR: Record<Priority, string> = {
  low: '#64748B',
  medium: '#0EA5E9',
  high: '#F59E0B',
  urgent: '#EF4444',
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };
