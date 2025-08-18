import sharp from 'sharp'
import { encode } from 'blurhash'
import axios from 'axios'
import { Client as MinioClient } from 'minio'
import { logger } from '../utils/Logger'
import { ImageProcessingConfig, ImageProcessingResult, ImageSize, ImageFormat } from '../types/ImageTypes'

export class ImageProcessingService {
  private minioClient: MinioClient
  private config: ImageProcessingConfig

  constructor(config: ImageProcessingConfig) {
    this.config = config
    
    // Parse endpoint to remove protocol and extract port
    let endpoint = config.minioEndpoint || 'localhost'
    let port = config.minioPort || 9000
    let useSSL = config.minioUseSSL || false
    
    // Remove protocol if present
    if (endpoint.startsWith('https://')) {
      endpoint = endpoint.replace('https://', '')
      useSSL = true
      port = 443
    } else if (endpoint.startsWith('http://')) {
      endpoint = endpoint.replace('http://', '')
      useSSL = false
      port = 80
    }
    
    // Extract port if specified
    if (endpoint.includes(':')) {
      const parts = endpoint.split(':')
      endpoint = parts[0]
      port = parseInt(parts[1]) || port
    }
    
    this.minioClient = new MinioClient({
      endPoint: endpoint,
      port: port,
      useSSL: useSSL,
      accessKey: config.minioAccessKey || '',
      secretKey: config.minioSecretKey || ''
    })
  }

  /**
   * Process and upload card image from URL
   */
  async processImageFromUrl(
    sourceUrl: string,
    printId: string,
    imageType: string = 'normal'
  ): Promise<ImageProcessingResult> {
    logger.debug('Starting image processing from URL', { sourceUrl, printId, imageType })

    try {
      // Download image
      const imageBuffer = await this.downloadImage(sourceUrl)
      
      // Process the image
      return await this.processImage(imageBuffer, printId, imageType)

    } catch (error) {
      logger.error('Failed to process image from URL', error as Error, {
        sourceUrl,
        printId,
        imageType
      })
      throw error
    }
  }

  /**
   * Process image buffer and upload to storage
   */
  async processImage(
    imageBuffer: Buffer,
    printId: string,
    imageType: string = 'normal'
  ): Promise<ImageProcessingResult> {
    logger.debug('Starting image processing', { printId, imageType, bufferSize: imageBuffer.length })

    try {
      // Generate blurhash for placeholder
      const blurhash = await this.generateBlurhash(imageBuffer)
      
      // Process different sizes
      const processedImages = await this.processImageSizes(imageBuffer, printId, imageType)
      
      // Upload all sizes to MinIO
      const uploadResults = await this.uploadImages(processedImages, printId, imageType)

      const result: ImageProcessingResult = {
        success: true,
        printId,
        imageType: imageType as any,
        blurhash,
        urls: this.generateImageUrls(printId, imageType)
      }

      logger.info('Image processing completed successfully', {
        printId,
        imageType,
        sizesProcessed: Object.keys(uploadResults).length,
        blurhash: blurhash.substring(0, 16) + '...'
      })

      return result

    } catch (error) {
      logger.error('Failed to process image', error as Error, {
        printId,
        imageType,
        bufferSize: imageBuffer.length
      })

      return {
        success: false,
        printId,
        imageType: imageType as any,
        error: (error as Error).message
      }
    }
  }

  /**
   * Download image from URL
   */
  private async downloadImage(url: string): Promise<Buffer> {
    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 30000,
        headers: {
          'User-Agent': 'SideDecked/1.0 (marketplace@sidedecked.com)'
        }
      })

      if (response.status !== 200) {
        throw new Error(`Failed to download image: HTTP ${response.status}`)
      }

      return Buffer.from(response.data)

    } catch (error) {
      logger.error('Failed to download image', error as Error, { url })
      throw new Error(`Failed to download image from ${url}: ${(error as Error).message}`)
    }
  }

  /**
   * Generate blurhash for image placeholder
   */
  private async generateBlurhash(imageBuffer: Buffer): Promise<string> {
    try {
      // Resize to small size for blurhash processing (faster)
      const { data, info } = await sharp(imageBuffer)
        .resize(32, 32, { fit: 'cover' })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })

      // Generate blurhash (4x3 components for good quality vs size balance)
      const blurhash = encode(new Uint8ClampedArray(data), info.width, info.height, 4, 3)
      
      logger.debug('Generated blurhash', { 
        hash: blurhash.substring(0, 16) + '...',
        width: info.width,
        height: info.height
      })

      return blurhash

    } catch (error) {
      logger.error('Failed to generate blurhash', error as Error)
      throw new Error(`Failed to generate blurhash: ${(error as Error).message}`)
    }
  }

  /**
   * Process image into different sizes
   */
  private async processImageSizes(
    imageBuffer: Buffer,
    printId: string,
    imageType: string
  ): Promise<Record<ImageSize, Buffer>> {
    const processedImages: Record<ImageSize, Buffer> = {
      thumbnail: Buffer.alloc(0),
      small: Buffer.alloc(0),
      normal: Buffer.alloc(0),
      large: Buffer.alloc(0),
      original: Buffer.alloc(0)
    }

    // Define size configurations
    const sizeConfigs: Record<ImageSize, { width?: number; height?: number; quality: number }> = {
      thumbnail: { width: 150, height: 209, quality: 80 },
      small: { width: 300, height: 418, quality: 85 },
      normal: { width: 488, height: 680, quality: 90 },
      large: { width: 672, height: 936, quality: 95 },
      original: { quality: 100 } // Original size - no resize
    }

    for (const [size, config] of Object.entries(sizeConfigs) as [ImageSize, typeof sizeConfigs[ImageSize]][]) {
      try {
        logger.debug('Processing image size', { printId, imageType, size, config })

        let pipeline = sharp(imageBuffer)

        // Only resize if width and height are specified (not for original)
        if (config.width && config.height) {
          pipeline = pipeline.resize(config.width, config.height, {
            fit: 'cover',
            position: 'center'
          })
        }

        // Convert to WebP with specific quality
        const processedBuffer = await pipeline
          .webp({
            quality: config.quality,
            effort: 4, // Good balance of compression vs speed
            smartSubsample: true
          })
          .toBuffer()

        processedImages[size] = processedBuffer

        logger.debug('Processed image size', {
          printId,
          imageType,
          size,
          originalSize: imageBuffer.length,
          processedSize: processedBuffer.length,
          compressionRatio: Math.round((1 - processedBuffer.length / imageBuffer.length) * 100)
        })

      } catch (error) {
        logger.error('Failed to process image size', error as Error, {
          printId,
          imageType,
          size
        })
        throw error
      }
    }

    return processedImages
  }

  /**
   * Upload processed images to MinIO
   */
  private async uploadImages(
    processedImages: Record<ImageSize, Buffer>,
    printId: string,
    imageType: string
  ): Promise<Record<ImageSize, { size: number; key: string }>> {
    const uploadResults: Record<ImageSize, { size: number; key: string }> = {
      thumbnail: { size: 0, key: '' },
      small: { size: 0, key: '' },
      normal: { size: 0, key: '' },
      large: { size: 0, key: '' },
      original: { size: 0, key: '' }
    }

    // Ensure bucket exists
    await this.ensureBucketExists(this.config.minioBucketName || 'images')

    for (const [size, buffer] of Object.entries(processedImages) as [ImageSize, Buffer][]) {
      try {
        const key = this.generateImageKey(printId, imageType, size)
        
        logger.debug('Uploading image to MinIO', {
          printId,
          imageType,
          size,
          key,
          bufferSize: buffer.length
        })

        await this.minioClient.putObject(
          this.config.minioBucketName || 'images',
          key,
          buffer,
          buffer.length,
          {
            'Content-Type': 'image/webp',
            'Content-Disposition': 'inline',
            'Cache-Control': 'public, max-age=31536000', // 1 year cache
            'X-SideDecked-Print-ID': printId,
            'X-SideDecked-Image-Type': imageType,
            'X-SideDecked-Size': size
          }
        )

        uploadResults[size] = {
          size: buffer.length,
          key
        }

        logger.debug('Uploaded image to MinIO successfully', {
          printId,
          imageType,
          size,
          key,
          uploadSize: buffer.length
        })

      } catch (error) {
        logger.error('Failed to upload image to MinIO', error as Error, {
          printId,
          imageType,
          size,
          bufferSize: buffer.length
        })
        throw error
      }
    }

    return uploadResults
  }

  /**
   * Generate MinIO object key for image
   */
  private generateImageKey(printId: string, imageType: string, size: ImageSize, format: ImageFormat = 'webp'): string {
    // Structure: cards/{printId}/{imageType}/{size}.{format}
    return `cards/${printId}/${imageType}/${size}.${format}`
  }

  /**
   * Generate accessible URLs for images
   */
  private generateImageUrls(printId: string, imageType: string): Record<ImageSize, string> {
    const baseUrl = this.config.cdnBaseUrl || this.generateMinioBaseUrl()
    const urls: Record<ImageSize, string> = {
      thumbnail: '',
      small: '',
      normal: '',
      large: '',
      original: ''
    }

    const sizes: ImageSize[] = ['thumbnail', 'small', 'normal', 'large', 'original']
    
    for (const size of sizes) {
      const key = this.generateImageKey(printId, imageType, size)
      urls[size] = `${baseUrl}/${key}`
    }

    return urls
  }

  /**
   * Generate MinIO base URL (fallback when CDN is not available)
   */
  private generateMinioBaseUrl(): string {
    const protocol = this.config.minioUseSSL ? 'https' : 'http'
    const port = this.config.minioPort !== (this.config.minioUseSSL ? 443 : 80) 
      ? `:${this.config.minioPort}` 
      : ''
    
    return `${protocol}://${this.config.minioEndpoint}${port}/${this.config.minioBucketName || 'images'}`
  }

  /**
   * Ensure MinIO bucket exists
   */
  private async ensureBucketExists(bucketName: string): Promise<void> {
    try {
      const exists = await this.minioClient.bucketExists(bucketName)
      
      if (!exists) {
        logger.info('Creating MinIO bucket', { bucketName })
        await this.minioClient.makeBucket(bucketName, 'us-east-1')
        
        // Set bucket policy for public read access
        const policy = {
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: { AWS: ['*'] },
              Action: ['s3:GetObject'],
              Resource: [`arn:aws:s3:::${bucketName}/*`]
            }
          ]
        }

        await this.minioClient.setBucketPolicy(bucketName, JSON.stringify(policy))
        logger.info('MinIO bucket created and configured', { bucketName })
      }

    } catch (error) {
      logger.error('Failed to ensure bucket exists', error as Error, { bucketName })
      throw error
    }
  }

  /**
   * Delete image from storage
   */
  async deleteImage(printId: string, imageType: string): Promise<void> {
    try {
      const sizes: ImageSize[] = ['thumbnail', 'small', 'normal', 'large', 'original']
      
      for (const size of sizes) {
        const key = this.generateImageKey(printId, imageType, size)
        
        try {
          await this.minioClient.removeObject(this.config.minioBucketName || 'images', key)
          logger.debug('Deleted image from MinIO', { printId, imageType, size, key })
        } catch (error) {
          // Don't fail if individual image doesn't exist
          logger.warn('Failed to delete image (may not exist)', {
            printId,
            imageType,
            size,
            key
          })
        }
      }

      logger.info('Image deletion completed', { printId, imageType })

    } catch (error) {
      logger.error('Failed to delete images', error as Error, { printId, imageType })
      throw error
    }
  }

  /**
   * Get image info without downloading
   */
  async getImageInfo(printId: string, imageType: string, size: ImageSize): Promise<{
    exists: boolean
    size?: number
    lastModified?: Date
    contentType?: string
  }> {
    try {
      const key = this.generateImageKey(printId, imageType, size)
      const stat = await this.minioClient.statObject(this.config.minioBucketName || 'images', key)
      
      return {
        exists: true,
        size: stat.size,
        lastModified: stat.lastModified,
        contentType: stat.metaData?.['content-type']
      }

    } catch (error) {
      // If image doesn't exist, return exists: false
      return { exists: false }
    }
  }

  /**
   * Health check for image processing service
   */
  async healthCheck(): Promise<{ healthy: boolean; error?: string }> {
    try {
      // Test MinIO connection
      const bucketName = this.config.minioBucketName || 'images'
      const bucketExists = await this.minioClient.bucketExists(bucketName)
      
      if (!bucketExists) {
        return { healthy: false, error: `Bucket ${bucketName} does not exist` }
      }

      // Test Sharp processing with a small test image
      const testBuffer = Buffer.from([
        137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 8, 215, 99, 248, 15, 0, 0, 1, 0, 1, 0, 24, 221, 219, 219, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130
      ])

      await sharp(testBuffer).webp().toBuffer()

      return { healthy: true }

    } catch (error) {
      return { healthy: false, error: (error as Error).message }
    }
  }
}