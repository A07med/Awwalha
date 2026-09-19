import http from 'k6/http'
import { check, sleep } from 'k6'

export const options = { scenarios: { audience: { executor: 'ramping-vus', startVUs: 10, stages: [{ target: 50, duration: '10s' }, { target: 100, duration: '10s' }, { target: 200, duration: '10s' }, { target: 300, duration: '10s' }, { target: 500, duration: '10s' }] } }, thresholds: { http_req_failed: ['rate<0.01'], http_req_duration: ['p(95)<300'] } }
const appUrl = __ENV.APP_URL || 'http://localhost:4173'
export default function () { const response = http.get(appUrl + '/api/state'); check(response, { 'state is safe': (item) => item.status === 200 && !item.body.includes('phone') && !item.body.includes('correct_count') }); sleep(6 + Math.random() * 4) }
