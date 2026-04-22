import {
  MARKETPLACE_DESCRIPTORS,
  itemIsCustomForDescriptor,
  itemHasResearchForDescriptor,
} from '@/marketplace/descriptors';

export function isNegotiationJewelleryLine(item) {
  return Boolean(item && !item.isRemoved && item.isJewelleryItem === true);
}

export function isNegotiationCexWorkspaceLine(item) {
  if (!item || item.isRemoved || item.isJewelleryItem === true) return false;
  return item.isCustomCeXItem === true;
}

export function isNegotiationBuilderWorkspaceLine(item) {
  if (!item || item.isRemoved || item.isJewelleryItem === true) return false;
  return item.isCustomCeXItem !== true;
}

export function isNegotiationMarketplaceWorkspaceLine(item, descriptor) {
  if (!item || item.isRemoved || item.isJewelleryItem === true) return false;
  if (item.isCustomCeXItem === true) return false;
  if (itemIsCustomForDescriptor(item, descriptor)) return true;
  return itemHasResearchForDescriptor(item, descriptor);
}

export function isNegotiationEbayWorkspaceLine(item) {
  return isNegotiationMarketplaceWorkspaceLine(item, MARKETPLACE_DESCRIPTORS.ebay);
}

export function isNegotiationCashConvertersWorkspaceLine(item) {
  return isNegotiationMarketplaceWorkspaceLine(item, MARKETPLACE_DESCRIPTORS.cashConverters);
}

export function isNegotiationCashGeneratorWorkspaceLine(item) {
  return isNegotiationMarketplaceWorkspaceLine(item, MARKETPLACE_DESCRIPTORS.cashGenerator);
}
