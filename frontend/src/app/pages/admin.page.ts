import { Component, computed, effect, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
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
    <h1 class="h1">{{ view === 'custom' ? 'Custom cake requests' : 'Active orders' }}</h1>

    <div class="chips">
      <button class="chip" [class.on]="!date()" (click)="date.set('')">Active</button>
      <input type="date" [value]="date()" (change)="date.set(val($event))" style="width:auto" aria-label="Show a delivery day">
      <button class="chip" (click)="load()">Refresh</button>
    </div>
    @if (view === 'orders') {
      <div class="chips" style="margin-top:0">
        <button class="chip" [class.on]="pay() === 'all'" (click)="pay.set('all')">All payments</button>
        <button class="chip" [class.on]="pay() === 'unpaid'" (click)="pay.set('unpaid')">Unpaid</button>
        <button class="chip" [class.on]="pay() === 'paid'" (click)="pay.set('paid')">Paid</button>
      </div>
    }
    @if (err()) { <p class="err">{{ err() }}</p> }

    <div class="ocards">
      @for (o of list(); track o.id) {
        <article class="kcard">
          <div class="row" style="margin-top:0">
            <b>#{{ o.id }}</b>
            <span>
              @if (o.total_paise) { <span class="tag" [class.low]="o.payment_status !== 'paid'">{{ o.payment_status === 'paid' ? 'Paid' : o.payment_status === 'refunded' ? 'Refunded' : 'Unpaid' }}</span> }
              <span class="tag" [class.out]="o.status === 'cancelled'">{{ label[o.status] }}</span>
            </span>
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
          @if (o.owner_note) { <p class="small">Your note: {{ o.owner_note }}</p> }
          @if (o.total_paise) { <p>Total {{ money(o.total_paise) }}. {{ o.payment === 'card' ? 'Card (Stripe)' : o.payment === 'upi' ? 'UPI on delivery' : 'Cash on delivery' }}.</p> }

          @if (o.kind === 'custom' && (o.status === 'requested' || o.status === 'quoted')) {
            <div class="panel" style="padding:16px;margin-top:12px">
              <b>Flavour available? Send a price and delivery time</b>
              <div class="inline">
                <input #price type="number" min="100" placeholder="Price (₹)" aria-label="Price in rupees">
              </div>
              <div class="inline">
                <input #qdate type="date" [value]="o.delivery_date" aria-label="Delivery date">
                <select #qslot aria-label="Delivery slot">
                  @for (s of slotKeys(); track s) { <option [value]="s" [selected]="s === o.delivery_slot">{{ slot(s) }}</option> }
                </select>
              </div>
              <input #qnote placeholder="Note to customer (optional)" style="margin-top:8px">
              <button class="btn wide" (click)="quote(o, price.value, qdate.value, qslot.value, qnote.value)">{{ o.status === 'quoted' ? 'Update quote' : 'Send quote' }}</button>
              <p style="margin-top:16px"><b>Flavour not available?</b></p>
              <div class="inline">
                <input #dnote placeholder="Message to customer (optional)">
                <button class="btn ghost" (click)="decline(o, dnote.value)">Decline request</button>
              </div>
            </div>
          }
          <div class="inline">
            @if (next(o); as n) { <button class="btn" (click)="run(api.adminStatus(o.id, n.to))">{{ n.label }}</button> }
            @if (o.total_paise && o.status !== 'cancelled' && o.status !== 'requested') {
              <button class="btn ghost" (click)="setPaid(o, o.payment_status !== 'paid')">{{ o.payment_status === 'paid' ? 'Mark unpaid' : 'Mark paid' }}</button>
            }
            @if (o.status !== 'delivered' && o.status !== 'cancelled' && o.kind === 'standard') {
              <button class="btn ghost" (click)="cancel(o)">Cancel</button>
            }
          </div>
        </article>
      } @empty { <p class="muted">Nothing to show.</p> }
    </div>
  </section>
  `,
})
export class AdminPage {
  api = inject(ApiService);
  private http = inject(HttpClient);
  view = inject(ActivatedRoute).snapshot.data['view'] as 'orders' | 'custom';
  orders = signal<AdminOrder[]>([]);
  pay = signal<'all' | 'paid' | 'unpaid'>('all');
  date = signal('');
  err = signal('');
  label = STATUS_LABEL;
  money = money;
  dayLabel = dayLabel;

  list = computed(() => this.orders().filter(o => this.view === 'custom'
    ? o.kind === 'custom'
    : o.kind === 'standard' && (this.pay() === 'all' || (this.pay() === 'paid') === (o.payment_status === 'paid'))));
  slotKeys = computed(() => Object.keys(this.api.avail()?.slot_labels ?? {}));

  constructor() { effect(() => { this.api.events(); this.date(); this.load(); }); }

  val(e: Event) { return (e.target as HTMLInputElement).value; }
  async load() {
    try { this.orders.set(await this.api.adminOrders(this.date() || undefined)); this.err.set(''); }
    catch (e: any) { this.err.set(e.status === 401 || e.status === 403 ? 'Please log in as the owner.' : 'Could not load orders'); }
  }
  async run(p: Promise<unknown>) {
    try { await p; await this.load(); } catch (e: any) { this.api.say(e.error?.error ?? 'Something went wrong'); }
  }
  setPaid(o: AdminOrder, paid: boolean) { return this.run(firstValueFrom(this.http.post(`/api/admin/orders/${o.id}/paid`, { paid }))); }
  quote(o: AdminOrder, price: string, date: string, slot: string, note: string) {
    const paise = Math.round(Number(price) * 100);
    if (!(paise >= 10000)) return this.api.say('Enter a price of at least ₹100');
    return this.run(firstValueFrom(this.http.post(`/api/admin/orders/${o.id}/quote`,
      { quoted_paise: paise, delivery_date: date, delivery_slot: slot, owner_note: note })));
  }
  decline(o: AdminOrder, note: string) {
    if (confirm(`Decline request #${o.id}?`)) this.run(this.api.adminCancel(o.id, note.trim() || 'Sorry, we cannot make that flavour right now.'));
  }
  cancel(o: AdminOrder) { if (confirm(`Cancel order #${o.id}?`)) this.run(this.api.adminCancel(o.id)); }
  next(o: AdminOrder) { return NEXT[o.status] ?? null; }
  slot(k: string) { return this.api.avail()?.slot_labels[k] ?? k; }
}