import { accepted, rpc } from './helpers.js'
export const options = { scenarios: { stop_spike: { executor: 'shared-iterations', vus: 500, iterations: 500, maxDuration: '15s' } }, thresholds: { http_req_failed: ['rate<0.01'], http_req_duration: ['p(95)<500'] } }
export default function () { accepted(rpc('submit_perfect_second', { p_session_token: __ENV['TOKEN_' + __VU], p_round_id: __ENV.ROUND_ID, p_elapsed_ms: 5500 + Math.floor(Math.random() * 1000), p_timing_metadata: { load_test: true } }), 'single O(1) attempt accepted') }
