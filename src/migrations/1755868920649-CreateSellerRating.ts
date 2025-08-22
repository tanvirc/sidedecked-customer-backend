import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateSellerRating1755868920649 implements MigrationInterface {
    name = 'CreateSellerRating1755868920649'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "catalog_skus" DROP CONSTRAINT "FK_b188e8e7e5d4b6c32bd691b1f8a"`);
        await queryRunner.query(`ALTER TABLE "card_images" DROP CONSTRAINT "FK_7988683c87cc4006510bd7480ac"`);
        await queryRunner.query(`ALTER TABLE "formats" DROP CONSTRAINT "FK_97a664a4fa5ec4aa61c8cbb86af"`);
        await queryRunner.query(`DROP INDEX "public"."idx_prints_pokemon_standard"`);
        await queryRunner.query(`DROP INDEX "public"."idx_prints_pokemon_expanded"`);
        await queryRunner.query(`DROP INDEX "public"."idx_prints_yugioh_advanced"`);
        await queryRunner.query(`DROP INDEX "public"."idx_prints_onepiece_standard"`);
        await queryRunner.query(`CREATE TYPE "public"."seller_ratings_seller_tier_enum" AS ENUM('bronze', 'silver', 'gold', 'platinum', 'diamond')`);
        await queryRunner.query(`CREATE TYPE "public"."seller_ratings_verification_status_enum" AS ENUM('unverified', 'pending', 'verified', 'suspended')`);
        await queryRunner.query(`CREATE TABLE "seller_ratings" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "seller_id" character varying(100) NOT NULL, "overall_rating" numeric(3,2) NOT NULL DEFAULT '0', "total_reviews" integer NOT NULL DEFAULT '0', "total_orders" integer NOT NULL DEFAULT '0', "total_sales_volume" integer NOT NULL DEFAULT '0', "item_as_described_rating" numeric(3,2) NOT NULL DEFAULT '0', "shipping_speed_rating" numeric(3,2) NOT NULL DEFAULT '0', "communication_rating" numeric(3,2) NOT NULL DEFAULT '0', "packaging_rating" numeric(3,2) NOT NULL DEFAULT '0', "response_rate_percentage" numeric(5,2) NOT NULL DEFAULT '0', "on_time_shipping_percentage" numeric(5,2) NOT NULL DEFAULT '0', "dispute_rate_percentage" numeric(5,2) NOT NULL DEFAULT '0', "cancellation_rate_percentage" numeric(5,2) NOT NULL DEFAULT '0', "recent_orders_count" integer NOT NULL DEFAULT '0', "recent_average_rating" numeric(3,2) NOT NULL DEFAULT '0', "recent_disputes" integer NOT NULL DEFAULT '0', "trust_score" integer NOT NULL DEFAULT '0', "seller_tier" "public"."seller_ratings_seller_tier_enum" NOT NULL DEFAULT 'bronze', "verification_status" "public"."seller_ratings_verification_status_enum" NOT NULL DEFAULT 'unverified', "verified_at" TIMESTAMP, "verified_by" character varying(100), "is_business_verified" boolean NOT NULL DEFAULT false, "is_identity_verified" boolean NOT NULL DEFAULT false, "is_address_verified" boolean NOT NULL DEFAULT false, "is_payment_verified" boolean NOT NULL DEFAULT false, "is_power_seller" boolean NOT NULL DEFAULT false, "is_featured_seller" boolean NOT NULL DEFAULT false, "is_preferred_seller" boolean NOT NULL DEFAULT false, "is_top_rated" boolean NOT NULL DEFAULT false, "first_sale_at" TIMESTAMP, "months_active" integer NOT NULL DEFAULT '0', "consecutive_months_active" integer NOT NULL DEFAULT '0', "badges" jsonb, "achievements" jsonb, "monthly_performance" jsonb, "risk_level" character varying(20) NOT NULL DEFAULT 'low', "risk_notes" text, "last_review_at" TIMESTAMP, "last_order_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_ab02245bb615c5354f31f0eb077" UNIQUE ("seller_id"), CONSTRAINT "UQ_ab02245bb615c5354f31f0eb077" UNIQUE ("seller_id"), CONSTRAINT "PK_f698f873830975c1fee3ba68d3e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_a098945538ce5ca3656a408ff0" ON "seller_ratings" ("seller_tier") `);
        await queryRunner.query(`CREATE INDEX "IDX_76441fc0be9a3d712ad32b1e30" ON "seller_ratings" ("verification_status") `);
        await queryRunner.query(`CREATE INDEX "IDX_8b3fe8f18be6f334e2a3954015" ON "seller_ratings" ("overall_rating") `);
        await queryRunner.query(`CREATE INDEX "IDX_ab02245bb615c5354f31f0eb07" ON "seller_ratings" ("seller_id") `);
        await queryRunner.query(`ALTER TABLE "catalog_skus" DROP COLUMN "print_id"`);
        await queryRunner.query(`ALTER TABLE "card_images" DROP COLUMN "print_id"`);
        await queryRunner.query(`ALTER TABLE "prints" DROP COLUMN "isLegalPokemonStandard"`);
        await queryRunner.query(`ALTER TABLE "prints" DROP COLUMN "isLegalPokemonExpanded"`);
        await queryRunner.query(`ALTER TABLE "prints" DROP COLUMN "isLegalPokemonUnlimited"`);
        await queryRunner.query(`ALTER TABLE "prints" DROP COLUMN "isLegalYugiohAdvanced"`);
        await queryRunner.query(`ALTER TABLE "prints" DROP COLUMN "isLegalYugiohTraditional"`);
        await queryRunner.query(`ALTER TABLE "prints" DROP COLUMN "isLegalOnePieceStandard"`);
        await queryRunner.query(`ALTER TABLE "prints" DROP COLUMN "isLegalPauper"`);
        await queryRunner.query(`ALTER TABLE "prints" DROP COLUMN "isLegalBrawl"`);
        await queryRunner.query(`ALTER TABLE "formats" DROP COLUMN "game_id"`);
        await queryRunner.query(`ALTER TABLE "deck_cards" ADD "catalogSku" character varying(200) NOT NULL`);
        await queryRunner.query(`ALTER TYPE "public"."image_processing_status_enum" RENAME TO "image_processing_status_enum_old"`);
        await queryRunner.query(`CREATE TYPE "public"."prints_imageprocessingstatus_enum" AS ENUM('pending', 'queued', 'processing', 'completed', 'failed', 'retry')`);
        await queryRunner.query(`ALTER TABLE "prints" ALTER COLUMN "imageProcessingStatus" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "prints" ALTER COLUMN "imageProcessingStatus" TYPE "public"."prints_imageprocessingstatus_enum" USING "imageProcessingStatus"::"text"::"public"."prints_imageprocessingstatus_enum"`);
        await queryRunner.query(`ALTER TABLE "prints" ALTER COLUMN "imageProcessingStatus" SET DEFAULT 'pending'`);
        await queryRunner.query(`DROP TYPE "public"."image_processing_status_enum_old"`);
        await queryRunner.query(`ALTER TABLE "games" ALTER COLUMN "update_frequency" SET DEFAULT '24 hours'`);
        await queryRunner.query(`ALTER TABLE "card_sets" ADD CONSTRAINT "FK_00782188e98404d16f45c143a46" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "catalog_skus" ADD CONSTRAINT "FK_9b4e92d0216a0f92b94e648c4c6" FOREIGN KEY ("printId") REFERENCES "prints"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "card_images" ADD CONSTRAINT "FK_2ba596ddbffc376844e8e05f491" FOREIGN KEY ("printId") REFERENCES "prints"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "prints" ADD CONSTRAINT "FK_2a3bf8b1e63f899f2274be3ee40" FOREIGN KEY ("cardId") REFERENCES "cards"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "prints" ADD CONSTRAINT "FK_ed1a5b9b512e20662b9a1c04834" FOREIGN KEY ("setId") REFERENCES "card_sets"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "cards" ADD CONSTRAINT "FK_dc73592eda17d219b5c433866df" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "formats" ADD CONSTRAINT "FK_c42a41998b6fd4350bb72af8ff5" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "deck_cards" ADD CONSTRAINT "FK_d738483b88c1cbcfdf84376278c" FOREIGN KEY ("deckId") REFERENCES "decks"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "deck_cards" ADD CONSTRAINT "FK_b28d413a01287b1719d3ca5e1c7" FOREIGN KEY ("cardId") REFERENCES "cards"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "decks" ADD CONSTRAINT "FK_207ac113983318395ad3e423698" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "decks" DROP CONSTRAINT "FK_207ac113983318395ad3e423698"`);
        await queryRunner.query(`ALTER TABLE "deck_cards" DROP CONSTRAINT "FK_b28d413a01287b1719d3ca5e1c7"`);
        await queryRunner.query(`ALTER TABLE "deck_cards" DROP CONSTRAINT "FK_d738483b88c1cbcfdf84376278c"`);
        await queryRunner.query(`ALTER TABLE "formats" DROP CONSTRAINT "FK_c42a41998b6fd4350bb72af8ff5"`);
        await queryRunner.query(`ALTER TABLE "cards" DROP CONSTRAINT "FK_dc73592eda17d219b5c433866df"`);
        await queryRunner.query(`ALTER TABLE "prints" DROP CONSTRAINT "FK_ed1a5b9b512e20662b9a1c04834"`);
        await queryRunner.query(`ALTER TABLE "prints" DROP CONSTRAINT "FK_2a3bf8b1e63f899f2274be3ee40"`);
        await queryRunner.query(`ALTER TABLE "card_images" DROP CONSTRAINT "FK_2ba596ddbffc376844e8e05f491"`);
        await queryRunner.query(`ALTER TABLE "catalog_skus" DROP CONSTRAINT "FK_9b4e92d0216a0f92b94e648c4c6"`);
        await queryRunner.query(`ALTER TABLE "card_sets" DROP CONSTRAINT "FK_00782188e98404d16f45c143a46"`);
        await queryRunner.query(`ALTER TABLE "games" ALTER COLUMN "update_frequency" SET DEFAULT '24:00:00'`);
        await queryRunner.query(`CREATE TYPE "public"."image_processing_status_enum_old" AS ENUM('pending', 'queued', 'processing', 'completed', 'failed', 'retry')`);
        await queryRunner.query(`ALTER TABLE "prints" ALTER COLUMN "imageProcessingStatus" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "prints" ALTER COLUMN "imageProcessingStatus" TYPE "public"."image_processing_status_enum_old" USING "imageProcessingStatus"::"text"::"public"."image_processing_status_enum_old"`);
        await queryRunner.query(`ALTER TABLE "prints" ALTER COLUMN "imageProcessingStatus" SET DEFAULT 'pending'`);
        await queryRunner.query(`DROP TYPE "public"."prints_imageprocessingstatus_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."image_processing_status_enum_old" RENAME TO "image_processing_status_enum"`);
        await queryRunner.query(`ALTER TABLE "deck_cards" DROP COLUMN "catalogSku"`);
        await queryRunner.query(`ALTER TABLE "formats" ADD "game_id" uuid`);
        await queryRunner.query(`ALTER TABLE "prints" ADD "isLegalBrawl" boolean DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "prints" ADD "isLegalPauper" boolean DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "prints" ADD "isLegalOnePieceStandard" boolean DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "prints" ADD "isLegalYugiohTraditional" boolean DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "prints" ADD "isLegalYugiohAdvanced" boolean DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "prints" ADD "isLegalPokemonUnlimited" boolean DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "prints" ADD "isLegalPokemonExpanded" boolean DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "prints" ADD "isLegalPokemonStandard" boolean DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "card_images" ADD "print_id" uuid`);
        await queryRunner.query(`ALTER TABLE "catalog_skus" ADD "print_id" uuid`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ab02245bb615c5354f31f0eb07"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8b3fe8f18be6f334e2a3954015"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_76441fc0be9a3d712ad32b1e30"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a098945538ce5ca3656a408ff0"`);
        await queryRunner.query(`DROP TABLE "seller_ratings"`);
        await queryRunner.query(`DROP TYPE "public"."seller_ratings_verification_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."seller_ratings_seller_tier_enum"`);
        await queryRunner.query(`CREATE INDEX "idx_prints_onepiece_standard" ON "prints" ("isLegalOnePieceStandard") `);
        await queryRunner.query(`CREATE INDEX "idx_prints_yugioh_advanced" ON "prints" ("isLegalYugiohAdvanced") `);
        await queryRunner.query(`CREATE INDEX "idx_prints_pokemon_expanded" ON "prints" ("isLegalPokemonExpanded") `);
        await queryRunner.query(`CREATE INDEX "idx_prints_pokemon_standard" ON "prints" ("isLegalPokemonStandard") `);
        await queryRunner.query(`ALTER TABLE "formats" ADD CONSTRAINT "FK_97a664a4fa5ec4aa61c8cbb86af" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "card_images" ADD CONSTRAINT "FK_7988683c87cc4006510bd7480ac" FOREIGN KEY ("print_id") REFERENCES "prints"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "catalog_skus" ADD CONSTRAINT "FK_b188e8e7e5d4b6c32bd691b1f8a" FOREIGN KEY ("print_id") REFERENCES "prints"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

}
