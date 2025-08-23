import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdateUserIdFields1755961572255 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Check if tables exist before altering them
        const tableExists = async (tableName: string) => {
            const result = await queryRunner.query(`SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = '${tableName}'
            )`);
            return result[0].exists;
        };
        
        // Update decks table - change userId from uuid to varchar
        if (await tableExists('decks')) {
            await queryRunner.query(`ALTER TABLE "decks" ALTER COLUMN "userId" TYPE varchar(255)`);
        }
        
        // Update collections table - change userId from uuid to varchar  
        if (await tableExists('collections')) {
            await queryRunner.query(`ALTER TABLE "collections" ALTER COLUMN "userId" TYPE varchar(255)`);
        }
        
        // Update user_profiles table - change customerId from uuid to varchar
        if (await tableExists('user_profiles')) {
            await queryRunner.query(`ALTER TABLE "user_profiles" ALTER COLUMN "customerId" TYPE varchar(255)`);
        }
        
        // Update activities table - change userId from uuid to varchar
        if (await tableExists('activities')) {
            await queryRunner.query(`ALTER TABLE "activities" ALTER COLUMN "userId" TYPE varchar(255)`);
        }
        
        // Update user_collections table - change userId from uuid to varchar
        if (await tableExists('user_collections')) {
            await queryRunner.query(`ALTER TABLE "user_collections" ALTER COLUMN "userId" TYPE varchar(255)`);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Revert back to uuid - NOTE: This will only work if all values are valid UUIDs
        await queryRunner.query(`ALTER TABLE "decks" ALTER COLUMN "userId" TYPE uuid USING "userId"::uuid`);
        await queryRunner.query(`ALTER TABLE "collections" ALTER COLUMN "userId" TYPE uuid USING "userId"::uuid`);
        await queryRunner.query(`ALTER TABLE "user_profiles" ALTER COLUMN "customerId" TYPE uuid USING "customerId"::uuid`);
        await queryRunner.query(`ALTER TABLE "activities" ALTER COLUMN "userId" TYPE uuid USING "userId"::uuid`);
        await queryRunner.query(`ALTER TABLE "user_collections" ALTER COLUMN "userId" TYPE uuid USING "userId"::uuid`);
    }

}
