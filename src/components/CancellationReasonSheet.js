import React from 'react';
import { useLanguage } from '../context/LanguageContext';
import ActionSheetModal from './ActionSheetModal';
import { CANCELLATION_REASONS_BY_ROLE } from '../constants/cancellationReasons';
import { setCancellationReason } from '../services/cancellationReasons';

// Optional "what happened?" shown AFTER a cancel has already succeeded. `ask` = { entityType, entityId, role } or null.
export default function CancellationReasonSheet({ ask, onClose }) {
  const { t } = useLanguage();
  const codes = ask ? CANCELLATION_REASONS_BY_ROLE[ask.role] ?? [] : [];
  return (
    <ActionSheetModal
      visible={!!ask}
      onClose={onClose}
      title={t('ui.requestDetail.cancelledWantToSayWhy')}
      message={t('ui.requestDetail.optionalItHelpsTheBusiness')}
      dismissLabel={t('ui.requestDetail.skip')}
      options={codes.map((code) => ({
        key: code,
        text: t(`ui.requestDetail.cancelReason.${code}`),
        onPress: () => setCancellationReason(ask.entityType, ask.entityId, code),
      }))}
    />
  );
}
