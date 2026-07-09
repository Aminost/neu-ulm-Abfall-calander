// A small, calm design system. One warm neutral background, one accent,
// generous spacing and rounded cards. Kept as plain constants so screens can
// compose StyleSheets without a CSS-in-JS dependency.

import type { HighlightType, Severity } from "./types";

export const colors = {
  bg: "#F7F6F2",
  surface: "#FFFFFF",
  surfaceAlt: "#F0EEE8",
  border: "#E5E2D9",
  text: "#1C1B19",
  textMuted: "#6E6A60",
  textFaint: "#9C978B",
  accent: "#2F6F5E", // deep teal-green
  accentSoft: "#E2EFEA",
  white: "#FFFFFF",

  // semantic highlight colors
  deadline: "#C2410C", // amber/orange
  payment: "#2563A6", // blue
  critical: "#B42318", // red
  action: "#6B5BD2", // violet
  ok: "#2F6F5E",
};

export const highlightColor: Record<HighlightType, string> = {
  deadline: colors.deadline,
  payment: colors.payment,
  critical: colors.critical,
  action: colors.action,
};

export const highlightLabel: Record<HighlightType, string> = {
  deadline: "Deadline",
  payment: "Payment",
  critical: "Critical",
  action: "Action",
};

export const severityWeight: Record<Severity, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 18,
  pill: 999,
};

export const font = {
  h1: 28,
  h2: 22,
  h3: 18,
  body: 15,
  small: 13,
  tiny: 11,
};

export const shadow = {
  card: {
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
};
