import { amazonImportMapping } from './amazon.mapping';
import { flipkartImportMapping } from './flipkart.mapping';
import { meeshoImportMapping } from './meesho.mapping';
import { myntraImportMapping } from './myntra.mapping';
import { MarketplaceImportMapping } from './types';

const REGISTRY: MarketplaceImportMapping[] = [
  flipkartImportMapping,
  amazonImportMapping,
  meeshoImportMapping,
  myntraImportMapping,
];

export const resolveMarketplaceImportMapping = (
  marketplaceIdentifier: string,
): MarketplaceImportMapping => {
  const normalized = String(marketplaceIdentifier ?? '')
    .trim()
    .toLowerCase();
  const hit = REGISTRY.find(
    (item) =>
      normalized.includes(item.key) ||
      normalized.includes(item.displayName.toLowerCase()),
  );
  if (!hit) {
    return flipkartImportMapping;
  }
  return hit;
};

export {
  amazonImportMapping,
  flipkartImportMapping,
  meeshoImportMapping,
  myntraImportMapping,
};
export type {
  MarketplaceImportMapping,
  MarketplaceImportFieldMapping,
} from './types';
