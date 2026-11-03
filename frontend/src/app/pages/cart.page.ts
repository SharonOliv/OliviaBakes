import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, FREE_ABOVE, money } from '../api.service';

@Component({
  standalone: true,
  imports: [RouterLink],
  template: `
  <section class="page narrow">
    <h1 class="h1">Your bag</h1>
    @for (l of api.lines(); track l.p.id) {
      <div class="line">
        <div class="photo sm" [attr.data-c]="l.p.category">
          @if (l.p.image) { <img [src]="l.p.image" alt="" (error)="$any($event.target).style.display='none'"> }
        </div>
        <div class="grow"><b>{{ l.p.name }}</b><br><small class="muted">{{ money(l.p.price_paise) }} each</small></div>
        <div class="qty">
          <button (click)="api.dec(l.p.id)" aria-label="Remove one">&minus;</button><span>{{ l.qty }}</span><button (click)="api.add(l.p.id)" aria-label="Add one">+</button>
        </div>
      </div>
    } @empty { <p class="muted">Your bag is empty. <a routerLink="/menu" class="under">Browse the menu</a></p> }

    @if (api.count()) {
      <div class="panel" style="margin-top:26px">
        <h3>Deliver to</h3>
        <input inputmode="numeric" maxlength="6" placeholder="Pincode" aria-label="Delivery pincode" [value]="api.pin()" (input)="onPin($any($event.target).value)">
        @if (api.area(); as a) {
          @if (a.ok) { <p class="hint ok">We deliver to {{ a.area_name }}.</p> }
          @else { <p class="hint bad">We don't deliver to that pincode yet.</p> }
        }

        <h3>Bill details</h3>
        <div class="srow"><span>Item total</span><span>{{ money(api.subtotal()) }}</span></div>
        <div class="srow"><span>Delivery</span><span>{{ api.fee() === null ? 'Enter pincode' : api.fee() ? money(api.fee()!) : 'Free' }}</span></div>
        @if (api.fee() && api.toFree() > 0) {
          <div class="progress" aria-hidden="true"><i [style.width.%]="pct()"></i></div>
          <p class="muted small">Add {{ money(api.toFree()) }} more for free delivery.</p>
        }
        <div class="srow big"><span>To pay</span><b>{{ money(api.subtotal() + (api.fee() ?? 0)) }}</b></div>
        <a routerLink="/checkout" class="btn wide" [class.off]="blocked()">Continue to checkout</a>
      </div>
    }
  </section>
  `,
})
export class CartPage {
  api = inject(ApiService);
  money = money;
  pct = computed(() => Math.min(100, (this.api.subtotal() / FREE_ABOVE) * 100));
  blocked = computed(() => !!this.api.area() && !this.api.area()!.ok);
  onPin(v: string) { this.api.setPin(v.replace(/\D/g, '').slice(0, 6)); }
}