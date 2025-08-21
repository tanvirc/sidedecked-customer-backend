export enum ETLJobType {
  FULL_SYNC = 'full_sync',
  SET_SYNC = 'set_sync',
  CARD_SYNC = 'card_sync',
  PRICE_UPDATE = 'price_update',
  IMAGE_SYNC = 'image_sync'
}

export enum ETLJobStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  RETRY = 'retry'
}

export interface ETLConfig {
  batchSize: number
  rateLimitDelay: number
  concurrency: number
  skipImages: boolean
  forceUpdate: boolean
  maxRetries: number
  circuitBreakerThreshold: number
  circuitBreakerResetTimeout: number
}

export interface ETLResult {
  success: boolean
  gameCode: string
  totalProcessed: number
  cardsCreated: number
  cardsUpdated: number
  cardsDeleted: number
  printsCreated: number
  printsUpdated: number
  imagesQueued: number
  skusGenerated: number
  duration: number
  errors: ETLError[]
  // Enhanced card-level tracking
  cardResults?: CardImportResult[]
  batchResults?: BatchImportResult[]
  cardsSkipped: number
  cardsRetried: number
  imageProcessingCompleted: number
  imageProcessingFailed: number
}

export interface ETLError {
  type: 'api_error' | 'validation_error' | 'database_error' | 'image_error'
  message: string
  details?: any
  timestamp: Date
  retryable: boolean
}

export interface UniversalCard {
  // Universal attributes
  oracleId: string
  oracleHash?: string
  name: string
  normalizedName: string
  primaryType: string
  subtypes?: string[]
  supertypes?: string[]
  powerValue?: number
  defenseValue?: number
  oracleText?: string
  flavorText?: string
  keywords?: string[]

  // Game-specific attributes
  manaCost?: string
  manaValue?: number
  colors?: string[]
  colorIdentity?: string[]
  hp?: number
  retreatCost?: number
  energyTypes?: string[]
  evolutionStage?: string
  attribute?: string
  levelRank?: number
  linkValue?: number
  linkArrows?: string[]
  pendulumScale?: number
  attackValue?: number
  defenseValueYugioh?: number
  cost?: number
  donCost?: number
  lifeValue?: number
  counterValue?: number
  power?: number

  // Extended attributes
  extendedAttributes?: Record<string, any>
  
  // Prints
  prints: UniversalPrint[]
}

export interface UniversalPrint {
  setCode: string
  setName: string
  collectorNumber: string
  rarity: string
  artist?: string
  flavorText?: string
  language: string
  printHash?: string
  
  // Print features
  isFoilAvailable: boolean
  isAlternateArt: boolean
  isPromo: boolean
  isFirstEdition?: boolean
  finish: string
  variation?: string
  frame?: string
  borderColor?: string

  // Format legality
  formatLegality?: Record<string, string>

  // Images
  images?: {
    png?: string
    small?: string
    normal?: string
    large?: string
    artCrop?: string
    borderCrop?: string
  }

  // Pricing
  prices?: {
    usd?: number
    usdFoil?: number
    eur?: number
    tix?: number
  }

  // External IDs
  externalIds?: {
    scryfall?: string
    tcgplayer?: string
    cardmarket?: string
    pokemonTcg?: string
    yugiohProdeck?: string
  }
}

export interface DataSourceConfig {
  provider: string
  baseUrl: string
  apiKey?: string
  rateLimit: number
  timeout: number
  retryConfig: {
    maxRetries: number
    backoffMs: number
    backoffMultiplier: number
  }
  endpoints: Record<string, string>
}

export interface ImportCheckpoint {
  lastProcessedId?: string
  lastProcessedPage?: number
  lastProcessedTimestamp?: Date
  state?: Record<string, any>
}

export interface CircuitBreakerState {
  isOpen: boolean
  failureCount: number
  lastFailureTime?: Date
  resetTimeout: number
}

export enum CircuitBreakerType {
  GAME_LEVEL = 'game_level',
  DATABASE = 'database',
  API_RATE_LIMIT = 'api_rate_limit',
  VALIDATION = 'validation',
  IMAGE_PROCESSING = 'image_processing',
  EXTERNAL_SERVICE = 'external_service'
}

export interface CardLevelCircuitBreakerState {
  type: CircuitBreakerType
  gameCode: string
  isOpen: boolean
  failureCount: number
  successCount: number
  lastFailureTime?: Date
  lastSuccessTime?: Date
  consecutiveFailures: number
  resetTimeout: number
  threshold: number
  halfOpenAttempts: number
  maxHalfOpenAttempts: number
}

export interface CircuitBreakerConfig {
  threshold: number
  resetTimeout: number
  maxHalfOpenAttempts: number
  enabled: boolean
}

export enum ImageProcessingStatus {
  PENDING = 'pending',
  QUEUED = 'queued',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  RETRY = 'retry'
}

export interface CardImportResult {
  cardName: string
  oracleId: string
  oracleHash: string
  success: boolean
  isUpdate: boolean
  printsProcessed: number
  printsCreated: number
  printsUpdated: number
  skusGenerated: number
  imagesQueued: number
  imageProcessingStatus: ImageProcessingStatus
  error?: ETLError
  retryCount: number
  processingTimeMs: number
  timestamp: Date
}

export interface BatchImportResult {
  totalCards: number
  successfulCards: number
  failedCards: number
  skippedCards: number
  cardResults: CardImportResult[]
  batchProcessingTimeMs: number
  errors: ETLError[]
}