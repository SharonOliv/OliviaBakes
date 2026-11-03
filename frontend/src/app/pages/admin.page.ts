import { Component, effect, inject, signal } from '@angular/core';
import { AdminOrder, ApiService, STATUS_LABEL, dayLabel, money } from '../api.service';

const NEXT: Record<string, { to: string; label: string }> = {
  placed: { to: 'confirmed', label: 'Confirm order' },
  quoted: { to: 'confirmed', label: 'Mark confirmed' },
  confirmed: { to: 'baking', label: 'Start baking' },
  baking: { to: 'out_for_delivery', label: 'Out for delivery' },
  out_for_delivery: { to: 'delivered', label: 'Mark delivered' },
};

@Component({
  standalone: true,
  template: `
  <section class="page">
    <div class="row" style="margin-top:0">
      <h1 class="h1">Orders</h1>
      @if (api.adminKey()) { <button class="btn ghost" (click)="api.adminLogout()">Log out</button> }
    </div>

    @if (!api.adminKey()) {
      <div class="panel narrow">
        <h3>Owner login</h3>
        <label>Admin key
          <input type="password" #key (keyup.enter)="login(key.value)">
        </label>
        @if (err()) { <p class="err">{{ err() }}</p> }
        <button class="btn wide" (click)="login(key.value)">Log in</button>
      </div>
    } @else {
      <div class="chips">
        <button class="chip" [class.on]="!date()" (click)="date.set('')">Upcoming</button>
        <input type="date" [value]="date()" (change)="date.set($any($event.target).value)" style="width:auto" aria-label="Show a delivery day">
      </div>
      @if (err()) { <p class="err">{{ err() }}</p> }

      <div class="ocards">
        @for (o of orders(); track o.id) {
          <article class="kcard">
            <div class="row" style="margin-top:0">
              <span><b>#{{ o.id }}</b><span class="tag">{{ o.kind === 'custom' ? 'Custom' : 'Standard' }}</span></span>
              <span class="tag" [class.out]="o.status === 'cancelled'">{{ label[o.status] }}</span>
            </div>
            <p style="margin-top:10px"><strong>{{ o.customer }}</strong></p>
            <p><a [href]="'tel:' + o.phone" class="under">{{ o.phone }}</a></p>
            <p class="muted small">{{ o.address }}, {{ o.pincode }}</p>
            <p style="margin-top:8px"><strong>{{ dayLabel(o.delivery_date) }}, {{ slot(o.delivery_slot) }}</strong></p>

            @if (o.custom_details; as c) {
              <ul>
                <li>{{ c.flavour }}, {{ c.weight_kg }} kg</li>
                @if (c.message) { <li>Message: {{ c.message }}</li> }
                <li>{{ c.description }}</li>
              </ul>
            }
            @if (o.items?.length) { <ul>@for (i of o.items ?? []; track i.name) { <li>{{ i.qty }} x {{ i.name }}</li> }</ul> }
            @if (o.note) { <p class="small">Customer note: {{ o.note }}</p> }
            @if (o.total_paise) {
              <p>Total {{ money(o.total_paise) }}. {{ o.payment === 'upi' ? 'UPI' : 'Cash' }} on delivery, {{ o.payment_status }}.</p>
            }

            @if (o.kind === 'custom' && (o.status === 'requested' || o.status === 'quoted')) {
              <div class="inline">
                <input #price type="number" min="100" placeholder="Price (₹)" aria-label="Price in rupees">
                <input #units type="number" min="1" max="50" value="6" aria-label="Capacity units this cake uses">
                <input #qnote placeholder="Note to customer" aria-label="Note to customer">
                <button class="btn" (click)="quote(o, price.value, units.value, qnote.value)">{{ o.status === 'quoted' ? 'Update quote' : 'Send quote' }}</button>
              </div>
            }
            <div class="inline">
              @if (next(o); as n) { <button class="btn" (click)="run(api.adminStatus(o.id, n.to))">{{ n.label }}</button> }
              @if (o.payment_status === 'pending' && o.status !== 'cancelled' && o.status !== 'requested') {
                <button class="btn ghost" (click)="run(api.adminPaid(o.id))">Mark paid</button>
              }
              @if (o.status !== 'delivered' && o.status !== 'cancelled') {
                <button class="btn ghost" (click)="cancel(o)">Cancel</button>
              }
            </div>
          </article>
        } @empty { <p class="muted">No orders to show.</p> }
      </div>

      <div class="panel" style="margin-top:30px">
        <h3>Daily capacity</h3>
        <p class="muted small">How much you can bake on a day. A cookie uses 1 unit and a cake 6 to 8. You can't set it below what is already booked.</p>
        <div class="inline">
          <input #cday type="date" aria-label="Day">
          <input #cmax type="number" min="0" placeholder="Max units" aria-label="Max units">
          <button class="btn" (click)="setCap(cday.value, cmax.value)">Save</button>
        </div>
      </div>

      <div class="panel" style="margin-top:20px">
        <h3>Menu availability</h3>
        @for (p of api.products(); track p.id) {
          <div class="srow">
            <span>{{ p.name }}</span>
            <button class="btn ghost" (click)="run(api.adminProduct(p.id, { available: !p.available }))">{{ p.available ? 'Available' : 'Unavailable' }}</button>
          </div>
        }
      </div>
    }
  </section>
  `,
})
export class AdminPage {
  api = inject(ApiService);
  orders = signal<AdminOrder[]>([]);
  date = signal('');
  err = signal('');
  label = STATUS_LABEL;
  money = money;
  dayLabel = dayLabel;

  constructor() { effect(() => { this.api.events(); this.api.adminKey(); this.date(); this.load(); }); }

  async load() {
    if (!this.api.adminKey()) return;
    try { this.orders.set(await this.api.adminOrders(this.date() || undefined)); this.err.set(''); }
    catch (e: any) {
      if (e.status === 401) { this.api.adminLogout(); this.err.set('Your session ended. Log in again.'); }
      else this.err.set('Could not load orders');
    }
  }
  async login(key: string) { this.err.set(''); if (!(await this.api.adminLogin(key))) this.err.set('That key is not right'); }

  // Runs an admin action, then refreshes the list. Errors from the server are shown as a toast.
  async run(p: Promise<unknown>) {
    try { await p; await this.load(); } catch (e: any) { this.api.say(e.error?.error ?? 'Something went wrong'); }
  }
  async quote(o: AdminOrder, price: string, units: string, note: string) {
    const paise = Math.round(Number(price) * 100);
    if (!(paise >= 10000)) return this.api.say('Enter a price of at least ₹100');
    return this.run(this.api.adminQuote(o.id, paise, Number(units) || 6, note));
  }
  async setCap(day: string, max: string) {
    if (!day || max === '') return this.api.say('Choose a day and a limit');
    return this.run(this.api.adminCapacity(day, Number(max)));
  }
  cancel(o: AdminOrder) { if (confirm(`Cancel order #${o.id}?`)) this.run(this.api.adminCancel(o.id)); }
  next(o: AdminOrder) { return NEXT[o.status] ?? null; }
  slot(k: string) { return this.api.avail()?.slot_labels[k] ?? k; }
}