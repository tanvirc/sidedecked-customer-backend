import { MigrationInterface, QueryRunner } from "typeorm";

export class SeedGameFormats1755735597526 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Get game IDs
        const games = await queryRunner.query(`
            SELECT id, code FROM games WHERE code IN ('MTG', 'POKEMON', 'YUGIOH', 'OPTCG')
        `);
        
        const gameMap = new Map(games.map((g: any) => [g.code, g.id]));
        
        // Magic: The Gathering formats
        if (gameMap.has('MTG')) {
            const mtgId = gameMap.get('MTG');
            
            await queryRunner.query(`
                INSERT INTO formats (id, "gameId", code, name, "formatType", "isRotating", "rotationSchedule", "minDeckSize", "maxDeckSize", "maxCopiesPerCard", "allowsSideboard", "maxSideboardSize", "specialRules", "isActive", "createdAt", "updatedAt")
                VALUES 
                (gen_random_uuid(), $1, 'standard', 'Standard', 'constructed', true, 'annual', 60, null, 4, true, 15, '{"description": "Cards from the past 2 years"}', true, NOW(), NOW()),
                (gen_random_uuid(), $1, 'pioneer', 'Pioneer', 'constructed', false, 'none', 60, null, 4, true, 15, '{"description": "Cards from Return to Ravnica onwards"}', true, NOW(), NOW()),
                (gen_random_uuid(), $1, 'modern', 'Modern', 'constructed', false, 'none', 60, null, 4, true, 15, '{"description": "Cards from 8th Edition onwards"}', true, NOW(), NOW()),
                (gen_random_uuid(), $1, 'legacy', 'Legacy', 'eternal', false, 'none', 60, null, 4, true, 15, '{"description": "All cards except banned ones"}', true, NOW(), NOW()),
                (gen_random_uuid(), $1, 'vintage', 'Vintage', 'eternal', false, 'none', 60, null, 4, true, 15, '{"description": "All cards with restricted list"}', true, NOW(), NOW()),
                (gen_random_uuid(), $1, 'commander', 'Commander', 'multiplayer', false, 'none', 100, 100, 1, false, 0, '{"description": "100-card singleton format", "commanderRequired": true}', true, NOW(), NOW()),
                (gen_random_uuid(), $1, 'pauper', 'Pauper', 'constructed', false, 'none', 60, null, 4, true, 15, '{"description": "Only commons allowed"}', true, NOW(), NOW()),
                (gen_random_uuid(), $1, 'brawl', 'Brawl', 'multiplayer', true, 'annual', 60, 60, 1, false, 0, '{"description": "Standard singleton format", "commanderRequired": true}', true, NOW(), NOW())
            `, [mtgId]);
        }
        
        // Pokemon TCG formats
        if (gameMap.has('POKEMON')) {
            const pokemonId = gameMap.get('POKEMON');
            
            await queryRunner.query(`
                INSERT INTO formats (id, "gameId", code, name, "formatType", "isRotating", "rotationSchedule", "minDeckSize", "maxDeckSize", "maxCopiesPerCard", "allowsSideboard", "maxSideboardSize", "specialRules", "isActive", "createdAt", "updatedAt")
                VALUES 
                (gen_random_uuid(), $1, 'standard', 'Standard', 'constructed', true, 'annual', 60, 60, 4, false, 0, '{"description": "Current regulation marks only", "regulationMarks": ["G", "H"]}', true, NOW(), NOW()),
                (gen_random_uuid(), $1, 'expanded', 'Expanded', 'constructed', false, 'none', 60, 60, 4, false, 0, '{"description": "Black & White series and forward"}', true, NOW(), NOW()),
                (gen_random_uuid(), $1, 'unlimited', 'Unlimited', 'eternal', false, 'none', 60, 60, 4, false, 0, '{"description": "All cards allowed"}', true, NOW(), NOW())
            `, [pokemonId]);
        }
        
        // Yu-Gi-Oh! formats
        if (gameMap.has('YUGIOH')) {
            const yugiohId = gameMap.get('YUGIOH');
            
            await queryRunner.query(`
                INSERT INTO formats (id, "gameId", code, name, "formatType", "isRotating", "rotationSchedule", "minDeckSize", "maxDeckSize", "maxCopiesPerCard", "allowsSideboard", "maxSideboardSize", "specialRules", "isActive", "createdAt", "updatedAt")
                VALUES 
                (gen_random_uuid(), $1, 'advanced', 'Advanced Format', 'constructed', false, 'none', 40, 60, 3, true, 15, '{"description": "Official tournament format with ban list", "extraDeckMax": 15}', true, NOW(), NOW()),
                (gen_random_uuid(), $1, 'traditional', 'Traditional Format', 'constructed', false, 'none', 40, 60, 3, true, 15, '{"description": "Forbidden cards become limited", "extraDeckMax": 15}', true, NOW(), NOW())
            `, [yugiohId]);
        }
        
        // One Piece Card Game formats
        if (gameMap.has('OPTCG')) {
            const onePieceId = gameMap.get('OPTCG');
            
            await queryRunner.query(`
                INSERT INTO formats (id, "gameId", code, name, "formatType", "isRotating", "rotationSchedule", "minDeckSize", "maxDeckSize", "maxCopiesPerCard", "allowsSideboard", "maxSideboardSize", "specialRules", "isActive", "createdAt", "updatedAt")
                VALUES 
                (gen_random_uuid(), $1, 'standard', 'Standard', 'constructed', false, 'none', 50, 50, 4, false, 0, '{"description": "Official competitive format", "leaderRequired": true, "donDeckSize": 10, "colorRestricted": true}', true, NOW(), NOW())
            `, [onePieceId]);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Remove all seeded formats
        await queryRunner.query(`
            DELETE FROM formats WHERE code IN (
                'standard', 'pioneer', 'modern', 'legacy', 'vintage', 'commander', 'pauper', 'brawl',
                'expanded', 'unlimited', 'advanced', 'traditional'
            )
        `);
    }

}
