import * as fs from 'fs'
import * as path from 'path'

const entities = [
  'UserProfile',
  'UserFollow',
  'Activity',
  'Conversation',
  'Message',
  'ForumCategory',
  'ForumTopic',
  'ForumPost',
  'PriceHistory',
  'MarketPrice',
  'PriceAlert',
  'PricePrediction',
  'Portfolio',
  'PortfolioHolding',
  'PortfolioTransaction'
]

const template = (name: string) => `import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm'

@Entity('${name.replace(/([A-Z])/g, '_$1').toLowerCase().slice(1)}s')
export class ${name} {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @CreateDateColumn()
  createdAt: Date

  @UpdateDateColumn()
  updatedAt: Date
}
`

entities.forEach(entity => {
  const filePath = path.join(__dirname, '..', 'entities', `${entity}.ts`)
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, template(entity))
    console.log(`Created ${entity}.ts`)
  }
})

console.log('Placeholder entities created successfully!')