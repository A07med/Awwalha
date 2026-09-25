import { createClient } from '@supabase/supabase-js'
import type { PublicEventState, RegisterResult } from '../types'
import { normalizeOmanPhone } from './phone'
import { prepareRegistration, readPendingRegistration } from './session'

const isSupabaseMode = import.meta.env.VITE_APP_MODE === 'supabase'
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
export const supabase = isSupabaseMode && url && key ? createClient(url, key, { auth: { persistSession: true } }) : null

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('الخدمة تعمل الآن في وضع العرض')
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw new Error(error.message)
  return data as T
}

export async function fetchPublicState(signal?: AbortSignal): Promise<PublicEventState> {
  const response = await fetch('/api/state', { signal, headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error('تعذر تحديث حالة الأمسية')
  return response.json() as Promise<PublicEventState>
}

export async function registerParticipant(displayName: string, phoneInput: string): Promise<RegisterResult> {
  const phone = normalizeOmanPhone(phoneInput)
  if (!phone) throw new Error('أدخل رقمًا عمانيًا صحيحًا')
  const previous = readPendingRegistration()
  const pending = prepareRegistration(displayName, phone)
  // The staging failure appeared only when 1,000 clients entered PostgREST
  // together. Spread *new* registrations below the measured healthy 500/3s
  // arrival rate; retries with retained credentials should resolve promptly.
  if (previous?.token !== pending.token) {
    await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 8000)))
  }
  return rpc('register_participant', {
    p_display_name: pending.displayName,
    p_phone: pending.phone,
    p_session_token: pending.token,
    p_recovery_code: pending.recoveryCode,
  })
}

export async function recoverParticipant(phoneInput: string, recoveryCode: string): Promise<Omit<RegisterResult, 'recoveryCode'>> {
  const phone = normalizeOmanPhone(phoneInput)
  if (!phone) throw new Error('أدخل رقمًا عمانيًا صحيحًا')
  return rpc('recover_participant_session', { p_phone: phone, p_recovery_code: recoveryCode.trim().toUpperCase() })
}

export async function submitPerfectSecond(token: string, roundId: string, elapsedMs: number, metadata: Record<string, unknown>) {
  return rpc<{ elapsedMs: number; signedDeltaMs: number }>('submit_perfect_second', {
    p_session_token: token,
    p_round_id: roundId,
    p_elapsed_ms: Math.round(elapsedMs),
    p_timing_metadata: metadata,
  })
}

export async function submitFirstLook(token: string, roundId: string, guess: number) {
  return rpc<{ guess: number }>('submit_first_look', { p_session_token: token, p_round_id: roundId, p_guess: guess })
}

export async function joinTaifRound(token: string, roundId: string) {
  return rpc<{ ready: true; alreadyReady: boolean }>('join_taif_round', { p_session_token: token, p_round_id: roundId })
}

export async function adminPrepareRound(input: {
  gameType: 'perfect_second' | 'first_look'; winnerCount: number; targetMs?: number; hideTimerAfterMs?: number; correctCount?: number; visualSeed?: number; visualCategory?: string; displayDurationMs?: number
}) {
  return rpc<{ roundId: string; startsAt: string }>('admin_prepare_round', {
    p_request_id: crypto.randomUUID(),
    p_game_type: input.gameType,
    p_winner_target_count: input.winnerCount,
    p_target_ms: input.targetMs ?? null,
    p_hide_timer_after_ms: input.hideTimerAfterMs ?? null,
    p_correct_count: input.correctCount ?? null,
    p_visual_seed: input.visualSeed ?? null,
    p_visual_category: input.visualCategory ?? null,
    p_display_duration_ms: input.displayDurationMs ?? null,
  })
}

export const adminSetRegistration = (open: boolean) => rpc('admin_set_registration', { p_open: open, p_request_id: crypto.randomUUID() })
export const adminPrepareTaif = () => rpc<{ roundId: string }>('admin_prepare_taif', { p_request_id: crypto.randomUUID() })
export const adminStartTaif = (roundId: string) => rpc<{ roundId: string; startsAt: string; revealAt: string; winnerCount: number }>('admin_start_taif', { p_round_id: roundId, p_request_id: crypto.randomUUID() })
export const adminCloseRound = (roundId: string) => rpc('admin_close_round', { p_round_id: roundId, p_request_id: crypto.randomUUID() })
export const adminResolveRound = (roundId: string) => rpc('admin_resolve_round', { p_round_id: roundId, p_request_id: crypto.randomUUID() })
export const adminStartTieBreak = (roundId: string) => rpc('admin_start_tie_break', { p_parent_round_id: roundId, p_request_id: crypto.randomUUID() })
export const adminRevealWinners = (roundId: string) => rpc('admin_reveal_winners', { p_round_id: roundId, p_request_id: crypto.randomUUID() })
export const adminResetGames = () => rpc('admin_reset_games', { p_request_id: crypto.randomUUID() })
export const adminClearRegistrations = () => rpc('admin_clear_registrations', { p_request_id: crypto.randomUUID(), p_confirmation: 'DELETE ALL REGISTRATIONS' })

export async function adminRoundDetail(roundId: string) {
  return rpc<{ correctCount: number; visualSeed: number; visualCategory: 'seeds' | 'leaves' | 'fish' | 'bubbles' | 'drops'; displayDurationMs: number }>('admin_round_detail', { p_round_id: roundId })
}
