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
              <span class="tag" [class.low]="p.stock < 6" [class.out]="!p.stock">{{ p.stock ? p.stock + ' left' : 'Sold out' }}</span>
            </div>
            <button class="btn wide" [disabled]="!p.stock" (click)="api.add(p.id)">Add to bag</button>
          </div>
        </article>
      }
    </div>
    @if (api.count()) { <a routerLink="/cart" class="bagbar">View bag: {{ api.count() }} items, {{ money(api.subtotal()) }}</a> }
  </section>
  `,
})
export class MenuPage {
  api = inject(ApiService);
  money = money;
  cat = signal('all');
  cats = computed(() => ['all', ...new Set(this.api.products().map(p => p.category))]);
  shown = computed(() => this.api.products().filter(p => this.cat() === 'all' || p.category === this.cat()));
  hide(e: Event) { (e.target as HTMLElement).style.display = 'none'; }
}