import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, DeliveryForm, dayLabel, money } from '../api.service';
import { WhenComponent } from '../when.component';

@Component({
  standalone: true,
  imports: [RouterLink, WhenComponent],
  template: `
  <section class="page">
    <h1 class="h1">Checkout</h1>
    @if (!api.count()) {
      <p class="muted">Your bag is empty. <a routerLink="/menu" class="under">Browse the menu</a></p>
    } @else {
      <div class="co">
        <div class="panel">
          <h3>Your details</h3>
          <label>Full name
            <input autocomplete="name" [value]="f().customer" (input)="set('customer', $any($event.target).value)" placeholder="Priya Sharma">
          </label>
          <label>Mobile number
            <input autocomplete="tel-national" inputmode="numeric" maxlength="10" [value]="f().phone" (input)="set('phone', $any($event.target).value)" placeholder="9876543210">
          </label>
          <label>Email (optional)
            <input autocomplete="email" type="email" [value]="f().email" (input)="set('email', $any($event.target).value)" placeholder="you@example.com">
          </label>

          <h3>Delivery address</h3>
          <label>Address
            <textarea autocomplete="street-address" rows="3" [value]="f().address" (input)="set('address', $any($event.target).value)" placeholder="House no, street, area, city"></textarea>
          </label>
          <label>Pincode
            <input autocomplete="postal-code" inputmode="numeric" maxlength="6" [value]="f().pincode" (input)="onPincode($any($event.target).value)" placeholder="520010">
          </label>
          @if (area(); as a) {
            @if (a.ok) { <p class="hint ok">We deliver to {{ a.area_name }}.</p> }
            @else { <p class="hint bad">We don't deliver to that pincode yet.</p> }
          }

          <h3>When should we deliver?</h3>
          <app-when mode="standard" [day]="f().delivery_date" [slot]="f().delivery_slot" (pick)="onWhen($event)" />

          <h3>Payment</h3>
          <div class="seg">
            <button [class.on]="f().payment === 'cod'" (click)="set('payment', 'cod')">Cash on delivery</button>
            <button [class.on]="f().payment === 'upi'" (click)="set('payment', 'upi')">UPI on delivery</button>
          </div>
          <p class="muted small">You pay when your order arrives. Online payment is coming soon.</p>

          <label>Note for the baker (optional)
            <input [value]="f().note" (input)="set('note', $any($event.target).value)" placeholder="Less sweet, add a candle...">
          </label>
        </div>

        <aside class="panel sum">
          <h3>Order summary</h3>
          @for (l of api.lines(); track l.p.id) {
            <div class="srow"><span>{{ l.p.name }} x {{ l.qty }}</span><span>{{ money(l.p.price_paise * l.qty) }}</span></div>
          }
          <div class="srow"><span>Item total</span><span>{{ money(api.subtotal()) }}</span></div>
          <div class="srow"><span>Delivery</span><span>{{ api.fee() === null ? 'Enter pincode' : api.fee() ? money(api.fee()!) : 'Free' }}</span></div>
          <div class="srow big"><span>To pay</span><b>{{ money(total()) }}</b></div>
          @if (f().delivery_date && f().delivery_slot) {
            <p class="muted small">Arriving {{ dayLabel(f().delivery_date) }}, {{ slotLabel() }}.</p>
          }
          @if (err()) { <p class="err">{{ err() }}</p> }
          <button class="btn wide" [disabled]="busy()" (click)="place()">{{ busy() ? 'Placing order...' : 'Place order' }}</button>
          <a routerLink="/cart" class="under muted small center-link">Back to bag</a>
        </aside>
      </div>
    }
  </section>
  `,
})
export class CheckoutPage {
  api = inject(ApiService);
  money = money;
  dayLabel = dayLabel;
  err = signal('');
  busy = signal(false);
  f = signal<DeliveryForm>({
    ...this.api.profile(), pincode: this.api.pin(),
    delivery_date: '', delivery_slot: '', payment: 'cod', note: '',
  });

  // the pincode check is shared with the rest of the site
  area = computed(() => (this.api.pin() === this.f().pincode ? this.api.area() : null));
  total = computed(() => this.api.subtotal() + (this.api.fee() ?? 0));
  slotLabel = () => this.api.avail()?.slot_labels[this.f().delivery_slot] ?? '';

  set<K extends keyof DeliveryForm>(k: K, v: DeliveryForm[K]) { this.f.update(x => ({ ...x, [k]: v })); }
  onWhen(e: { day: string; slot: string }) { this.f.update(x => ({ ...x, delivery_date: e.day, delivery_slot: e.slot })); }
  onPincode(v: string) {
    const pin = v.replace(/\D/g, '').slice(0, 6);
    this.set('pincode', pin);
    if (pin.length === 6) this.api.setPin(pin);
  }

  async place() {
    const f = this.f();
    if (f.customer.trim().length < 2) return this.err.set('Enter your name');
    if (!/^[6-9]\d{9}$/.test(f.phone)) return this.err.set('Enter a valid 10-digit mobile number');
    if (f.address.trim().length < 8) return this.err.set('Enter your full delivery address');
    if (!/^\d{6}$/.test(f.pincode)) return this.err.set('Enter a valid 6-digit pincode');
    if (this.area() && !this.area()!.ok) return this.err.set("We don't deliver to that pincode yet");
    if (!f.delivery_date) return this.err.set('Choose a delivery day');
    if (!f.delivery_slot) return this.err.set('Choose a delivery time');
    this.err.set(''); this.busy.set(true);
    const e = await this.api.placeOrder(f);
    this.busy.set(false);
    if (e) this.err.set(e);
  }
}