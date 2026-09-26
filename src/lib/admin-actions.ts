import type { PublicEventState } from '../types'

export interface ConfirmedAdminTransition {
  roundId: string
  phase: 'closed' | 'resolved' | 'revealed'
  publicPhase: 'closed' | 'resolved' | 'tie_break' | 'revealed'
  closesAt: string | null
}
export function confirmedAdminState(state: PublicEventState, confirmed: ConfirmedAdminTransition | null): PublicEventState {
  if (!confirmed || state.round?.id !== confirmed.roundId) return state
  const rank: Record<string, number> = { preparing: 0, active: 1, closed: 2, resolved: 3, revealed: 4 }
  if ((rank[state.round.phase] ?? 5) > rank[confirmed.phase]) return state
  // An intermediate ISR snapshot may have a newer version than our last
  // poll, but still precede the successful RPC. Do not re-enable old actions.
  return { ...state, phase: confirmed.publicPhase, round: { ...state.round, phase: confirmed.phase, closesAt: confirmed.closesAt } }
}

export function adminRoundActions(state: PublicEventState, closeConfirmed = false) {
  const round = state.round
  const resolved = round?.phase === 'resolved'
  // public_event_state encodes the time-derived closed bucket as version % 4
  // == 2; that does NOT mean admin_close_round has committed yet.
  const scheduledClosed = round?.phase === 'closed' && state.stateVersion % 4 === 2 && !closeConfirmed
  // The backend sets public_phase=tie_break only for an actual cutoff tie.
  // tieEligiblePublicIds describe the CHILD's eligibility, not the parent tie.
  const tie = resolved && state.phase === 'tie_break'
  return {
    close: !!round && round.gameType !== 'taif' && (['preparing', 'active'].includes(round.phase) || scheduledClosed),
    resolve: round?.phase === 'closed' && !scheduledClosed && (!round.closesAt || Date.now() > Date.parse(round.closesAt) + 3000),
    tie: !!tie,
    reveal: !!resolved && state.phase === 'resolved',
  }
}

const messages: Record<string, string> = {
  round_not_closeable: 'الجولة مغلقة بالفعل أو لا يمكن إغلاقها الآن',
  round_not_closed: 'أغلق الجولة أولًا ثم احسب النتيجة',
  parent_not_resolved: 'احسب نتيجة الجولة أولًا',
  no_tie_break_needed: 'لا توجد حاجة لجولة فاصلة',
  round_not_resolved: 'احسب نتيجة الجولة أولًا',
  winner_count_incomplete: 'لم يكتمل عدد الفائزين؛ أكمل الجولة الفاصلة عند الحاجة',
  submission_grace_active: 'انتظر انتهاء مهلة وصول الإرساليات ثم احسب النتيجة',
}
export function adminErrorMessage(reason: unknown) {
  const message = reason instanceof Error ? reason.message : ''
  return messages[message] ?? (/[\u0600-\u06ff]/.test(message) ? message : 'تعذر تنفيذ الإجراء؛ حدّث الحالة وحاول مجددًا')
}
