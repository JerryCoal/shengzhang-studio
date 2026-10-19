// Official API documentation checked 2026-10-18. Prices use the undiscounted
// per-call price, not the "minimum" tier. Actual billing remains provider-owned.
export const redfoxSearchCatalog = {
  'search.submit': { path: '/story/api/kimi/submitK3', method: 'POST', priceCny: .18 },
  'search.result': { path: '/story/api/kimi/result', method: 'POST', priceCny: 0 },
  'trends.list': { path: '/story/api/hotKeyword/list', method: 'POST', priceCny: .06 },
};
