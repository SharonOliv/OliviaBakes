import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, CustomDetails, DeliveryForm } from '../api.service';
import { WhenComponent } from '../when.component';

@Component({
  standalone: true,
  imports: [RouterLink, WhenComponent],
  template: `
  <section class="page narrow">
    <h1 class="h1">Custom cake</h1>
    <p class="muted">Tell us about the cake you have in mind. We'll review it and send you a price. You only confirm once you accept it, and you pay on delivery.</p>
    <div class="panel" style="margin-top:26px">
      <h3>Your cake</h3>
      <label>Flavour
        <input [value]="d().flavour" (input)="setD('flavour', $any($event.target).value)" placeholder="Vanilla, chocolate, red velvet...">
      </label>
      <label>Weight (kg)
        <input type="number" min="0.5" max="10" step="0.5" [value]="d().weight_kg" (input)="setD('weight_kg', +$any($event.target).value)">
      </label>
      <label>Message on the cake (optional)
        <input maxlength="60" [value]="d().message" (input)="setD('message', $any($event.target).value)" placeholder="Happy Birthday Anu">
      </label>
      <label>Design and details
        <textarea rows="4" maxlength="500" [value]="d().description" (input)="setD('description', $any($event.target).value)" placeholder="Colours, theme, decorations, anything we should know"></textarea>
      </label>

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

      <h3>Delivery address</h3>
      <label>Address
        <textarea rows="3" [value]="f().address" (input)="set('address', $any($event.target).value)" placeholder="House no, street, area, city"></textarea>
      </label>
      <label>Pincode
        <input autocomplete="postal-code" inputmode="numeric" maxlength="6" [value]="f().pincode" (input)="onPincode($any($event.target).value)" placeholder="520010">
      </label>
      @if (area(); as a) {
        @if (a.ok) { <p class="hint ok">We deliver to {{ a.area_name }}.</p> }
        @else { <p class="hint bad">We don't deliver to that pincode yet.</p> }
      }

      <h3>When should we deliver?</h3>
      <app-when mode="custom" [day]="f().delivery_date" [slot]="f().delivery_slot" (pick)="onWhen($event)" />

      <h3>Payment</h3>
      <div class="seg">
        <button [class.on]="f().payment === 'cod'" (click)="set('payment', 'cod')">Cash on delivery</button>
        <button [class.on]="f().payment === 'upi'" (click)="set('payment', 'upi')">UPI on delivery</button>
      </div>

      <label>Anything else (optional)
        <input [value]="f().note" (input)="set('note', $any($event.target).value)" placeholder="Allergies, delivery instructions...">
      </label>
      @if (err()) { <p class="err">{{ err() }}</p> }
      <button class="btn wide" [disabled]="busy()" (click)="send()">{{ busy() ? 'Sending...' : 'Send request' }}</button>
      <a routerLink="/menu" class="under muted small center-link">Back to the menu</a>
    </div>
  </section>
  `,
})
export class CustomPage {
  api = inject(ApiService);
  err = signal('');
  busy = signal(false);
  d = signal<CustomDetails>({ flavour: '', weight_kg: 1, message: '', description: '' });
  f = signal<DeliveryForm>({
    ...this.api.profile(), pincode: this.api.pin(),
    delivery_date: '', delivery_slot: '', payment: 'cod', note: '',
  });

  area = computed(() => (this.api.pin() === this.f().pincode ? this.api.area() : null));

  set<K extends keyof DeliveryForm>(k: K, v: DeliveryForm[K]) { this.f.update(x => ({ ...x, [k]: v })); }
  setD<K extends keyof CustomDetails>(k: K, v: CustomDetails[K]) { this.d.update(x => ({ ...x, [k]: v })); }
  onWhen(e: { day: string; slot: string }) { this.f.update(x => ({ ...x, delivery_date: e.day, delivery_slot: e.slot })); }
  onPincode(v: string) {
    const pin = v.replace(/\D/g, '').slice(0, 6);
    this.set('pincode', pin);
    if (pin.length === 6) this.api.setPin(pin);
  }

  async send() {
    const f = this.f(), d = this.d();
    if (!d.flavour.trim()) return this.err.set('Tell us the flavour you want');
    if (!(d.weight_kg >= 0.5 && d.weight_kg <= 10)) return this.err.set('Cake weight must be between 0.5 and 10 kg');
    if (d.description.trim().length < 10) return this.err.set('Describe the design you have in mind');
    if (f.customer.trim().length < 2) return this.err.set('Enter your name');
    if (!/^[6-9]\d{9}$/.test(f.phone)) return this.err.set('Enter a valid 10-digit mobile number');
    if (f.address.trim().length < 8) return this.err.set('Enter your full delivery address');
    if (!/^\d{6}$/.test(f.pincode)) return this.err.set('Enter a valid 6-digit pincode');
    if (this.area() && !this.area()!.ok) return this.err.set("We don't deliver to that pincode yet");
    if (!f.delivery_date) return this.err.set('Choose a delivery date');
    if (!f.delivery_slot) return this.err.set('Choose a delivery time');
    this.err.set(''); this.busy.set(true);
    const e = await this.api.placeCustom(f, { ...d, flavour: d.flavour.trim(), message: d.message.trim(), description: d.description.trim() });
    this.busy.set(false);
    if (e) this.err.set(e);
  }
}