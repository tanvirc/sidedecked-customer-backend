import Bull from 'bull'
import { ETLJobType, ETLJobStatus } from '../types/ETLTypes'
import type { ETLService } from '../services/ETLService'

export interface ETLJobData {
  type: ETLJobType
  game?: string
  setCode?: string
  cardId?: string
  batchSize?: number
  offset?: number
  retryCount?: number
}

export interface ETLJobResult {
  success: boolean
  processed: number
  failed: number
  errors?: string[]
}

export class ETLQueue {
  private queue: Bull.Queue<ETLJobData>
  private etlService?: ETLService

  constructor(redisUrl?: string) {
    this.queue = new Bull<ETLJobData>('etl-queue', redisUrl || 'redis://localhost:6379')
    this.setupProcessors()
  }

  setETLService(service: ETLService) {
    this.etlService = service
  }

  private setupProcessors() {
    this.queue.process('sync-scryfall', async (job) => {
      if (!this.etlService) {
        throw new Error('ETL Service not initialized')
      }
      return this.processETLJob(job)
    })

    this.queue.process('sync-pokemon', async (job) => {
      if (!this.etlService) {
        throw new Error('ETL Service not initialized')
      }
      return this.processETLJob(job)
    })

    this.queue.process('sync-yugioh', async (job) => {
      if (!this.etlService) {
        throw new Error('ETL Service not initialized')
      }
      return this.processETLJob(job)
    })

    this.queue.process('sync-onepiece', async (job) => {
      if (!this.etlService) {
        throw new Error('ETL Service not initialized')
      }
      return this.processETLJob(job)
    })
  }

  private async processETLJob(job: Bull.Job<ETLJobData>): Promise<ETLJobResult> {
    const { type, game, setCode, cardId, batchSize = 100 } = job.data

    try {
      let processed = 0
      let failed = 0
      const errors: string[] = []

      switch (type) {
        case ETLJobType.FULL_SYNC:
          if (game === 'MTG') {
            await this.etlService!.syncMTGCards()
          } else if (game === 'POKEMON') {
            await this.etlService!.syncPokemonCards()
          } else if (game === 'YUGIOH') {
            await this.etlService!.syncYuGiOhCards()
          } else if (game === 'ONEPIECE') {
            await this.etlService!.syncOnePieceCards()
          }
          processed = 1
          break

        case ETLJobType.SET_SYNC:
          if (setCode && game) {
            // Implement set-specific sync
            processed = 1
          }
          break

        case ETLJobType.CARD_SYNC:
          if (cardId) {
            // Implement single card sync
            processed = 1
          }
          break

        case ETLJobType.PRICE_UPDATE:
          // Implement price update logic
          processed = 1
          break

        case ETLJobType.IMAGE_SYNC:
          // Image sync handled by ImageQueue
          processed = 1
          break
      }

      return {
        success: true,
        processed,
        failed,
        errors: errors.length > 0 ? errors : undefined
      }
    } catch (error) {
      return {
        success: false,
        processed: 0,
        failed: 1,
        errors: [error instanceof Error ? error.message : 'Unknown error']
      }
    }
  }

  async addJob(type: ETLJobType, data: Partial<ETLJobData> = {}) {
    const jobData: ETLJobData = {
      type,
      ...data
    }

    const jobOptions: Bull.JobOptions = {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000
      },
      removeOnComplete: true,
      removeOnFail: false
    }

    const jobName = `sync-${data.game?.toLowerCase() || 'all'}`
    return this.queue.add(jobName, jobData, jobOptions)
  }

  async getJobCounts() {
    return this.queue.getJobCounts()
  }

  async clean(grace: number) {
    await this.queue.clean(grace)
  }

  async close() {
    await this.queue.close()
  }
}

export default ETLQueue