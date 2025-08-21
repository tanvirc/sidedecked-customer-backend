import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAllGameFormatLegality1755735646652 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Add Pokemon TCG format legality fields
        await queryRunner.query(`
            ALTER TABLE prints 
            ADD COLUMN "isLegalPokemonStandard" BOOLEAN DEFAULT false,
            ADD COLUMN "isLegalPokemonExpanded" BOOLEAN DEFAULT false,
            ADD COLUMN "isLegalPokemonUnlimited" BOOLEAN DEFAULT false
        `);
        
        // Add Yu-Gi-Oh! format legality fields
        await queryRunner.query(`
            ALTER TABLE prints 
            ADD COLUMN "isLegalYugiohAdvanced" BOOLEAN DEFAULT false,
            ADD COLUMN "isLegalYugiohTraditional" BOOLEAN DEFAULT false
        `);
        
        // Add One Piece Card Game format legality fields
        await queryRunner.query(`
            ALTER TABLE prints 
            ADD COLUMN "isLegalOnePieceStandard" BOOLEAN DEFAULT false
        `);
        
        // Add additional MTG formats that weren't in the original schema
        await queryRunner.query(`
            ALTER TABLE prints 
            ADD COLUMN "isLegalPauper" BOOLEAN DEFAULT false,
            ADD COLUMN "isLegalBrawl" BOOLEAN DEFAULT false
        `);
        
        // Add indexes for the new format legality fields
        await queryRunner.query(`
            CREATE INDEX "idx_prints_pokemon_standard" ON prints ("isLegalPokemonStandard");
            CREATE INDEX "idx_prints_pokemon_expanded" ON prints ("isLegalPokemonExpanded");
            CREATE INDEX "idx_prints_yugioh_advanced" ON prints ("isLegalYugiohAdvanced");
            CREATE INDEX "idx_prints_onepiece_standard" ON prints ("isLegalOnePieceStandard");
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Drop indexes first
        await queryRunner.query(`
            DROP INDEX IF EXISTS "idx_prints_pokemon_standard";
            DROP INDEX IF EXISTS "idx_prints_pokemon_expanded";
            DROP INDEX IF EXISTS "idx_prints_yugioh_advanced";
            DROP INDEX IF EXISTS "idx_prints_onepiece_standard";
        `);
        
        // Remove the columns
        await queryRunner.query(`
            ALTER TABLE prints 
            DROP COLUMN IF EXISTS "isLegalPokemonStandard",
            DROP COLUMN IF EXISTS "isLegalPokemonExpanded",
            DROP COLUMN IF EXISTS "isLegalPokemonUnlimited",
            DROP COLUMN IF EXISTS "isLegalYugiohAdvanced",
            DROP COLUMN IF EXISTS "isLegalYugiohTraditional",
            DROP COLUMN IF EXISTS "isLegalOnePieceStandard",
            DROP COLUMN IF EXISTS "isLegalPauper",
            DROP COLUMN IF EXISTS "isLegalBrawl"
        `);
    }

}
