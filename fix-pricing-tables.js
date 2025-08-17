const { DataSource } = require('typeorm');

const dataSource = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    synchronize: false,
    logging: true,
});

async function createPricingTables() {
    try {
        await dataSource.initialize();
        console.log('✅ Database connected');

        // Create market_prices table
        console.log('📦 Creating market_prices table...');
        await dataSource.query(`
            CREATE TABLE IF NOT EXISTS "market_prices" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "catalog_sku" character varying(200) NOT NULL,
                "source" character varying(100) NOT NULL,
                "seller_id" character varying(200),
                "seller_name" character varying(255),
                "price" numeric(10,2) NOT NULL,
                "shipping_cost" numeric(10,2) DEFAULT 0,
                "condition" character varying(10) NOT NULL,
                "language" character varying(10) NOT NULL DEFAULT 'EN',
                "currency" character varying(3) NOT NULL DEFAULT 'USD',
                "stock_quantity" integer DEFAULT 0,
                "listing_url" text,
                "image_url" text,
                "is_available" boolean NOT NULL DEFAULT true,
                "is_foil" boolean NOT NULL DEFAULT false,
                "set_code" character varying(20),
                "card_number" character varying(20),
                "additional_data" jsonb,
                "seller_rating" numeric(5,2),
                "seller_feedback_count" integer,
                "total_price" numeric(10,2) GENERATED ALWAYS AS ("price" + COALESCE("shipping_cost", 0)) STORED,
                "last_scraped" TIMESTAMP NOT NULL DEFAULT now(),
                "last_available" TIMESTAMP,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_market_prices" PRIMARY KEY ("id")
            )
        `);

        // Create price_history table
        console.log('📦 Creating price_history table...');
        await dataSource.query(`
            CREATE TABLE IF NOT EXISTS "price_history" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "catalog_sku" character varying(200) NOT NULL,
                "condition" character varying(10) NOT NULL,
                "language" character varying(10) NOT NULL DEFAULT 'EN',
                "lowest_price" numeric(10,2) NOT NULL,
                "average_price" numeric(10,2) NOT NULL,
                "highest_price" numeric(10,2) NOT NULL,
                "market_price" numeric(10,2),
                "listings_count" integer NOT NULL DEFAULT 0,
                "in_stock_count" integer NOT NULL DEFAULT 0,
                "price_sources" text[],
                "currency" character varying(3) NOT NULL DEFAULT 'USD',
                "aggregation_period" character varying(20) NOT NULL DEFAULT 'daily',
                "recorded_at" TIMESTAMP NOT NULL,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_price_history" PRIMARY KEY ("id"),
                CONSTRAINT "UQ_price_history_sku_condition_period" UNIQUE ("catalog_sku", "condition", "language", "aggregation_period", "recorded_at")
            )
        `);

        // Create indexes
        console.log('📦 Creating indexes...');
        await dataSource.query(`CREATE INDEX IF NOT EXISTS "IDX_market_prices_catalog_sku" ON "market_prices" ("catalog_sku")`);
        await dataSource.query(`CREATE INDEX IF NOT EXISTS "IDX_market_prices_condition" ON "market_prices" ("condition")`);
        await dataSource.query(`CREATE INDEX IF NOT EXISTS "IDX_market_prices_language" ON "market_prices" ("language")`);
        await dataSource.query(`CREATE INDEX IF NOT EXISTS "IDX_price_history_catalog_sku" ON "price_history" ("catalog_sku")`);
        await dataSource.query(`CREATE INDEX IF NOT EXISTS "IDX_price_history_condition" ON "price_history" ("condition")`);

        console.log('✅ Pricing tables created successfully!');
        
        // Verify tables exist
        const result = await dataSource.query(`
            SELECT table_name FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name IN ('market_prices', 'price_history')
            ORDER BY table_name
        `);
        console.log('🔍 Tables now exist:', result.map(r => r.table_name));
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        if (dataSource.isInitialized) {
            await dataSource.destroy();
        }
    }
}

createPricingTables();