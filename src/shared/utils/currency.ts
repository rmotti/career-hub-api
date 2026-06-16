// Two coexisting money units in the domain, distinguished by the type system so the
// compiler catches unit mixups at call sites (#14 — the off-by-1000 footgun):
//   - salary / wage bill:                    thousands of € (75 = €75K)
//   - marketValue, fee, budget, balance:     millions of €  (35 = €35M, 0.9 = €900K)
declare const thousandsBrand: unique symbol
declare const millionsBrand: unique symbol
export type Thousands = number & { readonly [thousandsBrand]: true }
export type Millions = number & { readonly [millionsBrand]: true }

// Null-preserving brand constructors. Tag a raw number with its unit at the boundary
// (Prisma row / request body) before it flows into formatting or arithmetic. Wrapping
// the wrong field (e.g. `thousands(budget)`) is the visible red flag; passing a value
// of one unit to a helper expecting the other is a compile error.
export function thousands(value: number): Thousands
export function thousands(value: number | null | undefined): Thousands | null
export function thousands(value: number | null | undefined): Thousands | null {
  return value == null ? null : (value as Thousands)
}

export function millions(value: number): Millions
export function millions(value: number | null | undefined): Millions | null
export function millions(value: number | null | undefined): Millions | null {
  return value == null ? null : (value as Millions)
}

// marketValue, fee — stored in millions (35 = €35M, 0.9 = €900K)
export function formatMarketValue(val: Millions | null | undefined): string {
  if (val == null) return '—'
  if (val >= 1) return `€${val}M`
  return `€${Math.round(val * 1000)}K`
}

// salary — stored in thousands (75 = €75K)
export function formatSalary(val: Thousands | null | undefined): string {
  if (val == null) return '—'
  return `€${val}K`
}

// balance and budget share the same unit as marketValue (millions)
export const formatBalance = formatMarketValue
