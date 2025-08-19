import { MigrationInterface, QueryRunner } from "typeorm";

export class AddImageProcessingStatusToPrint1755589363792 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Create the ImageProcessingStatus enum type
        await queryRunner.query(`
            CREATE TYPE "image_processing_status_enum" AS ENUM (
                'pending',
                'queued', 
                'processing',
                'completed',
                'failed',
                'retry'
            )
        `);

        // Add the new columns to the prints table
        await queryRunner.query(`
            ALTER TABLE "prints" 
            ADD COLUMN "imageProcessingStatus" "image_processing_status_enum" NOT NULL DEFAULT 'pending'
        `);

        await queryRunner.query(`
            ALTER TABLE "prints" 
            ADD COLUMN "imageProcessedAt" TIMESTAMP NULL
        `);

        await queryRunner.query(`
            ALTER TABLE "prints" 
            ADD COLUMN "imageProcessingError" TEXT NULL
        `);

        // Create index for image processing status queries
        await queryRunner.query(`
            CREATE INDEX "idx_prints_image_status" ON "prints" ("imageProcessingStatus")
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Drop the index
        await queryRunner.query(`DROP INDEX "idx_prints_image_status"`);

        // Remove the columns
        await queryRunner.query(`ALTER TABLE "prints" DROP COLUMN "imageProcessingError"`);
        await queryRunner.query(`ALTER TABLE "prints" DROP COLUMN "imageProcessedAt"`);
        await queryRunner.query(`ALTER TABLE "prints" DROP COLUMN "imageProcessingStatus"`);

        // Drop the enum type
        await queryRunner.query(`DROP TYPE "image_processing_status_enum"`);
    }

}
