import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

export interface Product { id: number; name: string; category: string; image: string | null; price_paise: number; stock: number }
export interface Best { name: string; sold: number; rank: string }
export interface QItem { id: number; ticket: number; customer: string; status: string; position: number; items: { name: string; qty: number }[] | null }
export interface OrderInfo { id: number; ticket: number; status: string; total_paise: number; fulfilment: string; position: number | null }
export interface CheckoutForm {
  customer: string; phone: string; email: string;
  fulfilment: 'pickup' | 'delivery'; address: string;
  payment: 'cod' | 'upi' | 'card'; note: string;
}

export const DELIVERY_FEE = 4000;
export const FREE_ABOVE = 49900;
export const deliveryFee = (sub: number, type: string) => (type === 'delivery' && sub < FREE_ABOVE ? DELIVERY_FEE : 0);
export const money = (p: number) =>
  '₹' + (p / 100).toLocaleString('en-IN', { minimumFractionDigits: p % 100 ? 2 : 0, maximumFractionDigits: 2 });
export const pad = (n: number) => String(n).padStart(2, '0');

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  private router = inject(Router);
  products = signal<Product[]>([]);
  best = signal<Best[]>([]);
  queue = signal<QItem[]>([]);
  cart = signal<Record<number, number>>({});
  myOrder = signal<number | null>(this.saved());
  toast = signal('');
  burst = signal(0);
  private timer: any;

  queued = computed(() => this.queue().filter(o => o.status === 'queued'));
  preparing = computed(() => this.queue().filter(o => o.status === 'preparing'));
  ready = computed(() => this.queue().filter(o => o.status === 'ready'));
  lines = computed(() =>
    Object.entries(this.cart())
      .map(([id, qty]) => ({ p: this.products().find(x => x.id === +id)!, qty }))
      .filter(l => !!l.p));
  subtotal = computed(() => this.lines().reduce((s, l) => s + l.p.price_paise * l.qty, 0));
  count = computed(() => this.lines().reduce((s, l) => s + l.qty, 0));

  constructor() { this.loadProducts(); this.loadBest(); this.loadQueue(); this.listen(); }

  private saved() { try { return Number(localStorage.getItem('olive_order')) || null; } catch { return null; } }
  private get<T>(u: string) { return firstValueFrom(this.http.get<T>(u)); }
  private post<T>(u: string, b: any = {}) { return firstValueFrom(this.http.post<T>(u, b)); }

  async loadProducts() { this.products.set(await this.get<Product[]>('/api/products')); }
  async loadBest() { this.best.set(await this.get<Best[]>('/api/bestsellers')); }
  async loadQueue() { this.queue.set(await this.get<QItem[]>('/api/queue')); }
  fetchOrder(id: number | string) { return this.get<OrderInfo>('/api/orders/' + id); }

  add(id: number) {
    const p = this.products().find(x => x.id === id);
    if (!p || (this.cart()[id] || 0) >= p.stock) return this.say('No more in stock');
    this.cart.update(c => ({ ...c, [id]: (c[id] || 0) + 1 }));
  }
  dec(id: number) { this.cart.update(c => { const n = { ...c }; if (--n[id] <= 0) delete n[id]; return n; }); }
  say(m: string) { this.toast.set(m); setTimeout(() => this.toast.set(''), 3500); }

  // Returns an error message, or null on success
  async placeOrder(f: CheckoutForm): Promise<string | null> {
    const items = Object.entries(this.cart()).map(([id, qty]) => ({ id: +id, qty }));
    try {
      const r = await this.post<{ id: number; ticket: number }>('/api/orders', { ...f, items });
      this.myOrder.set(r.id);
      try { localStorage.setItem('olive_order', String(r.id)); } catch {}
      this.cart.set({});
      this.burst.update(n => n + 1);
      this.router.navigate(['/track', r.id]);
      return null;
    } catch (e: any) { return e.error?.error ?? 'Order failed'; }
  }

  next() { return this.post('/api/kitchen/next'); }
  move(id: number, act: string) { return this.post(`/api/kitchen/${id}/${act}`); }
  async auto() { return (await this.get<{ on: boolean }>('/api/kitchen/auto')).on; }
  async toggleAuto() { return (await this.post<{ on: boolean }>('/api/kitchen/auto')).on; }

  private listen() {
    new EventSource('/events').onmessage = m => {
      const d = JSON.parse(m.data);
      if (d.table === 'products') this.products.update(ps => ps.map(p => (p.id === d.id ? { ...p, stock: +d.stock } : p)));
      if (d.table === 'orders') {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => { this.loadQueue(); this.loadBest(); }, 150);
      }
    };
  }
}