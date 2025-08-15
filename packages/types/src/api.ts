import { BaseEntity, PaginationParams, SortParams, ApiResponse } from './base'

/**
 * API Request/Response types
 */

// Generic list response
export interface ListResponse<T> extends ApiResponse<T[]> {
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
    hasNext: boolean
    hasPrevious: boolean
  }
}

// Search request parameters
export interface SearchRequest extends PaginationParams {
  query?: string
  filters?: Record<string, any>
  sort?: SortParams
  include?: string[]        // Related entities to include
}

// Batch operation request
export interface BatchRequest<T> {
  operation: 'create' | 'update' | 'delete'
  items: T[]
  options?: {
    skipValidation?: boolean
    continueOnError?: boolean
    returnDetails?: boolean
  }
}

// Batch operation response
export interface BatchResponse<T> extends ApiResponse {
  data: {
    successful: T[]
    failed: BatchError[]
    total: number
    successCount: number
    failureCount: number
  }
}

export interface BatchError {
  item: any
  error: string
  code?: string
  index: number
}

/**
 * TCG Catalog API Types
 */
export interface CardSearchRequest extends SearchRequest {
  filters?: {
    games?: string[]
    types?: string[]
    colors?: string[]
    rarities?: string[]
    sets?: string[]
    keywords?: string[]
    manaValueRange?: [number, number]
    powerRange?: [number, number]
    toughnessRange?: [number, number]
    priceRange?: [number, number]
    inStock?: boolean
    isLegal?: string[]
  }
}

export interface ETLTriggerRequest {
  gameCode: string
  jobType?: 'full_sync' | 'incremental' | 'images_only'
  options?: {
    forceFullSync?: boolean
    skipImages?: boolean
    batchSize?: number
  }
}

export interface ETLStatusResponse extends ApiResponse {
  data: {
    jobId: string
    status: string
    progress: {
      totalRecords?: number
      processedRecords: number
      failedRecords: number
      percentage: number
    }
    estimatedCompletion?: Date
    errors?: string[]
  }
}

/**
 * Deck Builder API Types  
 */
export interface CreateDeckRequest {
  name: string
  description?: string
  gameId: string
  format: string
  isPublic?: boolean
  coverCardId?: string
}

export interface UpdateDeckRequest {
  name?: string
  description?: string
  format?: string
  isPublic?: boolean
  coverCardId?: string
}

export interface AddCardToDeckRequest {
  cardId: string
  printId?: string
  mainboardQuantity?: number
  sideboardQuantity?: number
  commanderQuantity?: number
  notes?: string
}

export interface DeckValidationRequest {
  deckId: string
  format?: string
  includeWarnings?: boolean
  includeSuggestions?: boolean
}

export interface DeckImportRequest {
  deckList: string         // Text format deck list
  format: string
  source?: 'mtgo' | 'arena' | 'moxfield' | 'archidekt' | 'manual'
  name?: string
  description?: string
}

/**
 * Community API Types
 */
export interface CreateTopicRequest {
  categoryId: string
  title: string
  content: string
  topicType?: 'discussion' | 'question' | 'guide' | 'announcement'
  tags?: string[]
}

export interface CreatePostRequest {
  topicId: string
  content: string
  cardReferences?: string[]
  deckReferences?: string[]
  imageUrls?: string[]
}

export interface SendMessageRequest {
  conversationId?: string  // Omit to start new conversation
  recipientId?: string     // Required if starting new conversation
  content: string
  messageType?: 'text' | 'image' | 'card_reference' | 'deck_reference'
  cardReferences?: string[]
  deckReferences?: string[]
  imageUrls?: string[]
}

export interface CreateTradeOfferRequest {
  toUserId: string
  offeredCards: {
    cardId: string
    printId?: string
    quantity: number
    condition: string
    estimatedValue: number
    notes?: string
  }[]
  requestedCards: {
    cardId: string
    printId?: string
    quantity: number
    condition: string
    estimatedValue: number
    notes?: string
  }[]
  cashOffered?: number
  cashRequested?: number
  message?: string
  expiresAt?: Date
}

/**
 * Pricing API Types
 */
export interface CreatePriceAlertRequest {
  printId: string
  condition: string
  finish: string
  alertType: 'price_drop' | 'price_target' | 'availability' | 'price_spike'
  targetPrice?: number
  percentageThreshold?: number
  notificationMethods: string[]
  frequency?: 'immediate' | 'daily' | 'weekly'
  expiresAt?: Date
}

export interface PriceHistoryRequest {
  printId: string
  condition?: string
  finish?: string
  timeframe: '7d' | '30d' | '90d' | '1y' | 'all'
  granularity?: 'hour' | 'day' | 'week' | 'month'
  source?: string
}

export interface MarketAnalysisRequest {
  scope: 'card' | 'set' | 'format' | 'game'
  entityId: string         // Card ID, Set ID, Format name, or Game ID
  timeframe: '7d' | '30d' | '90d' | '1y'
  includeComparison?: boolean
  includePredictions?: boolean
}

export interface PortfolioCreateRequest {
  name: string
  description?: string
  isPublic?: boolean
  autoTrackPurchases?: boolean
}

export interface PortfolioHoldingRequest {
  printId: string
  quantity: number
  condition: string
  finish: string
  costBasis: number
  purchaseDate: Date
  notes?: string
  tags?: string[]
}

/**
 * File upload types
 */
export interface FileUploadResponse extends ApiResponse {
  data: {
    fileId: string
    fileName: string
    fileSize: number
    mimeType: string
    url: string
    thumbnailUrl?: string
    blurhash?: string
  }
}

export interface ImageProcessingOptions {
  resize?: {
    width: number
    height: number
    fit?: 'cover' | 'contain' | 'fill'
  }
  format?: 'webp' | 'jpeg' | 'png'
  quality?: number
  generateThumbnail?: boolean
  generateBlurhash?: boolean
}

/**
 * Webhook types
 */
export interface WebhookEvent {
  id: string
  type: string
  timestamp: Date
  data: Record<string, any>
  source: string
  version: string
}

export interface WebhookSubscription extends BaseEntity {
  url: string
  events: string[]
  secret: string
  isActive: boolean
  lastDelivery?: Date
  failureCount: number
  maxRetries: number
}

/**
 * Error types
 */
export interface APIError {
  code: string
  message: string
  details?: Record<string, any>
  timestamp: Date
  requestId?: string
  path?: string
}

export interface ValidationError extends APIError {
  field?: string
  value?: any
  constraint?: string
}

/**
 * Health check and monitoring
 */
export interface HealthCheckResponse extends ApiResponse {
  data: {
    status: 'healthy' | 'degraded' | 'unhealthy'
    timestamp: Date
    version: string
    uptime: number
    checks: HealthCheck[]
  }
}

export interface HealthCheck {
  name: string
  status: 'pass' | 'fail' | 'warn'
  responseTime: number
  message?: string
  details?: Record<string, any>
}