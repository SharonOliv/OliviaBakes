import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

export interface Product { id: number; name: string; category: string; image: string | null; price_paise: number; available: boolean; stock: number | null; ingredients: string | null; allergens: string | null; weight_g: number | null }
export interface Best { name: string; sold: number; rank: number }
export interface Day { day: string; remaining: number; slots: string[]; custom_slots: string[] }
export interface Availability { slot_labels: Record<string, string>; lead_hours: number; custom_lead_hours: number; days: Day[] }
export interface Area { ok: boolean; area_name?: string; delivery_paise?: number; free_above_paise?: number }
export interface CustomDetails { flavour: string; weight_kg: number; message: string; description: string }
export interface OrderInfo {
  id: number; kind: 'standard' | 'custom'; status: string; delivery_date: string; delivery_slot: string;
  payment: string; payment_status: string; subtotal_paise: number; delivery_paise: number; total_paise: number;
  custom_details: CustomDetails | null; owner_note: string | null;
  items: { name: string; qty: number; price_paise: number }[] | null;
}
export interface AdminOrder extends OrderInfo {
  public_token: string; customer: string; phone: string; email: string | null; address: string; pincode: string;
  note: string | null; units_reserved: number; created_at: string;
}
export interface DeliveryForm {
  customer: string; phone: string; email: string; address: string; pincode: string;
  delivery_date: string; delivery_slot: string; payment: 'cod' | 'upi'; note: string;
}

export const FREE_ABOVE = 49900;
export const deliveryFee = (subtotal: number, areaFee: number) => (subtotal >= FREE_ABOVE ? 0 : areaFee);
export const money = (p: number) =>
  '₹' + (p / 100).toLocaleString('en-IN', { minimumFractionDigits: p % 100 ? 2 : 0, maximumFractionDigits: 2 });
export const pad = (n: number) => String(n).padStart(2, '0');
// '2026-10-29' -> 'Thu, 29 Oct'
export const dayLabel = (d: string) =>
  new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
// '2026-10-29' -> { wd: 'Thu', d: '29', m: 'Oct' }
export const dayParts = (day: string) => {
  const dt = new Date(day + 'T00:00:00');
  return {
    wd: dt.toLocaleDateString('en-IN', { weekday: 'short' }),
    d: String(dt.getDate()),
    m: dt.toLocaleDateString('en-IN', { month: 'short' }),
  };
};
export interface Profile { customer: string; phone: string; email: string; address: string }
export const STATUS_LABEL: Record<string, string> = {
  requested: 'Request received', quoted: 'Quote ready', placed: 'Order placed', confirmed: 'Confirmed',
  baking: 'Baking', out_for_delivery: 'Out for delivery', delivered: 'Delivered', cancelled: 'Cancelled',
};

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  private router = inject(Router);
  products = signal<Product[]>([]);
  best = signal<Best[]>([]);
  avail = signal<Availability | null>(null);
  cart = signal<Record<number, number>>({});
  myOrder = signal<string | null>(this.saved());        // tracking token of the customer's latest order
  adminKey = signal<string | null>(this.savedKey());
  pin = signal<string>(this.read('oliviabakes_pin') ?? '');      // delivery pincode, remembered on this device
  area = signal<Area | null>(null);                              // result of the serviceability check for pin()
  profile = signal<Profile>(this.loadProfile());                 // last used contact details, for faster checkout
  toast = signal('');
  events = signal(0);                                    // bumps whenever any order changes (pages refetch on it)
  private timer: any;

  lines = computed(() =>
    Object.entries(this.cart())
      .map(([id, qty]) => ({ p: this.products().find(x => x.id === +id)!, qty }))
      .filter(l => !!l.p));
  subtotal = computed(() => this.lines().reduce((s, l) => s + l.p.price_paise * l.qty, 0));
  count = computed(() => this.lines().reduce((s, l) => s + l.qty, 0));
  leadHours = computed(() => this.avail()?.lead_hours ?? 24);
  // delivery fee for the current bag at the current pincode (null until the pincode is known and served)
  fee = computed(() => { const a = this.area(); return a?.ok ? deliveryFee(this.subtotal(), a.delivery_paise ?? 0) : null; });
  toFree = computed(() => Math.max(0, FREE_ABOVE - this.subtotal()));

  constructor() {
    this.loadProducts(); this.loadBest(); this.loadAvailability(); this.listen();
    if (this.pin().length === 6) this.setPin(this.pin());
  }

  private read(k: string) { try { return localStorage.getItem(k); } catch { return null; } }
  private loadProfile(): Profile {
    try { return { customer: '', phone: '', email: '', address: '', ...JSON.parse(localStorage.getItem('oliviabakes_profile') ?? '{}') }; }
    catch { return { customer: '', phone: '', email: '', address: '' }; }
  }
  private rememberProfile(f: DeliveryForm) {
    const p = { customer: f.customer, phone: f.phone, email: f.email, address: f.address };
    this.profile.set(p);
    try { localStorage.setItem('oliviabakes_profile', JSON.stringify(p)); } catch {}
  }
  qty(id: number) { return this.cart()[id] || 0; }

  // Location first, like Swiggy and Blinkit: the pincode is checked once and remembered everywhere.
  async setPin(pin: string) {
    this.pin.set(pin); this.area.set(null);
    try { localStorage.setItem('oliviabakes_pin', pin); } catch {}
    if (pin.length !== 6) return;
    try { const a = await this.checkArea(pin); if (this.pin() === pin) this.area.set(a); } catch {}
  }

  private saved() { try { return localStorage.getItem('oliviabakes_order'); } catch { return null; } }
  private savedKey() { try { return sessionStorage.getItem('oliviabakes_admin'); } catch { return null; } }
  private opts(admin: boolean) { return admin ? { headers: new HttpHeaders({ 'x-admin-key': this.adminKey() ?? '' }) } : {}; }
  private get<T>(u: string, admin = false) { return firstValueFrom(this.http.get<T>(u, this.opts(admin))); }
  private post<T>(u: string, b: any = {}, admin = false) { return firstValueFrom(this.http.post<T>(u, b, this.opts(admin))); }

  async loadProducts() { this.products.set(await this.get<Product[]>('/api/products')); }
  async loadBest() { this.best.set(await this.get<Best[]>('/api/bestsellers')); }
  async loadAvailability() { this.avail.set(await this.get<Availability>('/api/availability')); }
  checkArea(pincode: string) { return this.get<Area>('/api/areas/' + pincode); }
  fetchOrder(token: string) { return this.get<OrderInfo>('/api/orders/' + token); }
  acceptQuote(token: string) { return this.post('/api/orders/' + token + '/accept'); }

  add(id: number) {
    const p = this.products().find(x => x.id === id);
    if (!p || !p.available) return this.say('Sorry, that item is not available right now');
    if ((this.cart()[id] || 0) >= 20) return this.say('You can order up to 20 of one item');
    this.cart.update(c => ({ ...c, [id]: (c[id] || 0) + 1 }));
  }
  dec(id: number) { this.cart.update(c => { const n = { ...c }; if (--n[id] <= 0) delete n[id]; return n; }); }
  say(m: string) { this.toast.set(m); setTimeout(() => this.toast.set(''), 3500); }

  private remember(token: string) {
    this.myOrder.set(token);
    try { localStorage.setItem('oliviabakes_order', token); } catch {}
    this.router.navigate(['/track', token]);
  }

  // Both return an error message, or null on success
  async placeOrder(f: DeliveryForm): Promise<string | null> {
    const items = Object.entries(this.cart()).map(([id, qty]) => ({ id: +id, qty }));
    try {
      const r = await this.post<{ public_token: string }>('/api/orders', { ...f, items });
      this.cart.set({});
      this.rememberProfile(f);
      this.remember(r.public_token);
      return null;
    } catch (e: any) { return e.error?.error ?? 'Order failed'; }
  }
  async placeCustom(f: DeliveryForm, details: CustomDetails): Promise<string | null> {
    try {
      const r = await this.post<{ public_token: string }>('/api/custom-requests', { ...f, details });
      this.rememberProfile(f);
      this.remember(r.public_token);
      return null;
    } catch (e: any) { return e.error?.error ?? 'Request failed'; }
  }

  // ---- admin (owner) ----
  async adminLogin(key: string) {
    this.adminKey.set(key);
    try {
      await this.get('/api/admin/ping', true);
      try { sessionStorage.setItem('oliviabakes_admin', key); } catch {}
      return true;
    } catch { this.adminKey.set(null); return false; }
  }
  adminLogout() { this.adminKey.set(null); try { sessionStorage.removeItem('oliviabakes_admin'); } catch {} }
  adminOrders(date?: string) { return this.get<AdminOrder[]>('/api/admin/orders' + (date ? '?date=' + date : ''), true); }
  adminStatus(id: number, status: string) { return this.post(`/api/admin/orders/${id}/status`, { status }, true); }
  adminPaid(id: number) { return this.post(`/api/admin/orders/${id}/paid`, {}, true); }
  adminQuote(id: number, quoted_paise: number, units: number, owner_note: string) {
    return this.post(`/api/admin/orders/${id}/quote`, { quoted_paise, units, owner_note }, true);
  }
  adminCancel(id: number, owner_note = '') { return this.post(`/api/admin/orders/${id}/cancel`, { owner_note }, true); }
  adminCapacity(day: string, max_units: number) {
    return firstValueFrom(this.http.put(`/api/admin/capacity/${day}`, { max_units }, this.opts(true)));
  }
  adminProduct(id: number, patch: { price_paise?: number; available?: boolean }) {
    return firstValueFrom(this.http.patch<Product>(`/api/admin/products/${id}`, patch, this.opts(true)));
  }

  // Refresh every so often instead of server push (LISTEN/NOTIFY is gone)
  private listen() {
    setInterval(() => {
      if (document.hidden) return;
      this.events.update(n => n + 1);
      this.loadProducts().catch(() => {}); this.loadBest().catch(() => {}); this.loadAvailability().catch(() => {});
    }, 20000);
  }
}