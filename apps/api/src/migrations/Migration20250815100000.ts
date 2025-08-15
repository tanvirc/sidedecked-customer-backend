import { MigrationInterface, QueryRunner } from 'typeorm'

export class InitialTCGCatalogSetup20250815100000 implements MigrationInterface {
  name = 'InitialTCGCatalogSetup20250815100000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enable required PostgreSQL extensions
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`)
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pg_trgm"`)
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "unaccent"`)
    
    // Create enum types
    await queryRunner.query(`
      CREATE TYPE etl_job_status AS ENUM (
        'pending', 'running', 'completed', 'failed', 'cancelled', 'partial'
      )
    `)
    
    await queryRunner.query(`
      CREATE TYPE etl_job_type AS ENUM (
        'full_sync', 'incremental_sync', 'price_update', 'image_sync', 
        'banlist_update', 'metadata_update'
      )
    `)
    
    await queryRunner.query(`
      CREATE TYPE image_status AS ENUM (
        'pending', 'processing', 'completed', 'failed', 'retry'
      )
    `)
    
    await queryRunner.query(`
      CREATE TYPE image_type AS ENUM (
        'main', 'back', 'art_crop', 'border_crop', 'thumbnail', 'full'
      )
    `)

    // Create games table
    await queryRunner.query(`
      CREATE TABLE "games" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "code" varchar(20) UNIQUE NOT NULL,
        "name" varchar(100) NOT NULL,
        "displayName" varchar(100) NOT NULL,
        "hasColors" boolean DEFAULT false,
        "hasEnergyTypes" boolean DEFAULT false,
        "hasAttributes" boolean DEFAULT false,
        "hasLevels" boolean DEFAULT false,
        "hasEvolution" boolean DEFAULT false,
        "hasLifeSystem" boolean DEFAULT false,
        "resourceType" varchar(50),
        "resourceColors" jsonb,
        "apiProvider" varchar(100),
        "apiEndpoint" text,
        "apiKeyRequired" boolean DEFAULT false,
        "updateFrequency" interval DEFAULT '24 hours',
        "etlEnabled" boolean DEFAULT true,
        "etlSource" varchar(100),
        "lastEtlRun" timestamp,
        "cardBackImage" varchar(500),
        "primaryColor" varchar(20),
        "logoUrl" varchar(500),
        "createdAt" timestamp DEFAULT now(),
        "updatedAt" timestamp DEFAULT now(),
        "deletedAt" timestamp
      )
    `)

    // Create card_sets table
    await queryRunner.query(`
      CREATE TABLE "card_sets" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "gameId" uuid REFERENCES "games"("id") NOT NULL,
        "code" varchar(50) NOT NULL,
        "name" varchar(255) NOT NULL,
        "releaseDate" date,
        "setType" varchar(50),
        "cardCount" integer,
        "isDigitalOnly" boolean DEFAULT false,
        "isFoilOnly" boolean DEFAULT false,
        "hasAlternateArts" boolean DEFAULT false,
        "rotationDate" date,
        "isStandardLegal" boolean DEFAULT true,
        "setIconUrl" text,
        "setLogoUrl" text,
        "releasePriceAvg" decimal(10,2),
        "currentPriceAvg" decimal(10,2),
        "createdAt" timestamp DEFAULT now(),
        "updatedAt" timestamp DEFAULT now(),
        "deletedAt" timestamp,
        UNIQUE("gameId", "code")
      )
    `)

    // Create cards table with full-text search
    await queryRunner.query(`
      CREATE TABLE "cards" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "gameId" uuid REFERENCES "games"("id") NOT NULL,
        "oracleId" uuid UNIQUE NOT NULL,
        "oracleHash" varchar(64) UNIQUE NOT NULL,
        "name" varchar(500) NOT NULL,
        "normalizedName" varchar(500) NOT NULL,
        "primaryType" varchar(100),
        "subtypes" text[],
        "supertypes" text[],
        "powerValue" integer,
        "defenseValue" integer,
        "oracleText" text,
        "flavorText" text,
        "keywords" text[],
        "manaCost" varchar(100),
        "manaValue" integer,
        "colors" varchar(1)[],
        "colorIdentity" varchar(1)[],
        "hp" integer,
        "retreatCost" integer,
        "energyTypes" varchar(20)[],
        "evolutionStage" varchar(20),
        "attribute" varchar(20),
        "levelRank" integer,
        "linkValue" integer,
        "linkArrows" varchar(2)[],
        "pendulumScale" integer,
        "attackValue" integer,
        "defenseValueYugioh" integer,
        "cost" integer,
        "donCost" integer,
        "lifeValue" integer,
        "counterValue" integer,
        "power" integer,
        "extendedAttributes" jsonb DEFAULT '{}',
        "searchVector" tsvector,
        "popularityScore" decimal DEFAULT 0,
        "totalViews" integer DEFAULT 0,
        "totalSearches" integer DEFAULT 0,
        "createdAt" timestamp DEFAULT now(),
        "updatedAt" timestamp DEFAULT now(),
        "deletedAt" timestamp
      )
    `)

    // Create prints table
    await queryRunner.query(`
      CREATE TABLE "prints" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "cardId" uuid REFERENCES "cards"("id") NOT NULL,
        "setId" uuid REFERENCES "card_sets"("id") NOT NULL,
        "printHash" varchar(64) UNIQUE NOT NULL,
        "collectorNumber" varchar(50) NOT NULL,
        "rarity" varchar(20),
        "artist" varchar(255),
        "flavorText" text,
        "language" varchar(10) DEFAULT 'en',
        "isFoilAvailable" boolean DEFAULT false,
        "isAlternateArt" boolean DEFAULT false,
        "isPromo" boolean DEFAULT false,
        "isFirstEdition" boolean DEFAULT false,
        "finish" varchar(50) DEFAULT 'normal',
        "variation" varchar(100),
        "frame" varchar(50),
        "borderColor" varchar(50),
        "isLegalStandard" boolean DEFAULT false,
        "isLegalPioneer" boolean DEFAULT false,
        "isLegalModern" boolean DEFAULT false,
        "isLegalLegacy" boolean DEFAULT false,
        "isLegalVintage" boolean DEFAULT false,
        "isLegalCommander" boolean DEFAULT false,
        "tcgplayerId" varchar(50),
        "cardmarketId" varchar(50),
        "scryfallId" varchar(50),
        "pokemonTcgId" varchar(50),
        "yugiohProdeckId" varchar(50),
        "originalPrice" decimal(10,2),
        "currentLowPrice" decimal(10,2),
        "currentMarketPrice" decimal(10,2),
        "currentHighPrice" decimal(10,2),
        "priceUpdatedAt" timestamp,
        "isInStock" boolean DEFAULT false,
        "totalInventory" integer DEFAULT 0,
        "imageSmall" varchar(500),
        "imageNormal" varchar(500),
        "imageLarge" varchar(500),
        "imageArtCrop" varchar(500),
        "imageBorderCrop" varchar(500),
        "blurhash" varchar(255),
        "createdAt" timestamp DEFAULT now(),
        "updatedAt" timestamp DEFAULT now(),
        "deletedAt" timestamp,
        UNIQUE("cardId", "setId", "collectorNumber")
      )
    `)

    // Create catalog_skus table
    await queryRunner.query(`
      CREATE TABLE "catalog_skus" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "printId" uuid REFERENCES "prints"("id") NOT NULL,
        "sku" varchar(200) UNIQUE NOT NULL,
        "gameCode" varchar(20) NOT NULL,
        "setCode" varchar(50) NOT NULL,
        "collectorNumber" varchar(50) NOT NULL,
        "languageCode" varchar(10) NOT NULL,
        "conditionCode" varchar(10) NOT NULL,
        "finishCode" varchar(20) NOT NULL,
        "isGraded" boolean DEFAULT false,
        "gradingCompany" varchar(20),
        "gradeValue" varchar(10),
        "gradeCertNumber" varchar(50),
        "hasB2cInventory" boolean DEFAULT false,
        "hasC2cListings" boolean DEFAULT false,
        "vendorCount" integer DEFAULT 0,
        "lowestPrice" decimal(10,2),
        "marketPrice" decimal(10,2),
        "highestPrice" decimal(10,2),
        "averagePrice" decimal(10,2),
        "medianPrice" decimal(10,2),
        "priceTrend" varchar(20) DEFAULT 'stable',
        "priceChangePercent" decimal(5,2),
        "lastPriceUpdate" timestamp,
        "viewCount" integer DEFAULT 0,
        "searchCount" integer DEFAULT 0,
        "cartAddCount" integer DEFAULT 0,
        "purchaseCount" integer DEFAULT 0,
        "watchlistCount" integer DEFAULT 0,
        "totalQuantityAvailable" integer DEFAULT 0,
        "lastStockUpdate" timestamp,
        "isActive" boolean DEFAULT true,
        "vendorSkuMappings" jsonb,
        "createdAt" timestamp DEFAULT now(),
        "updatedAt" timestamp DEFAULT now(),
        "deletedAt" timestamp
      )
    `)

    // Create card_images table
    await queryRunner.query(`
      CREATE TABLE "card_images" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "printId" uuid REFERENCES "prints"("id") ON DELETE CASCADE NOT NULL,
        "imageType" image_type DEFAULT 'main',
        "sourceUrl" text NOT NULL,
        "sourceProvider" varchar(50),
        "storageUrls" jsonb,
        "blurhash" varchar(255),
        "cdnUrls" jsonb,
        "status" image_status DEFAULT 'pending',
        "processedAt" timestamp,
        "errorMessage" text,
        "retryCount" integer DEFAULT 0,
        "nextRetryAt" timestamp,
        "fileSize" integer,
        "width" integer,
        "height" integer,
        "format" varchar(10),
        "mimeType" varchar(50),
        "optimizationMetrics" jsonb,
        "sha256Hash" varchar(64),
        "md5Hash" varchar(32),
        "qualityScore" integer,
        "isHighRes" boolean DEFAULT false,
        "downloadCount" integer DEFAULT 0,
        "lastAccessedAt" timestamp,
        "createdAt" timestamp DEFAULT now(),
        "updatedAt" timestamp DEFAULT now(),
        UNIQUE("printId", "imageType")
      )
    `)

    // Create etl_jobs table
    await queryRunner.query(`
      CREATE TABLE "etl_jobs" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "jobName" varchar(100) NOT NULL,
        "jobType" etl_job_type NOT NULL,
        "gameCode" varchar(20) NOT NULL,
        "dataSource" varchar(100),
        "status" etl_job_status DEFAULT 'pending',
        "startedAt" timestamp,
        "completedAt" timestamp,
        "durationMs" integer,
        "totalRecords" integer DEFAULT 0,
        "processedRecords" integer DEFAULT 0,
        "successfulRecords" integer DEFAULT 0,
        "failedRecords" integer DEFAULT 0,
        "skippedRecords" integer DEFAULT 0,
        "progressPercent" decimal(5,2) DEFAULT 0,
        "cardsCreated" integer DEFAULT 0,
        "cardsUpdated" integer DEFAULT 0,
        "cardsDeleted" integer DEFAULT 0,
        "printsCreated" integer DEFAULT 0,
        "printsUpdated" integer DEFAULT 0,
        "imagesQueued" integer DEFAULT 0,
        "skusGenerated" integer DEFAULT 0,
        "errorMessage" text,
        "errors" jsonb,
        "retryCount" integer DEFAULT 0,
        "maxRetries" integer DEFAULT 5,
        "config" jsonb,
        "checkpoint" jsonb,
        "apiCallsCount" integer DEFAULT 0,
        "apiErrorsCount" integer DEFAULT 0,
        "apiResponseTimeAvg" decimal(10,2),
        "metrics" jsonb,
        "circuitBreakerOpen" boolean DEFAULT false,
        "circuitBreakerFailures" integer DEFAULT 0,
        "circuitBreakerResetAt" timestamp,
        "isScheduled" boolean DEFAULT false,
        "cronExpression" varchar(50),
        "nextRunAt" timestamp,
        "triggeredBy" varchar(100),
        "metadata" jsonb,
        "createdAt" timestamp DEFAULT now(),
        "updatedAt" timestamp DEFAULT now()
      )
    `)

    // Create formats table
    await queryRunner.query(`
      CREATE TABLE "formats" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "gameId" uuid REFERENCES "games"("id") NOT NULL,
        "code" varchar(50) NOT NULL,
        "name" varchar(100) NOT NULL,
        "formatType" varchar(50),
        "isRotating" boolean DEFAULT false,
        "rotationSchedule" varchar(50),
        "minDeckSize" integer,
        "maxDeckSize" integer,
        "maxCopiesPerCard" integer DEFAULT 4,
        "allowsSideboard" boolean DEFAULT true,
        "maxSideboardSize" integer DEFAULT 15,
        "bannedCardTypes" text[],
        "requiredCardTypes" text[],
        "specialRules" jsonb,
        "isActive" boolean DEFAULT true,
        "createdAt" timestamp DEFAULT now(),
        "updatedAt" timestamp DEFAULT now(),
        UNIQUE("gameId", "code")
      )
    `)

    // Create performance-optimized indexes
    // Games indexes
    await queryRunner.query(`CREATE INDEX "idx_games_code" ON "games" ("code")`)
    await queryRunner.query(`CREATE INDEX "idx_games_etl_enabled" ON "games" ("etlEnabled")`)

    // Card sets indexes
    await queryRunner.query(`CREATE INDEX "idx_sets_game_code" ON "card_sets" ("gameId", "code")`)
    await queryRunner.query(`CREATE INDEX "idx_sets_release_date" ON "card_sets" ("releaseDate")`)
    await queryRunner.query(`CREATE INDEX "idx_sets_standard_legal" ON "card_sets" ("isStandardLegal")`)

    // Cards indexes for high-performance search
    await queryRunner.query(`CREATE INDEX "idx_cards_oracle_id" ON "cards" ("oracleId")`)
    await queryRunner.query(`CREATE INDEX "idx_cards_oracle_hash" ON "cards" ("oracleHash")`)
    await queryRunner.query(`CREATE INDEX "idx_cards_game_name" ON "cards" ("gameId", "normalizedName")`)
    await queryRunner.query(`CREATE INDEX "idx_cards_search_name" ON "cards" USING gin ("normalizedName" gin_trgm_ops)`)
    await queryRunner.query(`CREATE INDEX "idx_cards_primary_type" ON "cards" ("primaryType")`)
    await queryRunner.query(`CREATE INDEX "idx_cards_mana_value" ON "cards" ("manaValue") WHERE "manaValue" IS NOT NULL`)
    await queryRunner.query(`CREATE INDEX "idx_cards_colors" ON "cards" USING gin ("colors")`)
    await queryRunner.query(`CREATE INDEX "idx_cards_popularity" ON "cards" ("popularityScore" DESC)`)
    await queryRunner.query(`CREATE INDEX "idx_cards_search_vector" ON "cards" USING gin ("searchVector")`)

    // Prints indexes
    await queryRunner.query(`CREATE INDEX "idx_prints_hash" ON "prints" ("printHash")`)
    await queryRunner.query(`CREATE INDEX "idx_prints_card_set" ON "prints" ("cardId", "setId")`)
    await queryRunner.query(`CREATE INDEX "idx_prints_set" ON "prints" ("setId")`)
    await queryRunner.query(`CREATE INDEX "idx_prints_rarity" ON "prints" ("rarity")`)
    await queryRunner.query(`CREATE INDEX "idx_prints_artist" ON "prints" ("artist")`)
    await queryRunner.query(`CREATE INDEX "idx_prints_language" ON "prints" ("language")`)
    await queryRunner.query(`CREATE INDEX "idx_prints_finish" ON "prints" ("finish")`)
    await queryRunner.query(`CREATE INDEX "idx_prints_foil" ON "prints" ("isFoilAvailable")`)

    // Catalog SKUs indexes for marketplace queries
    await queryRunner.query(`CREATE INDEX "idx_sku_lookup" ON "catalog_skus" ("sku")`)
    await queryRunner.query(`CREATE INDEX "idx_sku_components" ON "catalog_skus" ("gameCode", "setCode", "collectorNumber")`)
    await queryRunner.query(`CREATE INDEX "idx_sku_market" ON "catalog_skus" ("hasB2cInventory", "hasC2cListings")`)
    await queryRunner.query(`CREATE INDEX "idx_sku_price_range" ON "catalog_skus" ("lowestPrice", "highestPrice") WHERE "lowestPrice" IS NOT NULL`)
    await queryRunner.query(`CREATE INDEX "idx_sku_condition" ON "catalog_skus" ("conditionCode")`)
    await queryRunner.query(`CREATE INDEX "idx_sku_grade" ON "catalog_skus" ("isGraded", "gradingCompany", "gradeValue")`)
    await queryRunner.query(`CREATE INDEX "idx_sku_active" ON "catalog_skus" ("isActive") WHERE "isActive" = true`)
    await queryRunner.query(`CREATE INDEX "idx_sku_price_update" ON "catalog_skus" ("lastPriceUpdate" DESC NULLS LAST)`)

    // Card images indexes
    await queryRunner.query(`CREATE INDEX "idx_images_print_type" ON "card_images" ("printId", "imageType")`)
    await queryRunner.query(`CREATE INDEX "idx_images_status" ON "card_images" ("status")`)
    await queryRunner.query(`CREATE INDEX "idx_images_retry" ON "card_images" ("status", "retryCount") WHERE "status" = 'failed'`)
    await queryRunner.query(`CREATE INDEX "idx_images_processing" ON "card_images" ("status", "nextRetryAt") WHERE "status" = 'retry'`)

    // ETL jobs indexes
    await queryRunner.query(`CREATE INDEX "idx_etl_jobs_status" ON "etl_jobs" ("status")`)
    await queryRunner.query(`CREATE INDEX "idx_etl_jobs_game_type" ON "etl_jobs" ("gameCode", "jobType")`)
    await queryRunner.query(`CREATE INDEX "idx_etl_jobs_started_at" ON "etl_jobs" ("startedAt" DESC NULLS LAST)`)
    await queryRunner.query(`CREATE INDEX "idx_etl_jobs_scheduled" ON "etl_jobs" ("isScheduled", "nextRunAt") WHERE "isScheduled" = true`)

    // Formats indexes
    await queryRunner.query(`CREATE INDEX "idx_formats_game_code" ON "formats" ("gameId", "code")`)
    await queryRunner.query(`CREATE INDEX "idx_formats_active" ON "formats" ("isActive") WHERE "isActive" = true`)

    // Create full-text search trigger for cards
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION update_card_search_vector()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW."searchVector" := 
          setweight(to_tsvector('english', COALESCE(NEW."name", '')), 'A') ||
          setweight(to_tsvector('english', COALESCE(NEW."oracleText", '')), 'B') ||
          setweight(to_tsvector('english', COALESCE(array_to_string(NEW."keywords", ' '), '')), 'C') ||
          setweight(to_tsvector('english', COALESCE(NEW."primaryType", '')), 'D');
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `)

    await queryRunner.query(`
      CREATE TRIGGER update_card_search_vector_trigger
      BEFORE INSERT OR UPDATE ON "cards"
      FOR EACH ROW EXECUTE FUNCTION update_card_search_vector();
    `)

    // Insert default games data
    await queryRunner.query(`
      INSERT INTO "games" (
        "code", "name", "displayName", "hasColors", "hasEnergyTypes", "hasAttributes", 
        "hasLevels", "hasEvolution", "hasLifeSystem", "resourceType", "resourceColors",
        "apiProvider", "apiEndpoint", "etlEnabled"
      ) VALUES 
      (
        'MTG', 'Magic: The Gathering', 'Magic: The Gathering', 
        true, false, false, true, false, false, 'mana', 
        '["W","U","B","R","G"]'::jsonb, 'scryfall', 
        'https://api.scryfall.com', true
      ),
      (
        'POKEMON', 'Pokémon Trading Card Game', 'Pokémon TCG', 
        false, true, false, false, true, false, 'energy', 
        '["Grass","Fire","Water","Lightning","Psychic","Fighting","Darkness","Metal","Fairy","Dragon","Colorless"]'::jsonb,
        'pokemon_tcg', 'https://api.pokemontcg.io/v2', true
      ),
      (
        'YUGIOH', 'Yu-Gi-Oh! Trading Card Game', 'Yu-Gi-Oh!', 
        false, false, true, true, false, false, 'none', null,
        'ygoprodeck', 'https://db.ygoprodeck.com/api/v7', true
      ),
      (
        'OPTCG', 'One Piece Card Game', 'One Piece TCG', 
        true, false, false, false, false, true, 'don', 
        '["Red","Green","Blue","Purple","Yellow","Black"]'::jsonb,
        'onepiece_tcg', 'https://onepiece-cardgame.dev/api', true
      )
    `)
    
    console.log('✅ Initial TCG Catalog database setup completed successfully!')
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop all indexes
    const indexes = [
      'idx_games_code', 'idx_games_etl_enabled', 'idx_sets_game_code', 
      'idx_sets_release_date', 'idx_sets_standard_legal', 'idx_cards_oracle_id',
      'idx_cards_oracle_hash', 'idx_cards_game_name', 'idx_cards_search_name',
      'idx_cards_primary_type', 'idx_cards_mana_value', 'idx_cards_colors',
      'idx_cards_popularity', 'idx_cards_search_vector', 'idx_prints_hash',
      'idx_prints_card_set', 'idx_prints_set', 'idx_prints_rarity',
      'idx_prints_artist', 'idx_prints_language', 'idx_prints_finish',
      'idx_prints_foil', 'idx_sku_lookup', 'idx_sku_components',
      'idx_sku_market', 'idx_sku_price_range', 'idx_sku_condition',
      'idx_sku_grade', 'idx_sku_active', 'idx_sku_price_update',
      'idx_images_print_type', 'idx_images_status', 'idx_images_retry',
      'idx_images_processing', 'idx_etl_jobs_status', 'idx_etl_jobs_game_type',
      'idx_etl_jobs_started_at', 'idx_etl_jobs_scheduled', 'idx_formats_game_code',
      'idx_formats_active'
    ]

    for (const index of indexes) {
      await queryRunner.query(`DROP INDEX IF EXISTS "${index}"`)
    }

    // Drop trigger and function
    await queryRunner.query(`DROP TRIGGER IF EXISTS update_card_search_vector_trigger ON "cards"`)
    await queryRunner.query(`DROP FUNCTION IF EXISTS update_card_search_vector()`)

    // Drop tables in reverse order
    const tables = [
      'formats', 'etl_jobs', 'card_images', 'catalog_skus', 
      'prints', 'cards', 'card_sets', 'games'
    ]

    for (const table of tables) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}" CASCADE`)
    }

    // Drop enum types
    await queryRunner.query(`DROP TYPE IF EXISTS image_type`)
    await queryRunner.query(`DROP TYPE IF EXISTS image_status`)
    await queryRunner.query(`DROP TYPE IF EXISTS etl_job_type`)
    await queryRunner.query(`DROP TYPE IF EXISTS etl_job_status`)

    console.log('🔄 TCG Catalog database teardown completed')
  }
}