// Design tokens. Colours were chosen for WCAG AA contrast against their intended backgrounds.
export const colors = {
  background: '#F7F9FC',
  surface: '#FFFFFF',
  border: '#DCE3EC',
  text: '#13203A',
  textMuted: '#4F5D75',
  navy: '#1B2A4A',
  navyLight: '#E8EDF6',
  primary: '#1B2A4A',
  onPrimary: '#FFFFFF',
  safe: '#0B7A6B',
  safeLight: '#E2F4F1',
  warning: '#8A5A00',
  warningBg: '#FFF4D9',
  warningBorder: '#F2B632',
  danger: '#B3261E',
  dangerDark: '#8C1D18',
  dangerLight: '#FDECEA',
  onDanger: '#FFFFFF',
  neutralBadge: '#E7EAF0',
  focus: '#2F6FED',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };

export const typography = {
  title: { fontSize: 24, fontWeight: '700' as const, color: colors.text },
  heading: { fontSize: 18, fontWeight: '700' as const, color: colors.text },
  body: { fontSize: 16, color: colors.text, lineHeight: 22 },
  bodyMuted: { fontSize: 15, color: colors.textMuted, lineHeight: 21 },
  label: { fontSize: 14, fontWeight: '600' as const, color: colors.text },
  small: { fontSize: 13, color: colors.textMuted },
};

export const shadow = {
  shadowColor: '#0B1730',
  shadowOpacity: 0.08,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 2 },
  elevation: 2,
};

/** Minimum touch target (Android accessibility guideline: 48dp). */
export const TOUCH_TARGET = 48;
