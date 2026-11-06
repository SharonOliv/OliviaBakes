import { Component, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService, DeliveryForm, FREE_ABOVE, dayLabel, money, pad } from '../api.service';

interface Addr { id: number; label: string; address: string; pincode: string; is_default: boolean }
interface Cell { day: string; n: number; ok: boolean }

@Component({
  standalone: true,
  imports: [RouterLink],
  styles: [`
    .cal { max-width: 340px; border: 1px solid var(--line); border-radius: 16px; padding: 14px; background: #fff; }
    .calhead { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
    .calhead button { width: 34px; height: 34px; border-radius: 50%; border: 1px solid var(--line); background: #fff; font-size: 1.2rem; cursor: pointer; }
    .calhead button:disabled { opacity: .35; cursor: not-allowed; }
    .calgrid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; text-align: center; }
    .wd { font-size: .72rem; color: var(--m); padding: 4px 0; }
    .cd { aspect-ratio: 1; border: 0; border-radius: 10px; background: #FFF7F9; font: 600 .9rem var(--body); color: var(--t); cursor: pointer; }
    .cd:hover:not(:disabled) { background: #FFE3E9; }
    .cd:disabled { background: none; color: #c9b3b8; font-weight: 400; cursor: not-allowed; text-decoration: line-through; }
    .cd.on { background: var(--a); color: #fff; }
  `],
  template: `
  <section class="page">
    <h1 class="h1">Checkout</h1>
    @if (!api.lines().length) {
      <p class="muted">Your bag is empty. <a routerLink="/" class="under">Browse cookies</a></p>
    } @else {
    <div class="co">
      <div class="panel">
        <h3>Delivery address</h3>
        @if (addrs().length) {
          <div class="seg">
            @for (a of addrs(); track a.id) { <button [class.on]="picked() === a.id" (click)="use(a)">{{ a.label }}</button> }
            <button [class.on]="picked() === null" (click)="newAddr()">New address</button>
          </div>
        }
        <label>Full name <input autocomplete="name" [value]="f().customer" (input)="set('customer', val($event))"></label>
        <label>Mobile number <input inputmode="numeric" maxlength="10" autocomplete="tel" [value]="f().phone" (input)="set('phone', digits($event))"></label>
        <label>Email (optional) <input type="email" autocomplete="email" [value]="f().email" (input)="set('email', val($event))"></label>
        <label>Address <textarea rows="3" [value]="f().address" (input)="set('address', val($event)); picked.set(null)"></textarea></label>
        <label>Pincode <input inputmode="numeric" maxlength="6" [value]="f().pincode" (input)="onPin($event)"></label>
        <p class="small muted" style="margin-top:8px">Demo site: use pincode 000000</p>
        @if (f().pincode.length === 6) {
          @if (api.area(); as a) {
            @if (a.ok) { <p class="hint ok">We deliver to {{ a.area_name }}.</p> } @else { <p class="hint bad">We don't deliver to that pincode yet.</p> }
          } @else { <p class="hint">Checking...</p> }
        }

        <h3>Delivery day</h3>
        <div class="cal">
          <div class="calhead">
            <button type="button" (click)="shift(-1)" [disabled]="!canPrev()" aria-label="Previous month">&lsaquo;</button>
            <b>{{ monthLabel() }}</b>
            <button type="button" (click)="shift(1)" [disabled]="!canNext()" aria-label="Next month">&rsaquo;</button>
          </div>
          <div class="calgrid">
            @for (w of weekdays; track w) { <span class="wd">{{ w }}</span> }
            @for (c of cells(); track $index) {
              @if (c) {
                <button type="button" class="cd" [class.on]="f().delivery_date === c.day" [disabled]="!c.ok" (click)="pickDay(c.day)">{{ c.n }}</button>
              } @else { <span></span> }
            }
          </div>
          <p class="small muted" style="margin-top:10px">Only days we can deliver are selectable. Orders need {{ api.leadHours() }} hours' notice.</p>
        </div>
        @if (f().delivery_date) { <p class="small" style="margin-top:10px"><b>Delivery on {{ dayLabel(f().delivery_date) }}</b></p> }

        <h3>Time slot</h3>
        <div class="seg">
          @for (s of slots(); track s) { <button [class.on]="f().delivery_slot === s" (click)="set('delivery_slot', s)">{{ slotLabel(s) }}</button> }
          @empty { <span class="muted small">Pick a day first</span> }
        </div>

        <h3>Payment</h3>
        <div class="seg">
          <button [class.on]="f().payment === 'cod'" (click)="set('payment', 'cod')">Cash on delivery</button>
          <button [class.on]="f().payment === 'upi'" (click)="set('payment', 'upi')">UPI on delivery</button>
        </div>
        <label>Note for us (optional) <textarea rows="2" [value]="f().note" (input)="set('note', val($event))"></textarea></label>
        @if (err()) { <p class="err">{{ err() }}</p> }
      </div>

      <div class="panel sum">
        <h3>Your order</h3>
        @for (l of api.lines(); track l.p.id) {
          <div class="srow"><span>{{ l.qty }} x {{ l.p.name }}</span><span>{{ money(l.p.price_paise * l.qty) }}</span></div>
        }
        <div class="srow"><span>Subtotal</span><span>{{ money(api.subtotal()) }}</span></div>
        <div class="srow"><span>Delivery</span><span>{{ api.fee() === null ? 'Enter pincode' : api.fee() === 0 ? 'Free' : money(api.fee() ?? 0) }}</span></div>
        @if (api.toFree() > 0) {
          <p class="small muted" style="margin-top:10px">Add {{ money(api.toFree()) }} more for free delivery</p>
          <div class="progress"><i [style.width.%]="progress()"></i></div>
        }
        <div class="srow big"><b>Total</b><b>{{ money(total()) }}</b></div>
        <button class="btn wide" [disabled]="busy()" (click)="place()">{{ busy() ? 'Placing order...' : 'Place order' }}</button>
        <a routerLink="/cart" class="center-link under small">Back to bag</a>
      </div>
    </div>
    }
  </section>
  `,
})
export class CheckoutPage {
  api = inject(ApiService);
  private http = inject(HttpClient);
  money = money;
  dayLabel = dayLabel;
  weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  addrs = signal<Addr[]>([]);
  picked = signal<number | null>(null);
  err = signal('');
  busy = signal(false);
  vm = signal<string | null>(null);   // month being shown, as 'YYYY-MM'
  f = signal<DeliveryForm>({
    customer: this.api.profile().customer, phone: this.api.profile().phone, email: this.api.profile().email,
    address: this.api.profile().address, pincode: this.api.pin(), delivery_date: '', delivery_slot: '', payment: 'cod', note: '',
  });

  days = computed(() => (this.api.avail()?.days ?? []).filter(d => d.slots.length));
  slots = computed(() => this.api.avail()?.days.find(d => d.day === this.f().delivery_date)?.slots ?? []);
  total = computed(() => this.api.subtotal() + (this.api.fee() ?? 0));
  progress = computed(() => Math.min(100, (this.api.subtotal() / FREE_ABOVE) * 100));

  // calendar
  firstYm = computed(() => this.days()[0]?.day.slice(0, 7) ?? '');
  lastYm = computed(() => this.days()[this.days().length - 1]?.day.slice(0, 7) ?? '');
  cur = computed(() => this.vm() ?? this.firstYm());
  canPrev = computed(() => !!this.cur() && this.cur() > this.firstYm());
  canNext = computed(() => !!this.cur() && this.cur() < this.lastYm());
  monthLabel = computed(() => {
    if (!this.cur()) return '';
    const [y, m] = this.cur().split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  });
  cells = computed(() => {
    if (!this.cur()) return [] as (Cell | null)[];
    const [y, m] = this.cur().split('-').map(Number);
    const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7;   // weeks start on Monday
    const ok = new Set(this.days().map(d => d.day));
    const out: (Cell | null)[] = Array(lead).fill(null);
    for (let n = 1; n <= new Date(y, m, 0).getDate(); n++) {
      const day = `${y}-${pad(m)}-${pad(n)}`;
      out.push({ day, n, ok: ok.has(day) });
    }
    return out;
  });
  shift(d: number) {
    const [y, m] = this.cur().split('-').map(Number), t = new Date(y, m - 1 + d, 1);
    this.vm.set(`${t.getFullYear()}-${pad(t.getMonth() + 1)}`);
  }

  constructor() {
    firstValueFrom(this.http.get<Addr[]>('/api/me/addresses')).then(a => {
      this.addrs.set(a);
      const d = a.find(x => x.is_default) ?? a[0];
      if (d && !this.f().address) this.use(d);
    }).catch(() => {});
  }

  set<K extends keyof DeliveryForm>(k: K, v: DeliveryForm[K]) { this.f.update(x => ({ ...x, [k]: v })); }
  val(e: Event) { return (e.target as HTMLInputElement).value; }
  digits(e: Event) { const el = e.target as HTMLInputElement; el.value = el.value.replace(/\D/g, ''); return el.value; }
  slotLabel(k: string) { return this.api.avail()?.slot_labels[k] ?? k; }

  use(a: Addr) {
    this.picked.set(a.id);
    this.f.update(x => ({ ...x, address: a.address, pincode: a.pincode }));
    this.api.setPin(a.pincode);
  }
  newAddr() { this.picked.set(null); this.f.update(x => ({ ...x, address: '', pincode: '' })); this.api.setPin(''); }
  onPin(e: Event) {
    const v = this.digits(e);
    this.set('pincode', v); this.picked.set(null); this.api.setPin(v);
  }
  pickDay(d: string) { this.f.update(x => ({ ...x, delivery_date: d, delivery_slot: '' })); }

  async place() {
    const f = this.f();
    if (f.customer.trim().length < 2) return this.err.set('Enter your name');
    if (!/^[6-9]\d{9}$/.test(f.phone)) return this.err.set('Enter a valid 10-digit mobile number');
    if (f.address.trim().length < 8) return this.err.set('Enter your full delivery address');
    if (!/^\d{6}$/.test(f.pincode)) return this.err.set('Enter a valid 6-digit pincode');
    if (!this.api.area()?.ok) return this.err.set('Please enter a pincode we deliver to');
    if (!f.delivery_date || !f.delivery_slot) return this.err.set('Choose a delivery day and time slot');
    this.err.set(''); this.busy.set(true);
    const e = await this.api.placeOrder({ ...f, customer: f.customer.trim(), address: f.address.trim() });
    this.busy.set(false);
    if (e) this.err.set(e);
  }
}