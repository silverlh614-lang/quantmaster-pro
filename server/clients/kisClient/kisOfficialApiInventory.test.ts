import { describe, expect, it } from 'vitest';
import { getKisOfficialApiInventory } from './kisOfficialEndpointRegistry.js';

describe('KIS official API inventory', () => {
  it('loads quote/ohlcv/investor from official registry without hardcoded drift', () => {
    const inv = getKisOfficialApiInventory();
    expect(inv.quote.apiPath).toBe('/uapi/domestic-stock/v1/quotations/inquire-price');
    expect(inv.quote.trId).toBe('FHKST01010100');
    expect(inv.ohlcvDaily.apiPath).toBe('/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice');
    expect(inv.ohlcvDaily.trId).toBe('FHKST03010100');
    expect(inv.investorFlow.apiPath).toBe('/uapi/domestic-stock/v1/quotations/inquire-investor');
    expect(inv.investorFlow.trId).toBe('FHKST01010900');
  });
});
