// PRMX Brand Colors
export const colors = {
  violet: '#8A4AF3',   // Intelligence, Future, Trust
  teal: '#00C48C',     // Security, Success, ROI+
  amber: '#FFA000',    // Action, Redeemable
  magenta: '#FF4081',  // Triggers, Critical Events
} as const

export type BrandColor = keyof typeof colors
