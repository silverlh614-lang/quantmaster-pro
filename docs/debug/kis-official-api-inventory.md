# KisOfficialApiInventory

Source of truth: `server/clients/kisClient/kisOfficialEndpointRegistry.ts`.

```yaml
KisOfficialApiInventory:
  quote:
    apiPath: /uapi/domestic-stock/v1/quotations/inquire-price
    method: GET
    trId: FHKST01010100
    requiredParams: [FID_COND_MRKT_DIV_CODE, FID_INPUT_ISCD]
    outputFields: [output]
    normalizedModel: KisNormalizedQuote
  ohlcvDaily:
    apiPath: /uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice
    method: GET
    trId: FHKST03010100
    requiredParams: [FID_COND_MRKT_DIV_CODE, FID_INPUT_ISCD]
    outputFields: [output1, output2]
    normalizedModel: KisDailyCandle[]
  investorFlow:
    apiPath: /uapi/domestic-stock/v1/quotations/inquire-investor
    method: GET
    trId: FHKST01010900
    requiredParams: [FID_COND_MRKT_DIV_CODE, FID_INPUT_ISCD]
    outputFields: [output]
    normalizedModel: KisInvestorFlow
  balance:
    apiPath: /uapi/domestic-stock/v1/trading/inquire-balance
    method: GET
    trId: null
    requiredParams: [CANO, ACNT_PRDT_CD]
    outputFields: [output1, output2]
    normalizedModel: KisBalance
  order:
    apiPath: /uapi/domestic-stock/v1/trading/order-cash
    method: POST
    trId: null
    requiredParams: [CANO, ACNT_PRDT_CD, PDNO, ORD_DVSN, ORD_QTY, ORD_UNPR]
    outputFields: [output]
    normalizedModel: KisOrderResult
```

Notes:
- `quote=VERIFIED` and `technicalIndicators=COMPUTED` are distinct states.
- KIS quote endpoint does not provide MA/RSI/ATR directly.
