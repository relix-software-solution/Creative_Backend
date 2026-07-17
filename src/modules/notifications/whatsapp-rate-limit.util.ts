export type WhatsAppLimiterConfig = {
  max: number;
  duration: number;
};

export function getWhatsAppLimiterConfig(
  ratePerSecond: number,
): WhatsAppLimiterConfig | undefined {
  if (!Number.isFinite(ratePerSecond) || ratePerSecond <= 0) {
    return undefined;
  }

  if (ratePerSecond >= 1) {
    return {
      max: Math.max(Math.floor(ratePerSecond), 1),
      duration: 1000,
    };
  }

  return {
    max: 1,
    duration: Math.ceil(1000 / ratePerSecond),
  };
}

export function getConfiguredWhatsAppRatePerSecond() {
  const value = Number(process.env.WHATSAPP_SEND_RATE_PER_SECOND ?? 3);

  return Number.isFinite(value) ? value : 3;
}
