import Bull from 'bull'
import { config } from '../config/env'
import { logger } from '../../packages/tcg-catalog/src/utils/Logger'

async function checkQueueStatus() {
  try {
    const redisUrl = config.REDIS_URL || 'redis://localhost:6379'
    const imageQueue = new Bull('image-processing', redisUrl)
    
    logger.info('📊 Checking queue status...')
    
    // Get queue counts
    const counts = await imageQueue.getJobCounts()
    console.log('\nQueue Counts:', counts)
    
    // Get waiting jobs
    const waitingJobs = await imageQueue.getWaiting(0, 5)
    if (waitingJobs.length > 0) {
      console.log('\n=== WAITING JOBS ===')
      for (const job of waitingJobs) {
        console.log('Job ID:', job.id)
        console.log('Job Data:', JSON.stringify(job.data, null, 2))
        console.log('---')
      }
    }
    
    // Get active jobs
    const activeJobs = await imageQueue.getActive(0, 5)
    if (activeJobs.length > 0) {
      console.log('\n=== ACTIVE JOBS ===')
      for (const job of activeJobs) {
        console.log('Job ID:', job.id)
        console.log('Job Data:', JSON.stringify(job.data, null, 2))
        console.log('---')
      }
    }
    
    // Get delayed jobs
    const delayedJobs = await imageQueue.getDelayed(0, 5)
    if (delayedJobs.length > 0) {
      console.log('\n=== DELAYED JOBS ===')
      for (const job of delayedJobs) {
        console.log('Job ID:', job.id)
        console.log('Delay:', job.opts.delay)
        console.log('Job Data:', JSON.stringify(job.data, null, 2))
        console.log('---')
      }
    }
    
    // Get completed jobs
    const completedJobs = await imageQueue.getCompleted(0, 5)
    if (completedJobs.length > 0) {
      console.log('\n=== RECENTLY COMPLETED JOBS ===')
      for (const job of completedJobs) {
        console.log('Job ID:', job.id)
        console.log('---')
      }
    }
    
    // Check if queue is paused
    const isPaused = await imageQueue.isPaused()
    console.log('\nQueue Paused:', isPaused)
    
    await imageQueue.close()
    process.exit(0)
  } catch (error) {
    logger.error('Failed to check queue status', error as Error)
    process.exit(1)
  }
}

checkQueueStatus()