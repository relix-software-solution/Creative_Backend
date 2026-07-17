import { getWhatsAppLimiterConfig } from './whatsapp-rate-limit.util';

describe('getWhatsAppLimiterConfig', () => {
  it('maps 3/sec to max 3 per second', () => {
    expect(getWhatsAppLimiterConfig(3)).toEqual({ max: 3, duration: 1000 });
  });

  it('maps 1/sec to max 1 per second', () => {
    expect(getWhatsAppLimiterConfig(1)).toEqual({ max: 1, duration: 1000 });
  });

  it('maps fractional rates to one job per calculated duration', () => {
    expect(getWhatsAppLimiterConfig(0.016)).toEqual({
      max: 1,
      duration: 62500,
    });
  });
});
