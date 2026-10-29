import { alpha, createTheme, type Theme } from '@mui/material/styles';

/** SmartNest design tokens. Use these (or theme.palette) instead of raw hex values in components. */
export const tokens = {
  color: {
    primary: '#386641',
    primaryDeep: '#274C35',
    sage: '#E4EBDD',
    background: '#F7F6F0',
    surface: '#FFFFFF',
    text: '#252A27',
    textSecondary: '#737971',
    orange: '#F28C28',
    terracotta: '#C96F52',
    success: '#37845A',
    warning: '#D99A32',
    error: '#C94F45',
    border: '#E6E4DC',
    disabled: '#EEEDE7',
  },
  radius: { sm: 10, md: 16, lg: 22, xl: 28, pill: 999 },
  shadow: {
    card: '0 1px 2px rgba(37, 42, 39, 0.04), 0 4px 16px rgba(37, 42, 39, 0.05)',
    raised: '0 2px 4px rgba(37, 42, 39, 0.06), 0 12px 32px rgba(37, 42, 39, 0.10)',
  },
  motion: { fast: 0.15, base: 0.2, slow: 0.25 },
  font: '"DM Sans Variable", "DM Sans", Inter, system-ui, -apple-system, "Segoe UI", sans-serif',
} as const;

declare module '@mui/material/styles' {
  interface Palette {
    sage: Palette['primary'];
    accent: Palette['primary'];
    terracotta: Palette['primary'];
    border: string;
    disabledSurface: string;
  }
  interface PaletteOptions {
    sage?: PaletteOptions['primary'];
    accent?: PaletteOptions['primary'];
    terracotta?: PaletteOptions['primary'];
    border?: string;
    disabledSurface?: string;
  }
}

const c = tokens.color;

export const theme: Theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: c.primary, dark: c.primaryDeep, light: '#5A8A63', contrastText: '#FFFFFF' },
    secondary: { main: c.terracotta, contrastText: '#FFFFFF' },
    accent: { main: c.orange, dark: '#C96F1C', light: '#F7B26B', contrastText: '#252A27' },
    terracotta: { main: c.terracotta, contrastText: '#FFFFFF' },
    sage: { main: c.sage, dark: '#CFDCC4', light: '#EEF3EA', contrastText: c.primaryDeep },
    success: { main: c.success, contrastText: '#FFFFFF' },
    warning: { main: c.warning, dark: '#9A6A1C', contrastText: '#252A27' },
    error: { main: c.error, contrastText: '#FFFFFF' },
    info: { main: '#4F7A8A' },
    background: { default: c.background, paper: c.surface },
    text: { primary: c.text, secondary: c.textSecondary, disabled: '#A3A79F' },
    divider: c.border,
    border: c.border,
    disabledSurface: c.disabled,
    action: { hover: alpha(c.primary, 0.06), selected: alpha(c.primary, 0.1), disabledBackground: c.disabled, focus: alpha(c.primary, 0.16) },
  },
  shape: { borderRadius: tokens.radius.md },
  typography: {
    fontFamily: tokens.font,
    h1: { fontSize: '2rem', fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.2 },
    h2: { fontSize: '1.625rem', fontWeight: 700, letterSpacing: '-0.015em', lineHeight: 1.25 },
    h3: { fontSize: '1.3rem', fontWeight: 650, letterSpacing: '-0.01em' },
    h4: { fontSize: '1.125rem', fontWeight: 650 },
    h5: { fontSize: '1rem', fontWeight: 650 },
    h6: { fontSize: '0.95rem', fontWeight: 650 },
    subtitle1: { fontWeight: 600 },
    subtitle2: { fontWeight: 600, fontSize: '0.875rem' },
    body1: { fontSize: '0.95rem' },
    body2: { fontSize: '0.875rem' },
    caption: { fontSize: '0.78rem', color: c.textSecondary },
    overline: { fontWeight: 700, letterSpacing: '0.08em', fontSize: '0.7rem' },
    button: { textTransform: 'none', fontWeight: 600, letterSpacing: 0 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { backgroundColor: c.background, WebkitFontSmoothing: 'antialiased' },
        '*:focus-visible': { outline: `3px solid ${alpha(c.primary, 0.55)}`, outlineOffset: 2, borderRadius: 6 },
        '@media (prefers-reduced-motion: reduce)': {
          '*, *::before, *::after': { animationDuration: '0.01ms !important', transitionDuration: '0.01ms !important' },
        },
      },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: { root: { backgroundImage: 'none' }, rounded: { borderRadius: tokens.radius.lg } },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: { root: { borderRadius: tokens.radius.lg, border: `1px solid ${c.border}`, boxShadow: tokens.shadow.card } },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: tokens.radius.pill, paddingInline: 18, minHeight: 40 },
        sizeSmall: { minHeight: 32, paddingInline: 12 },
        outlined: { borderColor: c.border, '&:hover': { borderColor: c.primary, backgroundColor: alpha(c.primary, 0.04) } },
      },
    },
    MuiIconButton: { styleOverrides: { root: { borderRadius: tokens.radius.sm } } },
    MuiChip: { styleOverrides: { root: { borderRadius: tokens.radius.pill, fontWeight: 600 } } },
    MuiTextField: { defaultProps: { variant: 'outlined', fullWidth: true } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: { borderRadius: tokens.radius.sm + 2, backgroundColor: c.surface, '& .MuiOutlinedInput-notchedOutline': { borderColor: c.border } },
      },
    },
    MuiDialog: { styleOverrides: { paper: { borderRadius: tokens.radius.xl, boxShadow: tokens.shadow.raised } } },
    MuiMenu: { styleOverrides: { paper: { borderRadius: tokens.radius.md, border: `1px solid ${c.border}`, boxShadow: tokens.shadow.raised } } },
    MuiPopover: { styleOverrides: { paper: { borderRadius: tokens.radius.md, border: `1px solid ${c.border}`, boxShadow: tokens.shadow.raised } } },
    MuiTooltip: { styleOverrides: { tooltip: { backgroundColor: c.text, fontSize: '0.78rem', borderRadius: 8 } } },
    MuiSwitch: {
      styleOverrides: {
        root: { width: 52, height: 32, padding: 4 },
        switchBase: { padding: 7, '&.Mui-checked': { transform: 'translateX(20px)', color: '#fff', '& + .MuiSwitch-track': { opacity: 1, backgroundColor: c.primary } } },
        thumb: { width: 18, height: 18, boxShadow: 'none' },
        track: { borderRadius: 16, backgroundColor: '#C9CCC4', opacity: 1 },
      },
    },
    MuiSlider: { styleOverrides: { root: { height: 6 }, thumb: { width: 20, height: 20 }, rail: { opacity: 1, backgroundColor: c.disabled } } },
    MuiTab: { styleOverrides: { root: { textTransform: 'none', fontWeight: 600, minHeight: 44 } } },
    MuiToggleButton: { styleOverrides: { root: { textTransform: 'none', fontWeight: 600, borderColor: c.border } } },
    MuiLinearProgress: { styleOverrides: { root: { borderRadius: 4, backgroundColor: c.disabled } } },
    MuiSkeleton: { defaultProps: { animation: 'wave' }, styleOverrides: { root: { backgroundColor: '#ECEBE4' }, rounded: { borderRadius: tokens.radius.md } } },
    MuiAlert: { styleOverrides: { root: { borderRadius: tokens.radius.md } } },
  },
});
