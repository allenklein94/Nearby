// A customer-message alert (business_message_received, 20270428) opens the business inbox ON that conversation.
//
// The alert carries only the message id + business id (never the customer or the text). The dashboard re-reads that ONE
// message under the owner's own access (RLS: only the business's managers and the customer can read it), then opens its
// conversation from the inbox list it already loads. Pure rule, so it is testable without the screen:
//   row missing (deleted, another business's message, blocked) or for another location -> 'list' (the inbox, no error)
//   conversation not in the loaded list yet                                           -> 'wait' (re-checked on the next load)
//   found                                                                              -> 'open' that conversation
export function messageFocusPlan(row, selectedPartnerId, conversations, { conversationsLoaded = false } = {}) {
  if (!row || !row.conversation_with_id || !selectedPartnerId || row.partner_id !== selectedPartnerId) return { kind: 'list' };
  const convo = (conversations ?? []).find((c) => c.userId === row.conversation_with_id) ?? null;
  if (convo) return { kind: 'open', convo };
  return conversationsLoaded ? { kind: 'list' } : { kind: 'wait' };
}
