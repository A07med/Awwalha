import { execFileSync } from 'node:child_process'

const forbidden = [
  ['realtime channels', '(postgres_changes|\\.channel\\(|\\.subscribe\\()'],
  ['presence', '(Presence|presenceState|track\\()'],
  ['fixed interval polling', 'setInterval\\('],
  ['participant heartbeat', '(last_seen|heartbeat)'],
]

let failed = false
for (const [label, pattern] of forbidden) {
  try {
    const output = execFileSync('rg', ['-n', pattern, 'src', 'api', 'supabase/migrations'], { encoding: 'utf8' })
    if (output.trim()) { console.error('FAIL ' + label + '\n' + output); failed = true }
  } catch (error) {
    if (error.status !== 1) throw error
  }
}
if (failed) process.exit(1)
console.log('PASS: no audience Realtime, Presence, fixed intervals, or heartbeat writes found.')
