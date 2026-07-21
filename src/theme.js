export const lightColors = {
  background: '#FFF8F3',
  surface: '#FFFFFF',
  surfaceElevated: '#FFEEE2',
  primary: '#FF6B5B',
  primaryMuted: 'rgba(255, 107, 91, 0.12)',
  textPrimary: '#2D2420',
  textSecondary: '#6B5D54',
  textTertiary: '#A69B92',
  success: '#4CAF7D',
  danger: '#FF6B5B',
  border: '#F0E0D4',
};

export const darkColors = {
  background: '#14141f',
  surface: '#1e1e30',
  surfaceElevated: '#262640',
  primary: '#ff4d6d',
  primaryMuted: 'rgba(255, 77, 109, 0.15)',
  textPrimary: '#ffffff',
  textSecondary: '#a8a8c0',
  textTertiary: '#6e6e8a',
  success: '#4ade80',
  danger: '#ff4d6d',
  border: 'rgba(255, 255, 255, 0.08)',
};

export const typography = {
  display: { fontSize: 34, fontWeight: '800', letterSpacing: -0.5 },
  title: { fontSize: 26, fontWeight: '700', letterSpacing: -0.3 },
  headline: { fontSize: 20, fontWeight: '700' },
  body: { fontSize: 16, fontWeight: '400', lineHeight: 22 },
  bodyBold: { fontSize: 16, fontWeight: '600' },
  caption: { fontSize: 13, fontWeight: '500' },
  small: { fontSize: 12, fontWeight: '400' },
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const radius = {
  sm: 8,
  md: 14,
  lg: 20,
  full: 999,
};

export function getShadow(isDark) {
  return {
    card: {
      shadowColor: isDark ? '#000' : '#D4A88C',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: isDark ? 0.25 : 0.15,
      shadowRadius: 12,
      elevation: isDark ? 6 : 4,
    },
    button: {
      shadowColor: isDark ? '#ff4d6d' : '#FF6B5B',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: isDark ? 0.3 : 0.25,
      shadowRadius: 8,
      elevation: 4,
    },
  };
}

export const colors = lightColors;
export const shadow = getShadow(false);