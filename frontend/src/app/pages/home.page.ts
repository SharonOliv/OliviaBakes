import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, FREE_ABOVE, money } from '../api.service';

@Component({
  standalone: true,
  imports: [RouterLink],
  template: `
  <section class="hero2">
    <svg class="bloom b1" viewBox="-50 -50 100 100" aria-hidden="true">
      <g fill="#FFB7C5" stroke="#FFFFFF" stroke-width="2">
        <ellipse cx="0" cy="-24" rx="15" ry="24"/><ellipse cx="0" cy="-24" rx="15" ry="24" transform="rotate(72)"/>
        <ellipse cx="0" cy="-24" rx="15" ry="24" transform="rotate(144)"/><ellipse cx="0" cy="-24" rx="15" ry="24" transform="rotate(216)"/>
        <ellipse cx="0" cy="-24" rx="15" ry="24" transform="rotate(288)"/>
      </g>
      <circle r="8" fill="#F2C7C7"/>
    </svg>
    <svg class="bloom b2" viewBox="-50 -50 100 100" aria-hidden="true">
      <g fill="#F2C7C7" stroke="#FFFFFF" stroke-width="2">
        <ellipse cx="0" cy="-24" rx="15" ry="24"/><ellipse cx="0" cy="-24" rx="15" ry="24" transform="rotate(72)"/>
        <ellipse cx="0" cy="-24" rx="15" ry="24" transform="rotate(144)"/><ellipse cx="0" cy="-24" rx="15" ry="24" transform="rotate(216)"/>
        <ellipse cx="0" cy="-24" rx="15" ry="24" transform="rotate(288)"/>
      </g>
      <circle r="8" fill="#FFFFFF"/>
    </svg>

    <div>
      <h1>Baked to order, delivered to your door.</h1>
      <p class="lede">Cookies, cakes and pastries from a home kitchen. Choose the day and time you want them, and we bring them fresh.</p>
      <div class="cta">
        <a routerLink="/menu" class="btn">See the menu</a>
        <a routerLink="/custom" class="btn ghost">Order a custom cake</a>
      </div>
      <ul class="perks">
        <li>Baked fresh for your day</li>
        <li>Free delivery above {{ money(free) }}</li>
        <li>Order {{ api.leadHours() }} hours ahead</li>
      </ul>
    </div>

    <div class="arches" aria-hidden="true">
      <div class="arch a"><img src="/images/chocolate-chunk.jpg" alt="" (error)="hide($event)"></div>
      <div class="arch b"><img src="/images/double-chocolate.jpg" alt="" (error)="hide($event)"></div>
      <div class="arch c"><img src="/images/strawberry-cream.jpg" alt="" (error)="hide($event)"></div>
    </div>
  </section>

  <section class="band">
    <div class="wrap">
      <div class="sec-head">
        <h2 class="h2">Start with a favourite</h2>
        <a routerLink="/menu" class="under">See the full menu</a>
      </div>
      <div class="grid">
        @for (p of featured(); track p.id) {
          <article class="card">
            <div class="photo" [attr.data-c]="p.category">
              @if (p.image) { <img [src]="p.image" [alt]="p.name" loading="lazy" (error)="hide($event)"> }
            </div>
            <div class="pad">
              <h3>{{ p.name }}</h3>
              <div class="row"><b class="price">{{ money(p.price_paise) }}</b></div>
              @if (api.qty(p.id); as n) {
                <div class="stepper">
                  <button (click)="api.dec(p.id)" aria-label="Remove one">&minus;</button>
                  <span>{{ n }}</span>
                  <button (click)="api.add(p.id)" aria-label="Add one">+</button>
                </div>
              } @else {
                <button class="btn wide" (click)="api.add(p.id)">Add</button>
              }
            </div>
          </article>
        }
      </div>
    </div>
  </section>

  <section class="band cake-band">
    <div class="wrap">
      <div>
        <h2 class="h2">Celebrating something? Design your own cake.</h2>
        <p>Tell us the flavour, size and look you have in mind. We'll send you a price, and you only confirm once you're happy with it.</p>
        <a routerLink="/custom" class="btn dark">Request a custom cake</a>
      </div>
      <div class="cake-arch" aria-hidden="true"><img src="/images/chocolate-cake.jpg" alt="" (error)="hide($event)"></div>
    </div>
  </section>

  <section class="band how">
    <div class="wrap">
      <h2 class="h2">How ordering works</h2>
      <div class="how-grid">
        <div><div class="n">1</div><h3>Pick your bakes</h3><p>Fill your bag from the menu, or send us a custom cake request.</p></div>
        <div><div class="n">2</div><h3>Choose a day and time</h3><p>Select the delivery date and slot that suit you. Days that are full are marked.</p></div>
        <div><div class="n">3</div><h3>We bake and deliver</h3><p>Your order is baked fresh and brought to your door. You pay when it arrives.</p></div>
      </div>
    </div>
  </section>

  <section class="band check">
    <div class="wrap">
      <h2 class="h2">Do we deliver to you?</h2>
      <p class="muted">Enter your pincode to find out.</p>
      <div class="inline">
        <input inputmode="numeric" maxlength="6" placeholder="Pincode" aria-label="Pincode" [value]="api.pin()" (input)="onPin($any($event.target).value)">
      </div>
      @if (api.area(); as a) {
        @if (a.ok) { <p class="hint ok">Yes, we deliver to {{ a.area_name }}. Delivery is {{ a.delivery_paise ? money(a.delivery_paise) : 'free' }}, and free above {{ money(free) }}.</p> }
        @else { <p class="hint bad">We don't deliver to that pincode yet.</p> }
      }
    </div>
  </section>
  `,
})
export class HomePage {
  api = inject(ApiService);
  money = money;
  free = FREE_ABOVE;
  featured = computed(() => this.api.products().filter(p => p.available).slice(0, 4));

  hide(e: Event) { (e.target as HTMLElement).style.display = 'none'; }
  onPin(v: string) { this.api.setPin(v.replace(/\D/g, '').slice(0, 6)); }
}