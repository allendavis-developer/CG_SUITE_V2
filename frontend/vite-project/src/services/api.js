// Barrel re-export. The real implementations live in `./api/{resource}.js`.
// Import from `@/services/api` for backwards compatibility or directly from a
// resource file (`@/services/api/requests`) in new code to keep chunk sizes small.

export { API_BASE_URL } from './api/http';

export { fetchJewelleryCatalog } from './api/jewellery';

export {
  fetchProductModels,
  fetchProductCategories,
  fetchProductVariants,
  fetchAttributes,
  fetchAllCategoriesFlat,
} from './api/catalogue';

export { fetchVariantPrices, fetchCeXProductPrices } from './api/prices';

export {
  createRequest,
  addRequestItem,
  fetchRequestDetail,
  fetchRequestsOverview,
  finishRequest,
  saveParkAgreementState,
  updateRequestNegotiationFields,
  saveQuoteDraft,
  deleteRequestItem,
  updateRequestItemOffer,
  updateRequestItemRawData,
} from './api/requests';

export { createCustomer, getOrCreateCustomer, updateCustomer } from './api/customers';

export {
  saveRepricingSession,
  updateRepricingSession,
  fetchRepricingSessionsOverview,
  quickRepriceLookup,
  fetchRepricingSessionDetail,
  saveUploadSession,
  updateUploadSession,
  fetchUploadSessionDetail,
  fetchUploadSessionsOverview,
} from './api/sessions';

export {
  fetchPricingRules,
  createPricingRule,
  updatePricingRule,
  deletePricingRule,
  fetchEbayOfferMargins,
  fetchCustomerOfferRules,
  updateCustomerOfferRule,
  updateCustomerRuleSettings,
} from './api/pricingRules';

export {
  fetchNosposCategoryMappings,
  peekNosposMappingsCache,
  fetchNosposCategories,
  peekNosposCategoriesCache,
  createNosposCategoryMapping,
  updateNosposCategoryMapping,
  deleteNosposCategoryMapping,
  fetchNosposFields,
  syncNosposFields,
  syncNosposCategories,
} from './api/nospos';

export {
  fetchCashGeneratorRetailCategories,
  syncCashGeneratorRetailCategories,
} from './api/cashGenerator';

export {
  fetchWebeposCategoriesFlat,
  saveWebeposCategoriesFromScrape,
} from './api/webeposCategories';
