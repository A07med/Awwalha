import { accepted, rpc } from './helpers.js'
export const options = { scenarios: { answer_spike: { executor: 'shared-iterations', vus: 500, iterations: 500, maxDuration: '15s' } }, thresholds: { http_req_failed: ['rate<0.01'], http_req_duration: ['p(95)<500'] } }
export default function () { accepted(rpc('submit_first_look', { p_session_token: __ENV['TOKEN_' + __VU], p_round_id: __ENV.ROUND_ID, p_guess: 20 + Math.floor(Math.random() * 41) }), 'single O(1) answer accepted') }
