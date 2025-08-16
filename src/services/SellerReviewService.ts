import { Repository, In } from 'typeorm'
import { AppDataSource } from '../config/database'
import { SellerReview, ReviewStatus, ReviewType } from '../entities/SellerReview'
import { SellerRating } from '../entities/SellerRating'
import { logger } from '../config/logger'

export interface CreateReviewDto {
  seller_id: string
  customer_id: string
  order_id?: string
  product_id?: string
  rating: number
  title?: string
  comment?: string
  review_type?: ReviewType
  item_as_described_rating?: number
  shipping_speed_rating?: number
  communication_rating?: number
  packaging_rating?: number
  images?: string[]
  is_verified_purchase?: boolean
}

export interface ReviewSummary {
  seller_id: string
  total_reviews: number
  average_rating: number
  rating_distribution: Record<number, number>
  breakdown_ratings: {
    item_as_described: number
    shipping_speed: number
    communication: number
    packaging: number
  }
  recent_reviews: SellerReview[]
  verified_purchase_percentage: number
}

export interface ReviewFilters {
  rating?: number
  review_type?: ReviewType
  status?: ReviewStatus
  is_verified_purchase?: boolean
  days_back?: number
  limit?: number
  offset?: number
}

export class SellerReviewService {
  private reviewRepo: Repository<SellerReview>
  private ratingRepo: Repository<SellerRating>

  constructor() {
    this.reviewRepo = AppDataSource.getRepository(SellerReview)
    this.ratingRepo = AppDataSource.getRepository(SellerRating)
  }

  /**
   * Create a new seller review
   */
  async createReview(dto: CreateReviewDto): Promise<SellerReview> {
    try {
      // Validate rating values
      if (dto.rating < 1 || dto.rating > 5) {
        throw new Error('Rating must be between 1 and 5')
      }

      // Check if customer already reviewed this order/product
      if (dto.order_id) {
        const existingReview = await this.reviewRepo.findOne({
          where: {
            customer_id: dto.customer_id,
            order_id: dto.order_id,
            product_id: dto.product_id || undefined
          }
        })

        if (existingReview) {
          throw new Error('Review already exists for this order/product')
        }
      }

      const review = this.reviewRepo.create({
        ...dto,
        status: ReviewStatus.PENDING,
        review_type: dto.review_type || ReviewType.OVERALL
      })

      const savedReview = await this.reviewRepo.save(review)

      // Update seller rating asynchronously
      this.updateSellerRating(dto.seller_id).catch(error => {
        logger.error(`Error updating seller rating for ${dto.seller_id}`, error)
      })

      logger.info(`Created review ${savedReview.id} for seller ${dto.seller_id}`)
      return savedReview

    } catch (error) {
      logger.error('Error creating seller review', error as Error)
      throw error
    }
  }

  /**
   * Get reviews for a seller with filtering
   */
  async getSellerReviews(
    sellerId: string, 
    filters: ReviewFilters = {}
  ): Promise<{ reviews: SellerReview[], total: number }> {
    try {
      const queryBuilder = this.reviewRepo.createQueryBuilder('review')
        .where('review.seller_id = :sellerId', { sellerId })
        .andWhere('review.status = :status', { status: ReviewStatus.APPROVED })

      // Apply filters
      if (filters.rating) {
        queryBuilder.andWhere('review.rating = :rating', { rating: filters.rating })
      }

      if (filters.review_type) {
        queryBuilder.andWhere('review.review_type = :reviewType', { reviewType: filters.review_type })
      }

      if (filters.is_verified_purchase !== undefined) {
        queryBuilder.andWhere('review.is_verified_purchase = :isVerified', { 
          isVerified: filters.is_verified_purchase 
        })
      }

      if (filters.days_back) {
        const cutoffDate = new Date(Date.now() - (filters.days_back * 24 * 60 * 60 * 1000))
        queryBuilder.andWhere('review.created_at >= :cutoffDate', { cutoffDate })
      }

      // Get total count
      const total = await queryBuilder.getCount()

      // Apply pagination and ordering
      queryBuilder
        .orderBy('review.created_at', 'DESC')
        .limit(filters.limit || 20)
        .offset(filters.offset || 0)

      const reviews = await queryBuilder.getMany()

      return { reviews, total }

    } catch (error) {
      logger.error(`Error getting reviews for seller ${sellerId}`, error as Error)
      throw error
    }
  }

  /**
   * Get comprehensive review summary for a seller
   */
  async getSellerReviewSummary(sellerId: string): Promise<ReviewSummary> {
    try {
      const reviews = await this.reviewRepo.find({
        where: { 
          seller_id: sellerId,
          status: ReviewStatus.APPROVED
        },
        order: { created_at: 'DESC' }
      })

      if (reviews.length === 0) {
        return {
          seller_id: sellerId,
          total_reviews: 0,
          average_rating: 0,
          rating_distribution: {},
          breakdown_ratings: {
            item_as_described: 0,
            shipping_speed: 0,
            communication: 0,
            packaging: 0
          },
          recent_reviews: [],
          verified_purchase_percentage: 0
        }
      }

      // Calculate average rating
      const totalRating = reviews.reduce((sum, review) => sum + review.rating, 0)
      const average_rating = totalRating / reviews.length

      // Calculate rating distribution
      const rating_distribution: Record<number, number> = {}
      for (let i = 1; i <= 5; i++) {
        rating_distribution[i] = reviews.filter(r => r.rating === i).length
      }

      // Calculate breakdown ratings
      const breakdownReviews = reviews.filter(r => 
        r.item_as_described_rating && r.shipping_speed_rating && 
        r.communication_rating && r.packaging_rating
      )

      const breakdown_ratings = {
        item_as_described: breakdownReviews.length > 0 
          ? breakdownReviews.reduce((sum, r) => sum + (r.item_as_described_rating || 0), 0) / breakdownReviews.length
          : 0,
        shipping_speed: breakdownReviews.length > 0
          ? breakdownReviews.reduce((sum, r) => sum + (r.shipping_speed_rating || 0), 0) / breakdownReviews.length
          : 0,
        communication: breakdownReviews.length > 0
          ? breakdownReviews.reduce((sum, r) => sum + (r.communication_rating || 0), 0) / breakdownReviews.length
          : 0,
        packaging: breakdownReviews.length > 0
          ? breakdownReviews.reduce((sum, r) => sum + (r.packaging_rating || 0), 0) / breakdownReviews.length
          : 0
      }

      // Get recent reviews (last 10)
      const recent_reviews = reviews.slice(0, 10)

      // Calculate verified purchase percentage
      const verifiedReviews = reviews.filter(r => r.is_verified_purchase).length
      const verified_purchase_percentage = (verifiedReviews / reviews.length) * 100

      return {
        seller_id: sellerId,
        total_reviews: reviews.length,
        average_rating: Math.round(average_rating * 100) / 100,
        rating_distribution,
        breakdown_ratings,
        recent_reviews,
        verified_purchase_percentage: Math.round(verified_purchase_percentage * 100) / 100
      }

    } catch (error) {
      logger.error(`Error getting review summary for seller ${sellerId}`, error as Error)
      throw error
    }
  }

  /**
   * Update a review (for moderation or customer edits)
   */
  async updateReview(
    reviewId: string, 
    updates: Partial<SellerReview>,
    moderatorId?: string
  ): Promise<SellerReview> {
    try {
      const review = await this.reviewRepo.findOne({ where: { id: reviewId } })
      
      if (!review) {
        throw new Error('Review not found')
      }

      // Add moderation info if moderator is updating
      if (moderatorId) {
        updates.moderated_by = moderatorId
        updates.moderated_at = new Date()
      }

      await this.reviewRepo.update(reviewId, updates)
      
      const updatedReview = await this.reviewRepo.findOne({ where: { id: reviewId } })
      
      if (!updatedReview) {
        throw new Error('Failed to retrieve updated review')
      }

      // Update seller rating if status changed
      if (updates.status && updates.status !== review.status) {
        this.updateSellerRating(review.seller_id).catch(error => {
          logger.error(`Error updating seller rating after review update`, error)
        })
      }

      return updatedReview

    } catch (error) {
      logger.error(`Error updating review ${reviewId}`, error as Error)
      throw error
    }
  }

  /**
   * Add seller response to a review
   */
  async addSellerResponse(
    reviewId: string, 
    sellerId: string, 
    response: string
  ): Promise<SellerReview> {
    try {
      const review = await this.reviewRepo.findOne({ where: { id: reviewId } })
      
      if (!review) {
        throw new Error('Review not found')
      }

      if (review.seller_id !== sellerId) {
        throw new Error('Unauthorized to respond to this review')
      }

      if (review.seller_response) {
        throw new Error('Seller response already exists')
      }

      await this.reviewRepo.update(reviewId, {
        seller_response: response,
        seller_response_at: new Date()
      })

      const updatedReview = await this.reviewRepo.findOne({ where: { id: reviewId } })
      
      if (!updatedReview) {
        throw new Error('Failed to retrieve updated review')
      }

      logger.info(`Seller ${sellerId} responded to review ${reviewId}`)
      return updatedReview

    } catch (error) {
      logger.error(`Error adding seller response to review ${reviewId}`, error as Error)
      throw error
    }
  }

  /**
   * Vote on review helpfulness
   */
  async voteOnReview(
    reviewId: string, 
    customerId: string, 
    isHelpful: boolean
  ): Promise<SellerReview> {
    try {
      // Check if customer already voted (you'd need a separate votes table for this)
      // For now, just increment the counters

      const review = await this.reviewRepo.findOne({ where: { id: reviewId } })
      
      if (!review) {
        throw new Error('Review not found')
      }

      const updates: Partial<SellerReview> = {
        total_votes: review.total_votes + 1
      }

      if (isHelpful) {
        updates.helpful_votes = review.helpful_votes + 1
      }

      await this.reviewRepo.update(reviewId, updates)
      
      const updatedReview = await this.reviewRepo.findOne({ where: { id: reviewId } })
      
      if (!updatedReview) {
        throw new Error('Failed to retrieve updated review')
      }

      return updatedReview

    } catch (error) {
      logger.error(`Error voting on review ${reviewId}`, error as Error)
      throw error
    }
  }

  /**
   * Get reviews pending moderation
   */
  async getPendingReviews(limit: number = 50): Promise<SellerReview[]> {
    try {
      return await this.reviewRepo.find({
        where: { status: ReviewStatus.PENDING },
        order: { created_at: 'ASC' },
        take: limit
      })
    } catch (error) {
      logger.error('Error getting pending reviews', error as Error)
      throw error
    }
  }

  /**
   * Bulk approve reviews
   */
  async bulkApproveReviews(reviewIds: string[], moderatorId: string): Promise<number> {
    try {
      const result = await this.reviewRepo.update(
        { id: In(reviewIds) },
        {
          status: ReviewStatus.APPROVED,
          moderated_by: moderatorId,
          moderated_at: new Date()
        }
      )

      // Update affected seller ratings
      const reviews = await this.reviewRepo.find({
        where: { id: In(reviewIds) }
      })

      const sellerIds = [...new Set(reviews.map(r => r.seller_id))]
      
      for (const sellerId of sellerIds) {
        this.updateSellerRating(sellerId).catch(error => {
          logger.error(`Error updating seller rating for ${sellerId}`, error)
        })
      }

      return result.affected || 0

    } catch (error) {
      logger.error('Error bulk approving reviews', error as Error)
      throw error
    }
  }

  /**
   * Update seller rating based on approved reviews
   */
  private async updateSellerRating(sellerId: string): Promise<void> {
    try {
      const approvedReviews = await this.reviewRepo.find({
        where: { 
          seller_id: sellerId,
          status: ReviewStatus.APPROVED
        }
      })

      if (approvedReviews.length === 0) {
        return
      }

      // Calculate overall rating
      const totalRating = approvedReviews.reduce((sum, review) => sum + review.rating, 0)
      const overall_rating = totalRating / approvedReviews.length

      // Calculate breakdown ratings
      const breakdownReviews = approvedReviews.filter(r => 
        r.item_as_described_rating && r.shipping_speed_rating && 
        r.communication_rating && r.packaging_rating
      )

      const breakdown = {
        item_as_described_rating: breakdownReviews.length > 0 
          ? breakdownReviews.reduce((sum, r) => sum + (r.item_as_described_rating || 0), 0) / breakdownReviews.length
          : 0,
        shipping_speed_rating: breakdownReviews.length > 0
          ? breakdownReviews.reduce((sum, r) => sum + (r.shipping_speed_rating || 0), 0) / breakdownReviews.length
          : 0,
        communication_rating: breakdownReviews.length > 0
          ? breakdownReviews.reduce((sum, r) => sum + (r.communication_rating || 0), 0) / breakdownReviews.length
          : 0,
        packaging_rating: breakdownReviews.length > 0
          ? breakdownReviews.reduce((sum, r) => sum + (r.packaging_rating || 0), 0) / breakdownReviews.length
          : 0
      }

      // Get recent reviews (last 30 days)
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      const recentReviews = approvedReviews.filter(r => r.created_at > thirtyDaysAgo)
      
      const recent_average_rating = recentReviews.length > 0
        ? recentReviews.reduce((sum, r) => sum + r.rating, 0) / recentReviews.length
        : 0

      // Update or create seller rating
      let sellerRating = await this.ratingRepo.findOne({ where: { seller_id: sellerId } })

      if (sellerRating) {
        await this.ratingRepo.update(sellerId, {
          overall_rating,
          total_reviews: approvedReviews.length,
          recent_average_rating,
          last_review_at: new Date(),
          ...breakdown
        })
      } else {
        sellerRating = this.ratingRepo.create({
          seller_id: sellerId,
          overall_rating,
          total_reviews: approvedReviews.length,
          recent_average_rating,
          last_review_at: new Date(),
          ...breakdown
        })
        await this.ratingRepo.save(sellerRating)
      }

      logger.info(`Updated rating for seller ${sellerId}: ${overall_rating.toFixed(2)} (${approvedReviews.length} reviews)`)

    } catch (error) {
      logger.error(`Error updating seller rating for ${sellerId}`, error as Error)
      throw error
    }
  }

  /**
   * Clean up old reviews (for GDPR compliance)
   */
  async cleanupOldReviews(daysToKeep: number = 2555): Promise<number> { // ~7 years default
    try {
      const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000)
      
      const result = await this.reviewRepo
        .createQueryBuilder()
        .delete()
        .where('created_at < :cutoffDate', { cutoffDate })
        .andWhere('status = :status', { status: ReviewStatus.REMOVED })
        .execute()

      return result.affected || 0
    } catch (error) {
      logger.error('Error cleaning up old reviews', error as Error)
      return 0
    }
  }
}