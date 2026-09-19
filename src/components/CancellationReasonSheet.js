import React from 'react';
import ActionSheetModal from './ActionSheetModal';
import { CANCELLATION_REASONS, CANCELLATION_REASONS_BY_ROLE } from '../constants/cancellationReasons';
import { setCancellationReason } from '../services/cancellationReasons';

// Optional "what happened?" shown AFTER a cancel has already succeeded. `ask` = { entityType, entityId, role } or null.
export default function CancellationReasonSheet({ ask, onClose }) {
  const codes = ask ? CANCELLATION_REASONS_BY_ROLE[ask.role] ?? [] : [];
  return (
    <ActionSheetModal
      visible={!!ask}
      onClose={onClose}
      title="Cancelled. Want to say why?"
      message="Optional. It helps the business and Nearby understand what's happening."
      dismissLabel="Skip"
      options={codes.map((code) => ({
        key: code,
        text: CANCELLATION_REASONS[code],
        onPress: () => setCancellationReason(ask.entityType, ask.entityId, code),
      }))}
    />
  );
}
