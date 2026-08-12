import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** Một dòng hàng trong đơn — chốt `price` tại thời điểm đặt (từ CheckStock). */
export interface OrderItemData {
  productId: string;
  quantity: number;
  price: number;
}

export type OrderStatus = 'PENDING' | 'CONFIRMED' | 'PAID' | 'CANCELLED';

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Index để FindByUser lọc nhanh theo user hiện tại.
  @Index()
  @Column({ name: 'user_id' })
  userId: string;

  // email lấy từ JWT (qua CreateOrderRequest) — lưu lại để publish event và tra cứu.
  @Column({ nullable: true })
  email: string;

  // Snapshot các dòng hàng ngay khi đặt. jsonb để lưu mảng object gọn trong 1 cột,
  // không cần bảng order_items riêng cho phạm vi học tập này.
  @Column({ type: 'jsonb' })
  items: OrderItemData[];

  // Khớp proto `double price/total` — double precision map thẳng sang number JS.
  @Column({ type: 'double precision' })
  total: number;

  @Column({ default: 'PENDING' })
  status: OrderStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
