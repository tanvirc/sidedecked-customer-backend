import { MigrationInterface, QueryRunner } from "typeorm";

export class EnhanceFormatSystem1756033233742 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Add new columns to formats table
        await queryRunner.query(`
            ALTER TABLE "formats" 
            ADD COLUMN "leaderRequired" boolean NOT NULL DEFAULT false,
            ADD COLUMN "leaderZoneSize" integer NOT NULL DEFAULT 0,
            ADD COLUMN "donDeckSize" integer NOT NULL DEFAULT 0,
            ADD COLUMN "prizeCardCount" integer NOT NULL DEFAULT 0,
            ADD COLUMN "regulationMarks" text[],
            ADD COLUMN "restrictedCards" text[],
            ADD COLUMN "extraDeckRequired" boolean NOT NULL DEFAULT false,
            ADD COLUMN "maxExtraDeckSize" integer NOT NULL DEFAULT 0,
            ADD COLUMN "isSingleton" boolean NOT NULL DEFAULT false,
            ADD COLUMN "typeRestricted" boolean NOT NULL DEFAULT false,
            ADD COLUMN "rarityRestrictions" text[]
        `);

        // Add new columns to decks table
        await queryRunner.query(`
            ALTER TABLE "decks" 
            ADD COLUMN "formatCode" varchar(50),
            ADD COLUMN "leaderCardId" varchar(255)
        `);

        // Update DeckCard zone column to support new zones (PostgreSQL doesn't support enum alteration easily)
        // We'll keep it as varchar but document the expected values
        await queryRunner.query(`
            ALTER TABLE "deck_cards" 
            ALTER COLUMN "zone" TYPE varchar(20)
        `);

        // Add comment to document allowed zone values
        await queryRunner.query(`
            COMMENT ON COLUMN "deck_cards"."zone" IS 'Allowed values: main, sideboard, commander, extra, leader, don, prize'
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Remove comment from deck_cards zone column
        await queryRunner.query(`
            COMMENT ON COLUMN "deck_cards"."zone" IS NULL
        `);

        // Remove new columns from decks table
        await queryRunner.query(`
            ALTER TABLE "decks" 
            DROP COLUMN "leaderCardId",
            DROP COLUMN "formatCode"
        `);

        // Remove new columns from formats table
        await queryRunner.query(`
            ALTER TABLE "formats" 
            DROP COLUMN "rarityRestrictions",
            DROP COLUMN "typeRestricted",
            DROP COLUMN "isSingleton",
            DROP COLUMN "maxExtraDeckSize",
            DROP COLUMN "extraDeckRequired",
            DROP COLUMN "restrictedCards",
            DROP COLUMN "regulationMarks",
            DROP COLUMN "prizeCardCount",
            DROP COLUMN "donDeckSize",
            DROP COLUMN "leaderZoneSize",
            DROP COLUMN "leaderRequired"
        `);
    }

}
