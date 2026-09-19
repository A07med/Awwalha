export function normalizeOmanPhone(input: string): string | null {
  const digits = input.replace(/\D/g, '')
  const local = digits.startsWith('968') ? digits.slice(3) : digits
  if (!/^[279][0-9]{7}$/.test(local)) return null
  return '+968' + local
}
