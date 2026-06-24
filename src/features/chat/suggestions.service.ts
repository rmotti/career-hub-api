/**
 * Follow-up suggestion chips for the chat UI. Deliberately formation-agnostic and fixed: the save
 * stores no formation, so we cannot derive "Scout left-backs" style chips from squad gaps without
 * assuming a shape (4-3-3) the user never confirmed — that assumption is exactly what produced the
 * phantom left-back prompts. These neutral chips funnel the user into flows where Junior asks for
 * the formation first. The signature stays async/(userId, saveId) so callers don't change.
 */
const NEUTRAL_SUGGESTIONS = [
  'What does my squad need?',
  'Plan my transfer window',
  'Review my shortlist',
]

export async function getSaveSuggestions(_userId: string, _saveId: string): Promise<string[]> {
  return NEUTRAL_SUGGESTIONS
}
