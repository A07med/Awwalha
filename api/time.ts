export const config = { runtime: 'edge' }

export default function handler() {
  return new Response(JSON.stringify({ epochMs: Date.now() }), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
    },
  })
}
