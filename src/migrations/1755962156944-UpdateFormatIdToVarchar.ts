import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdateFormatIdToVarchar1755962156944 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Check if decks table exists before altering it
        const tableExists = async (tableName: string) => {
            const result = await queryRunner.query(`SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = '${tableName}'
            )`);
            return result[0].exists;
        };

        // Update decks table - change formatId from uuid to varchar
        if (await tableExists('decks')) {
            await queryRunner.query(`ALTER TABLE "decks" ALTER COLUMN "formatId" TYPE varchar(255)`);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Revert back to uuid - NOTE: This will only work if all values are valid UUIDs
        const tableExists = async (tableName: string) => {
            const result = await queryRunner.query(`SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = '${tableName}'
            )`);
            return result[0].exists;
        };

        if (await tableExists('decks')) {
            await queryRunner.query(`ALTER TABLE "decks" ALTER COLUMN "formatId" TYPE uuid USING "formatId"::uuid`);
        }
    }

}
