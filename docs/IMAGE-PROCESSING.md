# Image Processing System Documentation

## Overview

The TCG catalog image processing system handles downloading, optimizing, and serving card images for all supported trading card games. It features:

- **Automatic image downloading** during ETL from game APIs
- **WebP optimization** for smaller file sizes and faster loading
- **Multiple size variants** (thumbnail, small, normal, large)
- **Blurhash generation** for progressive loading placeholders
- **MinIO/S3 storage** for scalable image hosting
- **Async processing** with Bull queues for performance
- **Automatic retry** for failed image downloads
- **CDN-ready URLs** for global content delivery

## Architecture

```
ETL Process → Image Queue → Image Worker → MinIO Storage → API → Storefront
     ↓            ↓             ↓              ↓            ↓         ↓
  Extract     Queue Job     Process      Store WebP    Return    Display
   Images                   & Optimize     Images       URLs      Cards
```

## Setup Instructions

### 1. Environment Configuration

Add the following to your `.env` file:

```env
# MinIO/S3 Configuration
MINIO_ENDPOINT=localhost           # Or your MinIO server
MINIO_ACCESS_KEY=your-access-key
MINIO_SECRET_KEY=your-secret-key
MINIO_BUCKET=sidedecked-card-images
MINIO_REGION=us-east-1

# CDN Configuration (optional)
CDN_BASE_URL=https://cdn.yourdomain.com  # Optional, falls back to MinIO URL

# Redis Configuration (for queues)
REDIS_URL=redis://localhost:6379
```

### 2. Start Required Services

```bash
# Start MinIO (if running locally)
docker run -p 9000:9000 -p 9001:9001 \
  -e "MINIO_ROOT_USER=minioadmin" \
  -e "MINIO_ROOT_PASSWORD=minioadmin" \
  minio/minio server /data --console-address ":9001"

# Start Redis (if running locally)
docker run -p 6379:6379 redis:alpine
```

### 3. Start the Image Worker

The image worker processes queued images in the background:

```bash
# In a separate terminal
cd customer-backend
npm run worker:images
```

You should see:
```
🎨 Starting image processing worker
✅ Image worker ready and processing jobs
```

### 4. Run ETL to Import Cards

```bash
# Import cards with images
npm run etl -- --game=MTG --limit=100

# Or import all games
npm run etl -- --all --limit=500
```

The ETL will:
1. Download card data from game APIs
2. Queue images for processing
3. The worker will process them asynchronously

### 5. Verify the System

Run the test script to verify everything is working:

```bash
npm run test:images
```

This will:
- Test storage setup
- Run a small ETL
- Verify images are queued
- Check processing status
- Test API endpoints
- Validate image URLs

## Usage

### API Endpoints

Cards now include image data automatically:

```typescript
// GET /api/catalog/cards/:id
{
  "id": "card-id",
  "name": "Lightning Bolt",
  "prints": [
    {
      "id": "print-id",
      "blurhash": "L6PZfSi_.AyE...",
      "images": {
        "thumbnail": "https://cdn.../cards/print-id/normal/thumbnail.webp",
        "small": "https://cdn.../cards/print-id/normal/small.webp",
        "normal": "https://cdn.../cards/print-id/normal/normal.webp",
        "large": "https://cdn.../cards/print-id/normal/large.webp"
      }
    }
  ]
}
```

### Frontend Usage

The storefront automatically handles images:

```typescript
import { getCardImageUrl, getCardBlurhash } from '@/lib/data/cards'

// Get image URL for a card
const imageUrl = getCardImageUrl(card, 'normal')
const blurhash = getCardBlurhash(card)

// The CardGridItem component already handles this
<CardGridItem card={card} />
```

## Image Processing Details

### Size Variants

| Size      | Dimensions | Quality | Use Case           |
|-----------|------------|---------|-------------------|
| thumbnail | 150×209    | 80%     | Lists, search     |
| small     | 300×418    | 85%     | Grid views        |
| normal    | 488×680    | 90%     | Detail views      |
| large     | 672×936    | 95%     | Zoom, full screen |

### WebP Optimization

All images are converted to WebP format with:
- Smart subsample for better compression
- Progressive encoding
- Optimized quality settings per size
- 50-70% smaller than JPEG

### Blurhash

Each image generates a blurhash for instant placeholders:
- 4×3 component resolution
- ~30 character string
- Renders as blurred preview while loading

## Monitoring

### Worker Statistics

The worker logs statistics every minute:

```
📊 Queue statistics {
  waiting: 45,
  active: 3,
  completed: 1250,
  failed: 2,
  processed: 1250
}
```

### Image Status Tracking

Check image processing status in the database:

```sql
-- View processing status
SELECT status, COUNT(*) 
FROM card_images 
GROUP BY status;

-- Find failed images
SELECT * FROM card_images 
WHERE status = 'failed' 
ORDER BY updated_at DESC;
```

### Queue Management

```bash
# Check queue status via Bull Board (if configured)
# Or use the API endpoints:
GET /api/admin/queues/image-processing/stats
```

## Troubleshooting

### Images Not Processing

1. **Check worker is running**: 
   ```bash
   npm run worker:images
   ```

2. **Check Redis connection**:
   ```bash
   redis-cli ping
   ```

3. **Check MinIO is accessible**:
   ```bash
   curl http://localhost:9000/minio/health/live
   ```

### Failed Images

The worker automatically retries failed images every 5 minutes (up to 3 times).

To manually retry:
```sql
UPDATE card_images 
SET status = 'pending', retry_count = 0 
WHERE status = 'failed';
```

### Storage Issues

1. **Verify bucket exists**:
   ```bash
   mc ls minio/sidedecked-card-images
   ```

2. **Check permissions**:
   The bucket needs public read access for images to be viewable

3. **Test upload manually**:
   ```bash
   npm run test:images
   ```

## Performance Optimization

### Caching

- Images are cached by CDN with 1-year TTL
- Browser caching via Cache-Control headers
- Blurhash provides instant placeholders

### Concurrent Processing

- Worker processes 3 images concurrently
- Adjust in `image-worker.ts`:
  ```typescript
  this.queue.process('process-images', 3, async (job) => {
  ```

### Rate Limiting

- ETL respects API rate limits
- Image downloads are throttled to prevent overwhelming sources

## Maintenance

### Cleanup Old Jobs

The worker automatically cleans completed jobs older than 48 hours.

Manual cleanup:
```typescript
const queue = getImageQueue()
await queue.clean(24 * 60 * 60 * 1000, 'completed')
await queue.clean(24 * 60 * 60 * 1000, 'failed')
```

### Reprocess All Images

To reprocess all images (e.g., after changing sizes):

```sql
-- Reset all images to pending
UPDATE card_images SET status = 'pending';

-- Or delete to re-download
TRUNCATE card_images;
```

Then restart the worker.

## Future Enhancements

- [ ] Add image deduplication for identical card arts
- [ ] Implement smart cropping for card art extraction
- [ ] Add WebP fallback to JPEG for older browsers
- [ ] Implement image quality analysis and scoring
- [ ] Add OCR for text extraction from card images
- [ ] Implement distributed processing across multiple workers
- [ ] Add image CDN with geographic distribution
- [ ] Implement progressive JPEG as WebP fallback