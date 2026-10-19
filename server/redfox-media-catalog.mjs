// Public Redfox documentation snapshot: 2026-10-18. Prices are CNY catalogue
// references, not the customer's discounted price or an USD budget reservation.
export const redfoxMediaCatalog = {
  'media.imageSubmit': { path: '/story/api/parseWork/imageGen/arkProSubmit', method: 'POST', priceCny: 1 },
  'media.imageResult': { path: '/story/api/parseWork/imageGen/arkProResult', method: 'POST', priceCny: 0 },
  'media.uploadImage': { path: '/story/api/parseWork/imageGen/uploadImage', method: 'POST', priceCny: 0, multipart: true, queryKeys: ['format'] },
  'media.videoSubmit': { path: '/story/api/parseWork/videoGen/seedanceSubmit', method: 'POST', priceCny: 15 },
  'media.videoResult': { path: '/story/api/parseWork/videoGen/seedanceResult', method: 'POST', priceCny: 0 },
};
