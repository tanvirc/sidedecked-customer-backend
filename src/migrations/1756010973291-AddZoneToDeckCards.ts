import { MigrationInterface, QueryRunner } from "typeorm";

export class AddZoneToDeckCards1756010973291 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "deck_cards" 
            ADD COLUMN "zone" varchar(20) NOT NULL DEFAULT 'main'
        `);
        
        // Create index on zone for better query performance
        await queryRunner.query(`
            CREATE INDEX "IDX_deck_cards_zone" ON "deck_cards" ("zone")
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_deck_cards_zone"`);
        await queryRunner.query(`ALTER TABLE "deck_cards" DROP COLUMN "zone"`);
    }

}
