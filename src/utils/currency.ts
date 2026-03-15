// marketValue, balance, budget, fee — stored in millions (35 = €35M, 0.9 = €900K)
export function formatMarketValue(val: number | null | undefined): string {
  if (val == null) return '—'
  if (val >= 1) return `€${val}M`
  return `€${Math.round(val * 1000)}K`
}

// salary — stored in thousands (75 = €75K)
export function formatSalary(val: number | null | undefined): string {
  if (val == null) return '—'
  return `€${val}K`
}

// balance and budget share the same unit as marketValue
export const formatBalance = formatMarketValue
