export const QUEUE_NAMES = {
  REGISTRATION_PIPELINE: 'registration-pipeline',
  IMPORT_PROCESSING: 'import-processing',
  WHATSAPP_NOTIFICATIONS: 'whatsapp-notifications',
  DIGITAL_TICKET_GENERATION: 'digital-ticket-generation',
  SYNC_PROCESSING: 'sync-processing',
  QR_GENERATION: 'qr-generation',
  SCAN_PROCESSING: 'scan-processing',
  EVENT_STORAGE_CLEANUP: 'event-storage-cleanup',
  OFFLINE_RECONCILIATION: 'offline-reconciliation',
} as const;

export const QUEUE_NAME_LIST = Object.values(QUEUE_NAMES);
