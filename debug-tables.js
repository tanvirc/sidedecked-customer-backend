const { DataSource } = require('typeorm');

const dataSource = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    synchronize: false,
    logging: false,
});

async function checkTables() {
    try {
        await dataSource.initialize();
        console.log('✅ Database connected');

        // Check if tables exist
        const tables = await dataSource.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            ORDER BY table_name;
        `);
        
        console.log('\n📋 All tables:');
        tables.forEach(row => console.log(`  - ${row.table_name}`));
        
        // Check specifically for pricing tables
        const pricingTables = ['market_prices', 'price_history'];
        console.log('\n🔍 Pricing tables check:');
        for (const table of pricingTables) {
            try {
                const result = await dataSource.query(`SELECT COUNT(*) FROM ${table} LIMIT 1`);
                console.log(`✅ ${table}: EXISTS (${result[0].count} rows)`);
            } catch (error) {
                console.log(`❌ ${table}: ${error.message}`);
            }
        }
        
        // Check migrations table
        console.log('\n📦 Migration status:');
        try {
            const migrations = await dataSource.query(`SELECT * FROM migrations ORDER BY timestamp DESC`);
            migrations.forEach(m => console.log(`  ✅ ${m.name} (${m.timestamp})`));
        } catch (error) {
            console.log(`❌ Migrations table: ${error.message}`);
        }
        
    } catch (error) {
        console.error('❌ Database error:', error.message);
    } finally {
        if (dataSource.isInitialized) {
            await dataSource.destroy();
        }
    }
}

checkTables();