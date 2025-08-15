import { Client as MinioClient } from 'minio'
import { logger } from '../utils/Logger'
import { ImageUploadResult } from '../types/ImageTypes'

export interface StorageConfig {
  endpoint: string
  port?: number
  useSSL?: boolean
  accessKey: string
  secretKey: string
  bucket: string
  region?: string
}

export class StorageService {
  private client: MinioClient
  private bucket: string
  private cdnBaseUrl?: string

  constructor(config: StorageConfig, cdnBaseUrl?: string) {
    this.client = new MinioClient({
      endPoint: config.endpoint,
      port: config.port || (config.useSSL ? 443 : 80),
      useSSL: config.useSSL ?? true,
      accessKey: config.accessKey,
      secretKey: config.secretKey,
      region: config.region
    })
    
    this.bucket = config.bucket
    this.cdnBaseUrl = cdnBaseUrl
    
    logger.info('StorageService initialized', {
      endpoint: config.endpoint,
      bucket: config.bucket,
      cdnEnabled: !!cdnBaseUrl
    })
  }

  /**
   * Initialize storage - create bucket if it doesn't exist
   */
  async initialize(): Promise<void> {
    try {
      const bucketExists = await this.client.bucketExists(this.bucket)
      
      if (!bucketExists) {
        await this.client.makeBucket(this.bucket, 'us-east-1')
        logger.info('Storage bucket created', { bucket: this.bucket })
        
        // Set bucket policy for public read access
        const policy = {
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: { AWS: ['*'] },
              Action: ['s3:GetObject'],
              Resource: [`arn:aws:s3:::${this.bucket}/cards/*`]
            }
          ]
        }
        
        await this.client.setBucketPolicy(this.bucket, JSON.stringify(policy))
        logger.info('Storage bucket policy set', { bucket: this.bucket })
      } else {
        logger.info('Storage bucket already exists', { bucket: this.bucket })
      }
    } catch (error) {
      logger.error('Failed to initialize storage', error as Error, { bucket: this.bucket })
      throw error
    }
  }

  /**
   * Upload image buffer to storage
   */
  async uploadImage(
    key: string,
    buffer: Buffer,
    contentType: string = 'image/webp',
    metadata?: Record<string, string>
  ): Promise<ImageUploadResult> {
    try {
      const uploadOptions = {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000', // 1 year
        ...metadata
      }

      const result = await this.client.putObject(
        this.bucket,
        key,
        buffer,
        buffer.length,
        uploadOptions
      )

      const publicUrl = this.getPublicUrl(key)
      
      logger.debug('Image uploaded successfully', {
        key,
        size: buffer.length,
        contentType,
        url: publicUrl
      })

      return {
        url: publicUrl,
        key,
        size: buffer.length,
        etag: result.etag || '',
        contentType
      }
    } catch (error) {
      logger.error('Failed to upload image', error as Error, { key, contentType })
      throw error
    }
  }

  /**
   * Download image from storage
   */
  async downloadImage(key: string): Promise<Buffer> {
    try {
      const stream = await this.client.getObject(this.bucket, key)
      const chunks: Buffer[] = []
      
      return new Promise((resolve, reject) => {
        stream.on('data', (chunk) => chunks.push(chunk))
        stream.on('error', reject)
        stream.on('end', () => resolve(Buffer.concat(chunks)))
      })
    } catch (error) {
      logger.error('Failed to download image', error as Error, { key })
      throw error
    }
  }

  /**
   * Delete image from storage
   */
  async deleteImage(key: string): Promise<void> {
    try {
      await this.client.removeObject(this.bucket, key)
      logger.debug('Image deleted successfully', { key })
    } catch (error) {
      logger.error('Failed to delete image', error as Error, { key })
      throw error
    }
  }

  /**
   * Check if image exists in storage
   */
  async imageExists(key: string): Promise<boolean> {
    try {
      await this.client.statObject(this.bucket, key)
      return true
    } catch (error: any) {
      if (error.code === 'NotFound') {
        return false
      }
      logger.error('Failed to check image existence', error as Error, { key })
      throw error
    }
  }

  /**
   * Get image metadata
   */
  async getImageMetadata(key: string): Promise<{
    size: number
    lastModified: Date
    etag: string
    contentType?: string
  }> {
    try {
      const stat = await this.client.statObject(this.bucket, key)
      return {
        size: stat.size,
        lastModified: stat.lastModified,
        etag: stat.etag,
        contentType: stat.metaData?.['content-type']
      }
    } catch (error) {
      logger.error('Failed to get image metadata', error as Error, { key })
      throw error
    }
  }

  /**
   * Generate presigned URL for temporary access
   */
  async getPresignedUrl(
    key: string,
    expirySeconds: number = 3600
  ): Promise<string> {
    try {
      return await this.client.presignedGetObject(this.bucket, key, expirySeconds)
    } catch (error) {
      logger.error('Failed to generate presigned URL', error as Error, { key })
      throw error
    }
  }

  /**
   * List images with prefix
   */
  async listImages(prefix: string, maxResults: number = 1000): Promise<string[]> {
    try {
      const objects: string[] = []
      const stream = this.client.listObjects(this.bucket, prefix, false)
      
      return new Promise((resolve, reject) => {
        stream.on('data', (obj) => {
          objects.push(obj.name!)
          if (objects.length >= maxResults) {
            stream.destroy()
            resolve(objects)
          }
        })
        stream.on('error', reject)
        stream.on('end', () => resolve(objects))
      })
    } catch (error) {
      logger.error('Failed to list images', error as Error, { prefix })
      throw error
    }
  }

  /**
   * Get public URL for an image
   */
  getPublicUrl(key: string): string {
    if (this.cdnBaseUrl) {
      // Use CDN URL when available
      return `${this.cdnBaseUrl}/${key}`
    }
    
    // Fall back to MinIO public URL
    const protocol = this.client.protocol
    const host = this.client.host
    const port = this.client.port
    const portSuffix = (port && port !== 80 && port !== 443) ? `:${port}` : ''
    
    return `${protocol}//${host}${portSuffix}/${this.bucket}/${key}`
  }

  /**
   * Generate structured path for card images
   */
  generateImagePath(
    printId: string,
    imageType: string,
    size: string,
    format: string = 'webp'
  ): string {
    // Structure: cards/{printId}/{imageType}/{size}.{format}
    return `cards/${printId}/${imageType}/${size}.${format}`
  }

  /**
   * Clean up orphaned images
   */
  async cleanupOrphanedImages(
    validPrintIds: string[],
    dryRun: boolean = true
  ): Promise<{ deletedCount: number; freedBytes: number; errors: string[] }> {
    const result = {
      deletedCount: 0,
      freedBytes: 0,
      errors: []
    }

    try {
      const validIdSet = new Set(validPrintIds)
      const allImages = await this.listImages('cards/')
      
      for (const imagePath of allImages) {
        try {
          // Extract print ID from path: cards/{printId}/{imageType}/{size}.{format}
          const pathParts = imagePath.split('/')
          if (pathParts.length >= 2) {
            const printId = pathParts[1]
            
            if (!validIdSet.has(printId)) {
              // This is an orphaned image
              if (!dryRun) {
                const metadata = await this.getImageMetadata(imagePath)
                await this.deleteImage(imagePath)
                result.freedBytes += metadata.size
              }
              result.deletedCount++
            }
          }
        } catch (error) {
          result.errors.push(`Failed to process ${imagePath}: ${(error as Error).message}`)
        }
      }

      logger.info('Image cleanup completed', {
        dryRun,
        deletedCount: result.deletedCount,
        freedBytes: result.freedBytes,
        errors: result.errors.length
      })

      return result
    } catch (error) {
      logger.error('Failed to cleanup orphaned images', error as Error)
      throw error
    }
  }

  /**
   * Get storage statistics
   */
  async getStorageStats(): Promise<{
    totalImages: number
    totalSize: number
    sizeByImageType: Record<string, { count: number; size: number }>
  }> {
    try {
      const images = await this.listImages('cards/')
      const stats = {
        totalImages: 0,
        totalSize: 0,
        sizeByImageType: {} as Record<string, { count: number; size: number }>
      }

      for (const imagePath of images) {
        try {
          const metadata = await this.getImageMetadata(imagePath)
          const pathParts = imagePath.split('/')
          
          if (pathParts.length >= 3) {
            const imageType = pathParts[2]
            
            if (!stats.sizeByImageType[imageType]) {
              stats.sizeByImageType[imageType] = { count: 0, size: 0 }
            }
            
            stats.sizeByImageType[imageType].count++
            stats.sizeByImageType[imageType].size += metadata.size
          }
          
          stats.totalImages++
          stats.totalSize += metadata.size
        } catch (error) {
          // Skip files that can't be accessed
          continue
        }
      }

      return stats
    } catch (error) {
      logger.error('Failed to get storage statistics', error as Error)
      throw error
    }
  }
}

// Export factory function
export function createStorageService(
  config: StorageConfig,
  cdnBaseUrl?: string
): StorageService {
  return new StorageService(config, cdnBaseUrl)
}