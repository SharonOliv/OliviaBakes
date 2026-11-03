import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, money } from '../api.service';
import { RevealDirective, TiltDirective } from '../fx.directive';

@Component({
  standalone: true,
  imports: [RouterLink, RevealDirective, TiltDirective],
  template: `
  <section class="page">
    <h1 class="h1">The menu</h1>
    <p class="muted">Baked fresh for the day you choose at checkout. Want something special? <a routerLink="/custom" class="under">Order a custom cake</a>.</p>
    @if (api.area(); as a) {
      @if (!a.ok) { <p class="hint bad">We don't deliver to {{ api.pin() }} yet. You can still browse the menu.</p> }
    }
    <input class="search" type="search" placeholder="Search cookies, cakes, pastries..." aria-label="Search the menu"
           [value]="q()" (input)="q.set($any($event.target).value)">
    <div class="chips">
      @for (c of cats(); track c) { <button class="chip" [class.on]="cat() === c" (click)="cat.set(c)">{{ c }}</button> }
    </div>
    <div class="grid">
      @for (p of shown(); track p.id; let i = $index) {
        <article class="card" reveal [style.transition-delay.ms]="(i % 4) * 80">
          <div class="photo" tilt [attr.data-c]="p.category">
            @if (p.image) { <img [src]="p.image" [alt]="p.name" loading="lazy" (error)="hide($event)"> }
          </div>
          <div class="pad">
            <h3>{{ p.name }}</h3>
            <small class="muted cap">{{ p.category }}</small>
            <div class="row">
              <b class="price">{{ money(p.price_paise) }}</b>
              @if (!p.available) { <span class="tag out">Unavailable</span> }
            </div>
            @if (api.qty(p.id); as n) {
              <div class="stepper">
                <button (click)="api.dec(p.id)" aria-label="Remove one">&minus;</button>
                <span>{{ n }}</span>
                <button (click)="api.add(p.id)" aria-label="Add one">+</button>
              </div>
            } @else {
              <button class="btn wide" [disabled]="!p.available" (click)="api.add(p.id)">Add</button>
            }
          </div>
        </article>
      } @empty { <p class="muted">Nothing matches your search.</p> }
    </div>
    @if (api.count()) { <a routerLink="/cart" class="bagbar">View bag: {{ api.count() }} items, {{ money(api.subtotal()) }}</a> }
  </section>
  `,
})
export class MenuPage {
  api = inject(ApiService);
  money = money;
  cat = signal('all');
  q = signal('');
  cats = computed(() => ['all', ...new Set(this.api.products().map(p => p.category))]);
  shown = computed(() => {
    const q = this.q().trim().toLowerCase();
    return this.api.products().filter(p =>
      (this.cat() === 'all' || p.category === this.cat()) && (!q || (p.name + ' ' + p.category).toLowerCase().includes(q)));
  });
  hide(e: Event) { (e.target as HTMLElement).style.display = 'none'; }
}