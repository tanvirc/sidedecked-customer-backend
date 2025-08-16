import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm'

@Entity('user_follows')
export class UserFollow {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ type: 'uuid' })
  followerId: string

  @Column({ type: 'uuid' })
  followingId: string

  @CreateDateColumn()
  createdAt: Date
}