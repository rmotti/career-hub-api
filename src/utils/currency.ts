const CURRENCY_PATTERN = /^€(\d+(?:\.\d+)?)(K|M)$/

export function formatCurrency(value: number): string {
  if (value < 1_000_000) {
    const k = value / 1000
    const formatted = k % 1 === 0 ? String(k) : String(parseFloat(k.toFixed(2)))
    return `€${formatted}K`
  }
  const m = value / 1_000_000
  const formatted = m % 1 === 0 ? String(m) : String(parseFloat(m.toFixed(2)))
  return `€${formatted}M`
}

export function parseCurrency(value: string): number {
  const match = value.match(CURRENCY_PATTERN)
  if (!match) throw new Error(`Invalid currency format: "${value}"`)
  const num = parseFloat(match[1])
  return match[2] === 'K' ? num * 1000 : num * 1_000_000
}

export function isValidCurrencyFormat(value: string): boolean {
  return CURRENCY_PATTERN.test(value)
}
