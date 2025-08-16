import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm'

@Entity('messages')
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ type: 'uuid' })
  conversationId: string

  @Column({ type: 'uuid' })
  senderId: string

  @Column({ type: 'text' })
  content: string

  @CreateDateColumn()
  createdAt: Date
}