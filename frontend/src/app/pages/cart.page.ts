import { Component, inject } from '@angular/core';
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
          <button (click)="api.dec(l.p.id)">-</button><span>{{ l.qty }}</span><button (click)="api.add(l.p.id)">+</button>
        </div>
      </div>
    } @empty { <p class="muted">Your bag is empty. <a routerLink="/menu" class="under">Browse the menu</a></p> }
    @if (api.count()) {
      <div class="row total"><span>Subtotal</span><b>{{ money(api.subtotal()) }}</b></div>
      <p class="muted small">Delivery is free above {{ money(free) }}. Chosen at checkout.</p>
      <a routerLink="/checkout" class="btn wide">Continue to checkout</a>
    }
  </section>
  `,
})
export class CartPage {
  api = inject(ApiService);
  money = money;
  free = FREE_ABOVE;
}