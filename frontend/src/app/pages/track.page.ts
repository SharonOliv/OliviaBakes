import { Component, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService, OrderInfo, STATUS_LABEL, dayLabel, money } from '../api.service';

const STANDARD = ['placed', 'confirmed', 'baking', 'out_for_delivery', 'delivered'];
const CUSTOM = ['requested', 'quoted', 'confirmed', 'baking', 'out_for_delivery', 'delivered'];

@Component({
  standalone: true,
  imports: [RouterLink],
  template: `
  <section class="page narrow">
    @if (o(); as ord) {
      <small class="eyebrow">Order #{{ ord.id }}</small>
      <h1 class="h1">{{ headline(ord) }}</h1>
      <p class="muted">{{ sub(ord) }}</p>
      @if (ord.status !== 'cancelled') {
        <p class="h2">{{ dayLabel(ord.delivery_date) }}, {{ slotLabel(ord.delivery_slot) }}</p>
        <div class="steps">
          @for (s of flow(ord); track s) { <div [class.on]="reached(ord, s)">{{ label[s] }}</div> }
        </div>
      }

      <div class="panel" style="margin-top:30px">
        @if (ord.custom_details; as c) {
          <h3>Your cake</h3>
          <div class="srow"><span>Flavour</span><span>{{ c.flavour }}</span></div>
          <div class="srow"><span>Weight</span><span>{{ c.weight_kg }} kg</span></div>
          @if (c.message) { <div class="srow"><span>Message on cake</span><span>{{ c.message }}</span></div> }
          <p class="muted small" style="margin-top:10px">{{ c.description }}</p>
        }
        @if (ord.items?.length) {
          <h3>Your order</h3>
          @for (i of ord.items ?? []; track i.name) {
            <div class="srow"><span>{{ i.name }} x {{ i.qty }}</span><span>{{ money(i.price_paise * i.qty) }}</span></div>
          }
        }
        @if (ord.total_paise) {
          <h3>Total</h3>
          <div class="srow"><span>Subtotal</span><span>{{ money(ord.subtotal_paise) }}</span></div>
          <div class="srow"><span>Delivery</span><span>{{ ord.delivery_paise ? money(ord.delivery_paise) : 'Free' }}</span></div>
          <div class="srow big"><span>Total</span><b>{{ money(ord.total_paise) }}</b></div>
          <p class="muted small">{{ payText(ord) }}</p>
        }
        @if (ord.owner_note) { <h3>Message from the baker</h3><p>{{ ord.owner_note }}</p> }
        @if (ord.status === 'quoted') {
          @if (err()) { <p class="err">{{ err() }}</p> }
          <button class="btn wide" [disabled]="busy()" (click)="accept()">{{ busy() ? 'Confirming...' : 'Accept quote' }}</button>
          <p class="muted small center">You pay when your cake is delivered.</p>
        }
      </div>
    } @else if (missing()) {
      <p class="muted">We couldn't find that order. <a routerLink="/menu" class="under">Browse the menu</a></p>
    } @else { <p class="muted">Looking for your order...</p> }
  </section>
  `,
})
export class TrackPage {
  api = inject(ApiService);
  token = inject(ActivatedRoute).snapshot.paramMap.get('id')!;
  o = signal<OrderInfo | null>(null);
  missing = signal(false);
  busy = signal(false);
  err = signal('');
  label = STATUS_LABEL;
  money = money;
  dayLabel = dayLabel;

  constructor() { effect(() => { this.api.events(); this.load(); }); }

  async load() {
    try { this.o.set(await this.api.fetchOrder(this.token)); this.missing.set(false); }
    catch (e: any) { if (e.status === 404) { this.o.set(null); this.missing.set(true); } }
  }
  async accept() {
    this.busy.set(true); this.err.set('');
    try { await this.api.acceptQuote(this.token); await this.load(); }
    catch (e: any) { this.err.set(e.error?.error ?? 'Could not accept the quote'); }
    this.busy.set(false);
  }

  flow(o: OrderInfo) { return o.kind === 'custom' ? CUSTOM : STANDARD; }
  reached(o: OrderInfo, s: string) { const f = this.flow(o); return f.indexOf(s) <= f.indexOf(o.status); }
  slotLabel(k: string) { return this.api.avail()?.slot_labels[k] ?? k; }
  payText(o: OrderInfo) {
    const how = o.payment === 'upi' ? 'UPI on delivery' : 'Cash on delivery';
    return o.payment_status === 'paid' ? how + ', paid' : how;
  }
  headline(o: OrderInfo) {
    return ({
      requested: 'We received your request', quoted: 'Your quote is ready', placed: 'Order placed',
      confirmed: 'Order confirmed', baking: 'Baking your order', out_for_delivery: 'On its way',
      delivered: 'Delivered. Enjoy!', cancelled: 'Order cancelled',
    } as Record<string, string>)[o.status] ?? 'Your order';
  }
  sub(o: OrderInfo) {
    return ({
      requested: "We're reviewing your design and will send a price soon. This page updates live.",
      quoted: 'Check the price below and accept it to confirm your cake.',
      placed: "We'll confirm your order shortly. This page updates live.",
      confirmed: "We'll bake it fresh for your delivery slot.",
      baking: 'Almost there. It will leave the kitchen for your delivery slot.',
      out_for_delivery: 'Your order is on its way. Keep your phone nearby.',
      delivered: 'Thanks for ordering with OliviaBakes.',
      cancelled: o.owner_note || 'If you have any questions, message us.',
    } as Record<string, string>)[o.status] ?? '';
  }
}