import { sleep } from 'k6'
import { accepted, rpc } from './helpers.js'

export const options = {
  scenarios: { spike: { executor: 'ramping-arrival-rate', startRate: 10, timeUnit: '1s', preAllocatedVUs: 50, maxVUs: 500, stages: [{ target: 100, duration: '5s' }, { target: 300, duration: '5s' }, { target: 500, duration: '5s' }] } },
  thresholds: { http_req_failed: ['rate<0.01'], http_req_duration: ['p(95)<500'] },
}

export default function () {
  const suffix = String(__VU).padStart(3, '0') + String(__ITER).padStart(4, '0')
  const phone = '+9689' + suffix.slice(-7)
  accepted(rpc('register_participant', { p_display_name: 'مشارك ' + suffix, p_phone: phone }), 'registration accepted')
  sleep(Math.random() * .25)
}
