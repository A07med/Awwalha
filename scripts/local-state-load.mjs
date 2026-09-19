import { execFileSync } from 'node:child_process'

const output = execFileSync('supabase', ['status', '-o', 'env'], { encoding: 'utf8' })
const values = Object.fromEntries(output.split('\n').filter((line) => line.includes('=')).map((line) => {
  const at = line.indexOf('=')
  return [line.slice(0, at), line.slice(at + 1).replace(/^"|"$/g, '')]
}))
const url = values.API_URL + '/rest/v1/rpc/public_event_state'
const users = Number(process.env.LOAD_USERS ?? 500)
const timings = []
const statuses = new Map()

await Promise.all(Array.from({ length: users }, async (_, index) => {
  await new Promise((resolve) => setTimeout(resolve, Math.random() * 900))
  const started = performance.now()
  const response = await fetch(url, { method: 'POST', headers: { apikey: values.ANON_KEY, authorization: 'Bearer ' + values.ANON_KEY, 'content-type': 'application/json' }, body: '{}' })
  await response.arrayBuffer()
  timings[index] = performance.now() - started
  statuses.set(response.status, (statuses.get(response.status) ?? 0) + 1)
}))

timings.sort((a, b) => a - b)
const percentile = (p) => timings[Math.min(timings.length - 1, Math.floor(timings.length * p))]
console.log(JSON.stringify({ users, requests: timings.length, statuses: Object.fromEntries(statuses), p50Ms: Math.round(percentile(.5)), p95Ms: Math.round(percentile(.95)), p99Ms: Math.round(percentile(.99)) }))
