import { MigrationInterface, QueryRunner } from "typeorm"

export class CreateWishlistSystem20250816140000 implements MigrationInterface {
    name = 'CreateWishlistSystem20250816140000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Create wishlists table
        await queryRunner.query(`
            CREATE TABLE "wishlists" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "user_id" uuid NOT NULL,
                "name" character varying(255) NOT NULL,
                "description" text,
                "is_public" boolean NOT NULL DEFAULT false,
                "share_token" character varying(100),
                "item_count" integer NOT NULL DEFAULT 0,
                "total_value" numeric(10,2) NOT NULL DEFAULT 0,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_wishlists" PRIMARY KEY ("id"),
                CONSTRAINT "UQ_wishlists_share_token" UNIQUE ("share_token"),
                CONSTRAINT "UQ_wishlists_user_name" UNIQUE ("user_id", "name")
            )
        `)

        // Create wishlist_items table
        await queryRunner.query(`
            CREATE TABLE "wishlist_items" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "wishlist_id" uuid NOT NULL,
                "catalog_sku" character varying(200) NOT NULL,
                "max_price" numeric(10,2),
                "preferred_condition" character varying(10),
                "preferred_language" character varying(10),
                "notes" text,
                "target_price" numeric(10,2),
                "price_when_added" numeric(10,2),
                "current_lowest_price" numeric(10,2),
                "price_alert_enabled" boolean NOT NULL DEFAULT true,
                "stock_alert_enabled" boolean NOT NULL DEFAULT true,
                "last_price_alert_sent" TIMESTAMP,
                "last_stock_alert_sent" TIMESTAMP,
                "is_available" boolean NOT NULL DEFAULT false,
                "availability_last_checked" TIMESTAMP,
                "added_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_wishlist_items" PRIMARY KEY ("id"),
                CONSTRAINT "UQ_wishlist_items_sku" UNIQUE ("wishlist_id", "catalog_sku"),
                CONSTRAINT "FK_wishlist_items_wishlist" FOREIGN KEY ("wishlist_id") REFERENCES "wishlists"("id") ON DELETE CASCADE
            )
        `)

        // Update price_alerts table with enhanced schema
        await queryRunner.query(`
            DROP TABLE IF EXISTS "price_alerts"
        `)

        await queryRunner.query(`
            CREATE TYPE "price_alert_type_enum" AS ENUM('price_drop', 'price_target', 'back_in_stock', 'new_listing')
        `)

        await queryRunner.query(`
            CREATE TYPE "price_alert_status_enum" AS ENUM('active', 'triggered', 'paused', 'expired')
        `)

        await queryRunner.query(`
            CREATE TABLE "price_alerts" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "user_id" uuid NOT NULL,
                "catalog_sku" character varying(200) NOT NULL,
                "alert_type" "price_alert_type_enum" NOT NULL DEFAULT 'price_drop',
                "status" "price_alert_status_enum" NOT NULL DEFAULT 'active',
                "trigger_price" numeric(10,2),
                "percentage_threshold" numeric(10,2),
                "condition_filter" character varying(10),
                "language_filter" character varying(10),
                "baseline_price" numeric(10,2),
                "last_checked_at" TIMESTAMP,
                "last_triggered_at" TIMESTAMP,
                "trigger_count" integer NOT NULL DEFAULT 0,
                "email_enabled" boolean NOT NULL DEFAULT true,
                "sms_enabled" boolean NOT NULL DEFAULT false,
                "push_enabled" boolean NOT NULL DEFAULT false,
                "expires_at" TIMESTAMP,
                "auto_disable_after_trigger" boolean NOT NULL DEFAULT false,
                "max_triggers" integer NOT NULL DEFAULT 1,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_price_alerts" PRIMARY KEY ("id")
            )
        `)

        // Create indexes for wishlists
        await queryRunner.query(`CREATE INDEX "IDX_wishlists_user_id" ON "wishlists" ("user_id")`)

        // Create indexes for wishlist_items
        await queryRunner.query(`CREATE INDEX "IDX_wishlist_items_wishlist_id" ON "wishlist_items" ("wishlist_id")`)
        await queryRunner.query(`CREATE INDEX "IDX_wishlist_items_catalog_sku" ON "wishlist_items" ("catalog_sku")`)

        // Create indexes for price_alerts
        await queryRunner.query(`CREATE INDEX "IDX_price_alerts_user_id" ON "price_alerts" ("user_id")`)
        await queryRunner.query(`CREATE INDEX "IDX_price_alerts_catalog_sku" ON "price_alerts" ("catalog_sku")`)
        await queryRunner.query(`CREATE INDEX "IDX_price_alerts_status" ON "price_alerts" ("status")`)
        await queryRunner.query(`CREATE INDEX "IDX_price_alerts_alert_type" ON "price_alerts" ("alert_type")`)
        await queryRunner.query(`CREATE INDEX "IDX_price_alerts_trigger_price" ON "price_alerts" ("trigger_price")`)

        // Create default wishlist for existing users (if any)
        await queryRunner.query(`
            INSERT INTO "wishlists" ("user_id", "name", "description")
            SELECT DISTINCT "customer_id" as "user_id", 'My Wishlist', 'Default wishlist'
            FROM "user_profiles"
            WHERE "customer_id" IS NOT NULL
            ON CONFLICT ("user_id", "name") DO NOTHING
        `)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Drop indexes
        await queryRunner.query(`DROP INDEX "IDX_price_alerts_trigger_price"`)
        await queryRunner.query(`DROP INDEX "IDX_price_alerts_alert_type"`)
        await queryRunner.query(`DROP INDEX "IDX_price_alerts_status"`)
        await queryRunner.query(`DROP INDEX "IDX_price_alerts_catalog_sku"`)
        await queryRunner.query(`DROP INDEX "IDX_price_alerts_user_id"`)
        await queryRunner.query(`DROP INDEX "IDX_wishlist_items_catalog_sku"`)
        await queryRunner.query(`DROP INDEX "IDX_wishlist_items_wishlist_id"`)
        await queryRunner.query(`DROP INDEX "IDX_wishlists_user_id"`)

        // Drop tables
        await queryRunner.query(`DROP TABLE "price_alerts"`)
        await queryRunner.query(`DROP TYPE "price_alert_status_enum"`)
        await queryRunner.query(`DROP TYPE "price_alert_type_enum"`)
        await queryRunner.query(`DROP TABLE "wishlist_items"`)
        await queryRunner.query(`DROP TABLE "wishlists"`)

        // Recreate basic price_alerts table
        await queryRunner.query(`
            CREATE TABLE "price_alerts" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_price_alerts" PRIMARY KEY ("id")
            )
        `)
    }
}