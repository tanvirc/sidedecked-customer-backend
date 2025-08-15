export interface SearchQuery {
  text?: string
  filters: SearchFilters
  sort?: SearchSort
  page: number
  limit: number
  facets?: string[]
}

export interface SearchFilters {
  games?: string[]
  types?: string[]
  subtypes?: string[]
  colors?: string[]
  energyTypes?: string[]
  attributes?: string[]
  rarities?: string[]
  sets?: string[]
  artists?: string[]
  languages?: string[]
  conditions?: string[]
  finishes?: string[]
  
  // Numeric ranges
  manaValueRange?: [number, number]
  powerRange?: [number, number]
  defenseRange?: [number, number]
  priceRange?: [number, number]
  
  // Boolean filters
  inStock?: boolean
  isFoil?: boolean
  isPromo?: boolean
  isAlternateArt?: boolean
  isGraded?: boolean
  
  // Format legality
  legalInStandard?: boolean
  legalInModern?: boolean
  legalInLegacy?: boolean
  legalInCommander?: boolean
}

export interface SearchSort {
  field: SearchSortField
  direction: 'asc' | 'desc'
}

export enum SearchSortField {
  RELEVANCE = 'relevance',
  NAME = 'name',
  RELEASE_DATE = 'release_date',
  PRICE_LOW = 'price_low',
  PRICE_HIGH = 'price_high',
  POPULARITY = 'popularity',
  MANA_VALUE = 'mana_value',
  POWER = 'power',
  DEFENSE = 'defense',
  RARITY = 'rarity'
}

export interface SearchResults {
  hits: SearchHit[]
  totalHits: number
  facets: Record<string, FacetValue[]>
  processingTime: number
  page: number
  hasMore: boolean
  suggestions?: string[]
}

export interface SearchHit {
  id: string
  name: string
  normalizedName: string
  primaryType: string
  subtypes: string[]
  oracleText?: string
  game: {
    code: string
    name: string
  }
  
  // Game-specific highlighted fields
  manaCost?: string
  manaValue?: number
  colors?: string[]
  hp?: number
  attribute?: string
  
  // Market data
  lowestPrice?: number
  marketPrice?: number
  hasInventory: boolean
  
  // Print information
  sets: {
    code: string
    name: string
  }[]
  rarities: string[]
  
  // Images
  imageUrl?: string
  thumbnailUrl?: string
  
  // Search metadata
  _highlightResult?: Record<string, HighlightResult>
  _snippetResult?: Record<string, SnippetResult>
  
  // Popularity metrics
  popularity: number
}

export interface FacetValue {
  value: string
  count: number
  highlighted?: string
}

export interface HighlightResult {
  value: string
  matchLevel: 'none' | 'partial' | 'full'
  matchedWords: string[]
}

export interface SnippetResult {
  value: string
  matchLevel: 'none' | 'partial' | 'full'
}

export interface SearchIndexDocument {
  objectID: string
  name: string
  normalizedName: string
  game: string
  gameName: string
  primaryType: string
  subtypes: string[]
  oracleText?: string
  keywords: string[]
  
  // Game-specific searchable fields
  colors?: string[]
  manaCost?: string
  manaValue?: number
  energyTypes?: string[]
  attribute?: string
  
  // Print aggregations
  sets: {
    code: string
    name: string
  }[]
  rarities: string[]
  artists: string[]
  
  // Market data
  hasInventory: boolean
  lowestPrice?: number
  priceRange?: string
  
  // Popularity boost
  popularity: number
  totalViews: number
  totalSearches: number
  
  // Faceting attributes
  _tags?: string[]
}

export interface AlgoliaConfig {
  appId: string
  apiKey: string
  searchKey: string
  indexName: string
  settings: AlgoliaIndexSettings
}

export interface AlgoliaIndexSettings {
  searchableAttributes: string[]
  attributesForFaceting: string[]
  customRanking: string[]
  ranking: string[]
  typoTolerance: boolean
  synonyms?: Record<string, string[]>
  removeWordsIfNoResults: 'none' | 'lastWords' | 'firstWords' | 'allOptional'
  minWordSizefor1Typo: number
  minWordSizefor2Typos: number
}

export interface AutocompleteResult {
  query: string
  suggestions: AutocompleteSuggestion[]
  processingTime: number
}

export interface AutocompleteSuggestion {
  type: 'card' | 'set' | 'artist' | 'keyword'
  value: string
  count: number
  highlighted: string
}