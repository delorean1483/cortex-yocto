// Password rules, mirroring the Cognito pool policy in cloud/terraform/cognito.tf.
// The server (Cognito) has the final say; this only catches mistakes early.

export const PASSWORD_HINT =
  'At least 12 characters, with an uppercase letter, a lowercase letter, a number and a symbol.'

const RULES = [
  [(pw) => pw.length >= 12, '12+ characters'],
  [(pw) => /[A-Z]/.test(pw), 'an uppercase letter'],
  [(pw) => /[a-z]/.test(pw), 'a lowercase letter'],
  [(pw) => /[0-9]/.test(pw), 'a number'],
  [(pw) => /[^A-Za-z0-9\s]/.test(pw), 'a symbol'],
]

const joinList = (items) =>
  items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`

// null when the password passes, otherwise one sentence saying what's missing.
export function passwordProblem(pw) {
  const s = String(pw || '')
  if (/^\s|\s$/.test(s)) return "Can't start or end with a space."
  const missing = RULES.filter(([ok]) => !ok(s)).map(([, what]) => what)
  return missing.length ? `Needs ${joinList(missing)}.` : null
}

// For an admin to hand out: no 0/O, 1/l/I, so it survives being read aloud or texted.
const UPPER  = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const LOWER  = 'abcdefghijkmnopqrstuvwxyz'
const DIGIT  = '23456789'
const SYMBOL = '!@#%*-_=+?'

function pick(chars) {
  const [n] = crypto.getRandomValues(new Uint32Array(1))
  return chars[n % chars.length]
}

export function generatePassword(length = 16) {
  const all = UPPER + LOWER + DIGIT + SYMBOL
  const chars = [pick(UPPER), pick(LOWER), pick(DIGIT), pick(SYMBOL)]
  while (chars.length < length) chars.push(pick(all))
  for (let i = chars.length - 1; i > 0; i--) {
    const [n] = crypto.getRandomValues(new Uint32Array(1))
    const j = n % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}
