/**
 * Premium Recharts theme for dark mode.
 * Import and spread onto chart components for consistent styling.
 */

export const chartColors = {
  primary: "hsl(152, 55%, 55%)",
  scope1: "hsl(45, 93%, 47%)",
  scope2: "hsl(217, 91%, 60%)",
  scope3: "hsl(280, 60%, 65%)",
  accent: "hsl(162, 60%, 50%)",
  grid: "hsl(160, 15%, 16%)",
  text: "hsl(155, 10%, 60%)",
} as const;

export const CHART_PALETTE = [
  chartColors.primary,
  chartColors.scope1,
  chartColors.scope2,
  chartColors.scope3,
  chartColors.accent,
  "hsl(0, 84%, 60%)",
];

export const gridProps = {
  stroke: chartColors.grid,
  strokeDasharray: "3 3",
} as const;

export const axisTickProps = {
  fontSize: 11,
  fill: chartColors.text,
} as const;

export const tooltipStyle = {
  contentStyle: {
    background: "hsl(152, 35%, 12%)",
    border: "1px solid hsl(152, 40%, 25%)",
    borderRadius: "8px",
    backdropFilter: "blur(24px)",
    color: "hsl(150, 8%, 95%)",
    fontSize: "12px",
  },
  itemStyle: {
    color: "hsl(150, 8%, 95%)",
  },
} as const;
