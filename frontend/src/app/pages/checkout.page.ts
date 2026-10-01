import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, CheckoutForm, deliveryFee, money } from '../api.service';

@Component({
  standalone: true,
  imports: [RouterLink],
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
            <input [value]="f().customer" (input)="set('customer', $any($event.target).value)" placeholder="Priya Sharma">
          </label>
          <label>Mobile number
            <input inputmode="numeric" maxlength="10" [value]="f().phone" (input)="set('phone', $any($event.target).value)" placeholder="9876543210">
          </label>
          <label>Email (optional)
            <input type="email" [value]="f().email" (input)="set('email', $any($event.target).value)" placeholder="you@example.com">
          </label>

          <h3>Pickup or delivery</h3>
          <div class="seg">
            <button [class.on]="f().fulfilment === 'pickup'" (click)="set('fulfilment', 'pickup')">Pickup at counter</button>
            <button [class.on]="f().fulfilment === 'delivery'" (click)="set('fulfilment', 'delivery')">Home delivery</button>
          </div>
          @if (f().fulfilment === 'delivery') {
            <label>Delivery address
              <textarea rows="3" [value]="f().address" (input)="set('address', $any($event.target).value)" placeholder="House no, street, area, city, pincode"></textarea>
            </label>
          }

          <h3>Payment</h3>
          <div class="seg">
            <button [class.on]="f().payment === 'cod'" (click)="set('payment', 'cod')">Pay on {{ f().fulfilment === 'pickup' ? 'pickup' : 'delivery' }}</button>
            <button [class.on]="f().payment === 'upi'" (click)="set('payment', 'upi')">UPI</button>
            <button [class.on]="f().payment === 'card'" (click)="set('payment', 'card')">Card</button>
          </div>
          <p class="muted small">Payments are simulated in this demo. No money is charged.</p>

          <label>Note for the kitchen (optional)
            <input [value]="f().note" (input)="set('note', $any($event.target).value)" placeholder="Less sweet, add a candle...">
          </label>
        </div>

        <aside class="panel sum">
          <h3>Order summary</h3>
          @for (l of api.lines(); track l.p.id) {
            <div class="srow"><span>{{ l.p.name }} x {{ l.qty }}</span><span>{{ money(l.p.price_paise * l.qty) }}</span></div>
          }
          <div class="srow"><span>Subtotal</span><span>{{ money(api.subtotal()) }}</span></div>
          <div class="srow"><span>Delivery</span><span>{{ fee() ? money(fee()) : f().fulfilment === 'delivery' ? 'Free' : '-' }}</span></div>
          <div class="srow big"><span>Total</span><b>{{ money(total()) }}</b></div>
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
  err = signal('');
  busy = signal(false);
  f = signal<CheckoutForm>({ customer: '', phone: '', email: '', fulfilment: 'pickup', address: '', payment: 'cod', note: '' });
  fee = computed(() => deliveryFee(this.api.subtotal(), this.f().fulfilment));
  total = computed(() => this.api.subtotal() + this.fee());

  set<K extends keyof CheckoutForm>(k: K, v: CheckoutForm[K]) { this.f.update(x => ({ ...x, [k]: v })); }

  async place() {
    const f = this.f();
    if (f.customer.trim().length < 2) return this.err.set('Enter your name');
    if (!/^[6-9]\d{9}$/.test(f.phone)) return this.err.set('Enter a valid 10-digit mobile number');
    if (f.fulfilment === 'delivery' && f.address.trim().length < 8) return this.err.set('Enter your full delivery address');
    this.err.set(''); this.busy.set(true);
    const e = await this.api.placeOrder(f);
    this.busy.set(false);
    if (e) this.err.set(e);
  }
}