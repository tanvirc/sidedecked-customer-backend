import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDeckFields1756008146433 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Add new columns to decks table
        await queryRunner.query(`ALTER TABLE "decks" ADD COLUMN IF NOT EXISTS "description" TEXT`);
        await queryRunner.query(`ALTER TABLE "decks" ADD COLUMN IF NOT EXISTS "isPublic" BOOLEAN DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "decks" ADD COLUMN IF NOT EXISTS "likes" INTEGER DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "decks" ADD COLUMN IF NOT EXISTS "views" INTEGER DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "decks" ADD COLUMN IF NOT EXISTS "copies" INTEGER DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "decks" ADD COLUMN IF NOT EXISTS "coverCardId" VARCHAR(255)`);
        await queryRunner.query(`ALTER TABLE "decks" ADD COLUMN IF NOT EXISTS "coverImageUrl" TEXT`);
        await queryRunner.query(`ALTER TABLE "decks" ADD COLUMN IF NOT EXISTS "tags" jsonb`);
        await queryRunner.query(`ALTER TABLE "decks" ADD COLUMN IF NOT EXISTS "totalValue" DECIMAL(10,2) DEFAULT 0`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Remove columns from decks table
        await queryRunner.query(`ALTER TABLE "decks" DROP COLUMN IF EXISTS "totalValue"`);
        await queryRunner.query(`ALTER TABLE "decks" DROP COLUMN IF EXISTS "tags"`);
        await queryRunner.query(`ALTER TABLE "decks" DROP COLUMN IF EXISTS "coverImageUrl"`);
        await queryRunner.query(`ALTER TABLE "decks" DROP COLUMN IF EXISTS "coverCardId"`);
        await queryRunner.query(`ALTER TABLE "decks" DROP COLUMN IF EXISTS "copies"`);
        await queryRunner.query(`ALTER TABLE "decks" DROP COLUMN IF EXISTS "views"`);
        await queryRunner.query(`ALTER TABLE "decks" DROP COLUMN IF EXISTS "likes"`);
        await queryRunner.query(`ALTER TABLE "decks" DROP COLUMN IF EXISTS "isPublic"`);
        await queryRunner.query(`ALTER TABLE "decks" DROP COLUMN IF EXISTS "description"`);
    }

}
