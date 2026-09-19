import http from 'k6/http'
import { check } from 'k6'

export const baseUrl = __ENV.BASE_URL || 'http://127.0.0.1:54321'
export const anonKey = __ENV.SUPABASE_ANON_KEY || ''

export function rpc(name, body) {
  return http.post(baseUrl + '/rest/v1/rpc/' + name, JSON.stringify(body), { headers: { apikey: anonKey, Authorization: 'Bearer ' + anonKey, 'Content-Type': 'application/json' } })
}

export function accepted(response, label) {
  check(response, { [label]: (item) => item.status >= 200 && item.status < 300 })
}
