import { MigrationInterface, QueryRunner } from "typeorm"

export class InitialMigration20250815000000 implements MigrationInterface {
    name = 'InitialMigration20250815000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Create extensions
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`)
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pg_trgm"`)
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "unaccent"`)

        // Games table
        await queryRunner.query(`
            CREATE TABLE "games" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "code" varchar NOT NULL,
                "name" varchar NOT NULL,
                "display_name" varchar NOT NULL,
                "has_colors" boolean NOT NULL DEFAULT false,
                "has_energy_types" boolean NOT NULL DEFAULT false,
                "has_power_toughness" boolean NOT NULL DEFAULT false,
                "has_levels" boolean NOT NULL DEFAULT false,
                "etl_enabled" boolean NOT NULL DEFAULT true,
                "etl_source" varchar NOT NULL,
                "last_etl_run" TIMESTAMP,
                "card_back_image" varchar NOT NULL,
                "primary_color" varchar NOT NULL,
                "logo_url" varchar NOT NULL,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                "deleted_at" TIMESTAMP,
                CONSTRAINT "PK_games_id" PRIMARY KEY ("id"),
                CONSTRAINT "UQ_games_code" UNIQUE ("code")
            )
        `)

        // Cards table
        await queryRunner.query(`
            CREATE TABLE "cards" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "oracle_id" varchar NOT NULL,
                "name" varchar NOT NULL,
                "normalized_name" varchar NOT NULL,
                "game_id" uuid NOT NULL,
                "oracle_text" text,
                "flavor_text" text,
                "keywords" text[] NOT NULL DEFAULT '{}',
                "primary_type" varchar,
                "subtypes" text[] NOT NULL DEFAULT '{}',
                "supertypes" text[] NOT NULL DEFAULT '{}',
                "mana_cost" varchar,
                "mana_value" integer,
                "colors" text[] NOT NULL DEFAULT '{}',
                "color_identity" text[] NOT NULL DEFAULT '{}',
                "power_value" integer,
                "defense_value" integer,
                "hp" integer,
                "retreat_cost" integer,
                "energy_types" text[] NOT NULL DEFAULT '{}',
                "attribute" varchar,
                "level" integer,
                "rank" integer,
                "attack_value" integer,
                "defense_value_yugioh" integer,
                "cost" integer,
                "power" integer,
                "counter" integer,
                "life" integer,
                "popularity_score" decimal NOT NULL DEFAULT 0,
                "total_views" integer NOT NULL DEFAULT 0,
                "total_searches" integer NOT NULL DEFAULT 0,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                "deleted_at" TIMESTAMP,
                CONSTRAINT "PK_cards_id" PRIMARY KEY ("id"),
                CONSTRAINT "UQ_cards_oracle_id" UNIQUE ("oracle_id"),
                CONSTRAINT "FK_cards_game_id" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE
            )
        `)

        // Card Sets table
        await queryRunner.query(`
            CREATE TABLE "card_sets" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "game_id" uuid NOT NULL,
                "code" varchar NOT NULL,
                "name" varchar NOT NULL,
                "set_type" varchar NOT NULL,
                "block" varchar,
                "release_date" TIMESTAMP NOT NULL,
                "card_count" integer NOT NULL DEFAULT 0,
                "icon_svg_uri" varchar,
                "logo_uri" varchar,
                "mtg_arena_code" varchar,
                "mtg_tcgplayer_id" integer,
                "pokemon_series" varchar,
                "pokemon_legalities" jsonb,
                "is_digital" boolean NOT NULL DEFAULT false,
                "is_foil_only" boolean NOT NULL DEFAULT false,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                "deleted_at" TIMESTAMP,
                CONSTRAINT "PK_card_sets_id" PRIMARY KEY ("id"),
                CONSTRAINT "UQ_card_sets_code_game" UNIQUE ("code", "game_id"),
                CONSTRAINT "FK_card_sets_game_id" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE
            )
        `)

        // Prints table
        await queryRunner.query(`
            CREATE TABLE "prints" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "card_id" uuid NOT NULL,
                "set_id" uuid NOT NULL,
                "number" varchar NOT NULL,
                "rarity" varchar NOT NULL,
                "artist" varchar NOT NULL,
                "language" varchar NOT NULL DEFAULT 'en',
                "image_small" varchar NOT NULL,
                "image_normal" varchar NOT NULL,
                "image_large" varchar NOT NULL,
                "image_art_crop" varchar,
                "image_border_crop" varchar,
                "blurhash" varchar NOT NULL,
                "finish" varchar NOT NULL DEFAULT 'normal',
                "variation" varchar,
                "frame" varchar NOT NULL,
                "border_color" varchar NOT NULL,
                "is_legal_standard" boolean NOT NULL DEFAULT false,
                "is_legal_pioneer" boolean NOT NULL DEFAULT false,
                "is_legal_modern" boolean NOT NULL DEFAULT false,
                "is_legal_legacy" boolean NOT NULL DEFAULT false,
                "is_legal_vintage" boolean NOT NULL DEFAULT false,
                "is_legal_commander" boolean NOT NULL DEFAULT false,
                "tcgplayer_id" varchar,
                "cardmarket_id" varchar,
                "scryfall_id" varchar,
                "current_price_low" decimal,
                "current_price_mid" decimal,
                "current_price_high" decimal,
                "price_updated_at" TIMESTAMP,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                "deleted_at" TIMESTAMP,
                CONSTRAINT "PK_prints_id" PRIMARY KEY ("id"),
                CONSTRAINT "UQ_prints_card_set_number" UNIQUE ("card_id", "set_id", "number", "language", "finish"),
                CONSTRAINT "FK_prints_card_id" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_prints_set_id" FOREIGN KEY ("set_id") REFERENCES "card_sets"("id") ON DELETE CASCADE
            )
        `)

        // Catalog SKUs table
        await queryRunner.query(`
            CREATE TABLE "catalog_skus" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "sku" varchar NOT NULL,
                "print_id" uuid NOT NULL,
                "game_code" varchar NOT NULL,
                "set_code" varchar NOT NULL,
                "card_number" varchar NOT NULL,
                "language" varchar NOT NULL,
                "condition" varchar NOT NULL,
                "finish" varchar NOT NULL,
                "grade" varchar,
                "is_available_b2c" boolean NOT NULL DEFAULT false,
                "is_available_c2c" boolean NOT NULL DEFAULT false,
                "vendor_count" integer NOT NULL DEFAULT 0,
                "min_price" decimal,
                "max_price" decimal,
                "avg_price" decimal,
                "median_price" decimal,
                "market_price" decimal,
                "price_trend" varchar NOT NULL DEFAULT 'stable',
                "price_updated_at" TIMESTAMP,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                "deleted_at" TIMESTAMP,
                CONSTRAINT "PK_catalog_skus_id" PRIMARY KEY ("id"),
                CONSTRAINT "UQ_catalog_skus_sku" UNIQUE ("sku"),
                CONSTRAINT "FK_catalog_skus_print_id" FOREIGN KEY ("print_id") REFERENCES "prints"("id") ON DELETE CASCADE
            )
        `)

        // ETL Jobs table
        await queryRunner.query(`
            CREATE TABLE "etl_jobs" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "game_code" varchar NOT NULL,
                "job_type" varchar NOT NULL,
                "status" varchar NOT NULL DEFAULT 'pending',
                "triggered_by" varchar NOT NULL,
                "trigger_user_id" varchar,
                "batch_size" integer NOT NULL DEFAULT 100,
                "total_records" integer,
                "processed_records" integer NOT NULL DEFAULT 0,
                "failed_records" integer NOT NULL DEFAULT 0,
                "skipped_records" integer NOT NULL DEFAULT 0,
                "started_at" TIMESTAMP,
                "completed_at" TIMESTAMP,
                "duration_ms" integer,
                "result_summary" jsonb,
                "error_message" text,
                "log_file_path" varchar,
                "records_per_second" decimal,
                "peak_memory_usage" integer,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                "deleted_at" TIMESTAMP,
                CONSTRAINT "PK_etl_jobs_id" PRIMARY KEY ("id")
            )
        `)

        // Create search indexes
        await queryRunner.query(`CREATE INDEX "IDX_cards_name_trgm" ON "cards" USING gin ("name" gin_trgm_ops)`)
        await queryRunner.query(`CREATE INDEX "IDX_cards_normalized_name_trgm" ON "cards" USING gin ("normalized_name" gin_trgm_ops)`)
        await queryRunner.query(`CREATE INDEX "IDX_cards_game_id" ON "cards" ("game_id")`)
        await queryRunner.query(`CREATE INDEX "IDX_cards_primary_type" ON "cards" ("primary_type")`)
        await queryRunner.query(`CREATE INDEX "IDX_cards_colors" ON "cards" USING gin ("colors")`)
        await queryRunner.query(`CREATE INDEX "IDX_cards_mana_value" ON "cards" ("mana_value")`)
        await queryRunner.query(`CREATE INDEX "IDX_cards_popularity_score" ON "cards" ("popularity_score" DESC)`)

        await queryRunner.query(`CREATE INDEX "IDX_prints_card_id" ON "prints" ("card_id")`)
        await queryRunner.query(`CREATE INDEX "IDX_prints_set_id" ON "prints" ("set_id")`)
        await queryRunner.query(`CREATE INDEX "IDX_prints_rarity" ON "prints" ("rarity")`)
        await queryRunner.query(`CREATE INDEX "IDX_prints_finish" ON "prints" ("finish")`)
        await queryRunner.query(`CREATE INDEX "IDX_prints_language" ON "prints" ("language")`)

        await queryRunner.query(`CREATE INDEX "IDX_catalog_skus_sku" ON "catalog_skus" ("sku")`)
        await queryRunner.query(`CREATE INDEX "IDX_catalog_skus_print_id" ON "catalog_skus" ("print_id")`)
        await queryRunner.query(`CREATE INDEX "IDX_catalog_skus_game_code" ON "catalog_skus" ("game_code")`)
        await queryRunner.query(`CREATE INDEX "IDX_catalog_skus_condition" ON "catalog_skus" ("condition")`)
        await queryRunner.query(`CREATE INDEX "IDX_catalog_skus_price_range" ON "catalog_skus" ("min_price", "max_price")`)

        await queryRunner.query(`CREATE INDEX "IDX_etl_jobs_game_code" ON "etl_jobs" ("game_code")`)
        await queryRunner.query(`CREATE INDEX "IDX_etl_jobs_status" ON "etl_jobs" ("status")`)
        await queryRunner.query(`CREATE INDEX "IDX_etl_jobs_created_at" ON "etl_jobs" ("created_at" DESC)`)

        // Insert initial game data
        await queryRunner.query(`
            INSERT INTO "games" (
                "code", "name", "display_name", "has_colors", "has_energy_types", 
                "has_power_toughness", "has_levels", "etl_source", "card_back_image", 
                "primary_color", "logo_url"
            ) VALUES 
            (
                'MTG', 'Magic: The Gathering', 'Magic: The Gathering', 
                true, false, true, false, 'scryfall', 
                '/images/card-backs/Back_of_MTG_card.webp', 
                '#FF6B35', '/images/logos/mtg-logo.svg'
            ),
            (
                'POKEMON', 'Pokémon Trading Card Game', 'Pokémon', 
                false, true, false, false, 'pokemon-tcg', 
                '/images/card-backs/Back_of_pokemon_card.webp', 
                '#FFCB05', '/images/logos/pokemon-logo.svg'
            ),
            (
                'YUGIOH', 'Yu-Gi-Oh! Trading Card Game', 'Yu-Gi-Oh!', 
                false, false, true, true, 'ygoprodeck', 
                '/images/card-backs/Back_of_Yu-Gi-Oh_card.webp', 
                '#8B4513', '/images/logos/yugioh-logo.svg'
            ),
            (
                'OPTCG', 'One Piece Card Game', 'One Piece', 
                false, false, true, false, 'onepiece-cardgame', 
                '/images/card-backs/Back_of_OnePiece_card.webp', 
                '#FF4500', '/images/logos/onepiece-logo.svg'
            )
        `)

        console.log('✅ Initial migration completed - Basic TCG catalog schema created')
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "etl_jobs"`)
        await queryRunner.query(`DROP TABLE IF EXISTS "catalog_skus"`)
        await queryRunner.query(`DROP TABLE IF EXISTS "prints"`)
        await queryRunner.query(`DROP TABLE IF EXISTS "card_sets"`)
        await queryRunner.query(`DROP TABLE IF EXISTS "cards"`)
        await queryRunner.query(`DROP TABLE IF EXISTS "games"`)
    }
}