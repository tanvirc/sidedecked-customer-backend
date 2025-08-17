export interface ImageProcessingConfig {
  storageProvider: 'minio' | 's3'
  bucket: string
  cdnBaseUrl?: string
  enableWebP: boolean
  enableBlurhash: boolean
  compressionQuality: {
    thumbnail: number
    small: number
    normal: number
    large: number
    original: number
  }
  sizes: {
    thumbnail: { width: number; height: number }
    small: { width: number; height: number }
    normal: { width: number; height: number }
    large: { width: number; height: number }
  }
  maxRetries: number
  retryDelayMs: number
  // MinIO specific config
  minioEndpoint?: string
  minioPort?: number
  minioUseSSL?: boolean
  minioAccessKey?: string
  minioSecretKey?: string
  minioBucketName?: string
}

export type ImageSize = 'thumbnail' | 'small' | 'normal' | 'large' | 'original'
export type ImageFormat = 'webp' | 'jpeg' | 'jpg' | 'png'

export interface ImageProcessingResult {
  success: boolean
  printId?: string
  imageType?: ImageType
  urls?: StorageUrls
  blurhash?: string
  metadata?: ImageMetadata
  error?: string
}

export interface ProcessImageRequest {
  printId: string
  imageType: ImageType
  sourceUrl: string
  sourceProvider: string
  priority?: ImageProcessingPriority
}

export enum ImageType {
  MAIN = 'main',
  BACK = 'back',
  ART_CROP = 'art_crop',
  BORDER_CROP = 'border_crop',
  THUMBNAIL = 'thumbnail',
  FULL = 'full'
}

export enum ImageStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  RETRY = 'retry'
}

export enum ImageProcessingPriority {
  LOW = 'low',
  NORMAL = 'normal',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export interface ProcessedImage {
  printId: string
  imageType: ImageType
  status: ImageStatus
  urls?: StorageUrls
  blurhash?: string
  metadata?: ImageMetadata
  error?: string
  processingTime?: number
}

export interface StorageUrls {
  thumbnail: string
  small: string
  normal: string
  large: string
  original: string
  [key: string]: string // Index signature for compatibility
}

export interface CDNUrls {
  thumbnail: string
  small: string
  normal: string
  large: string
  original: string
}

export interface ImageVariations {
  thumbnail: Buffer
  small: Buffer
  normal: Buffer
  large: Buffer
  original: Buffer
  blurhash: string
}

export interface ImageMetadata {
  originalSize: number
  processedSizes: {
    thumbnail: number
    small: number
    normal: number
    large: number
    original: number
  }
  compressionRatios: {
    thumbnail: number
    small: number
    normal: number
    large: number
    original: number
  }
  dimensions: {
    original: { width: number; height: number }
    thumbnail: { width: number; height: number }
    small: { width: number; height: number }
    normal: { width: number; height: number }
    large: { width: number; height: number }
  }
  format: string
  colorSpace: string
  hasAlpha: boolean
  averageColor: string
  dominantColors: string[]
}

export interface ImageUploadResult {
  url: string
  key: string
  size: number
  etag: string
  contentType: string
}

export interface ImageDownloadOptions {
  timeout?: number
  maxRedirects?: number
  userAgent?: string
  headers?: Record<string, string>
}

export interface ImageOptimizationOptions {
  quality: number
  format: 'webp' | 'jpeg' | 'png'
  progressive: boolean
  stripMetadata: boolean
  background?: string
}

export interface BlurhashOptions {
  componentX: number
  componentY: number
}

export interface ImageValidationResult {
  isValid: boolean
  errors: string[]
  metadata?: {
    width: number
    height: number
    format: string
    size: number
  }
}

export interface ImageCleanupResult {
  deletedImages: number
  freedSpaceBytes: number
  errors: string[]
}

export interface ImageBatchProcessRequest {
  requests: ProcessImageRequest[]
  priority: ImageProcessingPriority
  maxConcurrency: number
}

export interface ImageBatchProcessResult {
  totalRequests: number
  successful: number
  failed: number
  results: ProcessedImage[]
  duration: number
}