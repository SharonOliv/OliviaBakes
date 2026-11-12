import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService, FREE_ABOVE, Product, money } from '../api.service';
import { AuthService } from '../auth.service';

interface Offer { id: number; title: string; subtitle: string; terms: string; cta: string }

@Component({
  standalone: true,
  imports: [RouterLink, NgTemplateOutlet],
  styles: [`
    :host { display: block; padding-bottom: 90px; }
    .wrap { max-width: 1200px; margin: 0 auto; padding: 0 5vw; }
    .hero { background: linear-gradient(180deg, #FFE3E9, #fff); padding: 48px 0 12px; }
    .hgrid { display: grid; grid-template-columns: 1.1fr .9fr; gap: 40px; align-items: center; }
    h1 { font-size: clamp(2.1rem, 4.8vw, 3.4rem); line-height: 1.08; letter-spacing: -.03em; max-width: 13ch; margin-bottom: 12px; }
    .hsub { color: var(--m); max-width: 44ch; margin-bottom: 22px; }
    .hcta { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
    .hnote { color: var(--m); font-size: .9rem; }
    .hvis { aspect-ratio: 4 / 3; border-radius: 24px; overflow: hidden; box-shadow: 0 18px 44px #c2365c2e; background: #F2C7C7; }
    .hvis img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .offers { display: flex; gap: 14px; overflow-x: auto; padding: 26px 0 8px; scrollbar-width: none; }
    .offer { flex: 0 0 250px; border-radius: 14px; padding: 16px 18px; }
    .offer b { display: block; margin-bottom: 4px; }
    .offer span { font-size: .88rem; color: var(--m); }
    .bar { position: sticky; top: 64px; z-index: 20; background: #fffffff2; backdrop-filter: blur(8px); border-bottom: 1px solid #f1e3e6; margin-top: 18px; }
    .barin { display: flex; align-items: center; gap: 16px; padding-top: 12px; padding-bottom: 12px; }
    .sbox { flex: 0 0 min(340px, 100%); }
    .sbox input { padding: 11px 18px; border-radius: 999px; }
    .cats { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; }
    .cats button { border: 1px solid var(--line); background: #fff; border-radius: 999px; padding: 8px 18px; font: 500 .9rem var(--body); cursor: pointer; text-transform: capitalize; white-space: nowrap; color: var(--t); }
    .cats button.on { background: var(--a); border-color: var(--a); color: #fff; }
    h2 { font-size: 1.25rem; margin: 24px 0 0; }
    .pgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 22px; margin-top: 18px; }
    .pcard { background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 2px 14px #0000001a; display: flex; flex-direction: column; cursor: pointer; transition: transform .2s, box-shadow .2s; }
    .pcard:hover { transform: translateY(-3px); box-shadow: 0 8px 24px #00000024; }
    .pcard.out { opacity: .6; }
    .pphoto { position: relative; aspect-ratio: 4 / 3; background: #F2C7C7; }
    .pphoto img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .heart { position: absolute; top: 10px; right: 10px; width: 36px; height: 36px; border-radius: 50%; border: 0; background: #ffffffe6; color: #c9b3b8; font-size: 1.2rem; cursor: pointer; }
    .heart.on { color: var(--a); }
    .pbody { padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 6px; flex: 1; }
    .pbody h3 { font-size: 1rem; }
    .pmeta { font-size: .82rem; color: var(--m); min-height: 1.2em; }
    .pfoot { margin-top: auto; padding-top: 6px; display: flex; align-items: center; justify-content: space-between; }
    .padd { border: 1px solid var(--a); color: var(--a); background: #fff; border-radius: 10px; padding: 8px 26px; font: 700 .9rem var(--body); cursor: pointer; }
    .padd:hover { background: #FFF1F4; }
    .pstep { display: flex; align-items: center; gap: 14px; border: 1px solid var(--a); border-radius: 10px; padding: 3px 8px; color: var(--a); font-weight: 700; }
    .pstep button { border: 0; background: none; font-size: 1.2rem; color: inherit; cursor: pointer; padding: 2px 8px; }
    .psold { font-size: .85rem; color: var(--m); }
    .deliver { margin-top: 56px; background: #FFF1F4; padding: 48px 5vw; text-align: center; }
    .deliver input { max-width: 260px; margin-top: 16px; text-align: center; font-size: 1.1rem; letter-spacing: .2em; }
    .dstat { margin-top: 14px; }
    .dstat.ok { color: var(--o); } .dstat.bad { color: #b53030; }
    .cartbar { position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); width: min(560px, calc(100% - 24px)); background: var(--a); color: #fff; border-radius: 14px; padding: 14px 20px; display: flex; justify-content: space-between; box-shadow: 0 8px 24px #c2365c66; z-index: 20; }
    .mback { position: fixed; inset: 0; background: #0007; z-index: 100; display: grid; place-items: center; padding: 16px; }
    .modal { position: relative; background: #fff; border-radius: 20px; max-width: 760px; width: 100%; max-height: 90vh; overflow: auto; display: grid; grid-template-columns: 1fr 1fr; }
    .mimg { background: #F2C7C7; min-height: 260px; }
    .mimg img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .mbody { padding: 26px; display: flex; flex-direction: column; gap: 10px; }
    .mbody h4 { font-size: .78rem; letter-spacing: .08em; text-transform: uppercase; color: var(--m); margin-top: 6px; }
    .mx { position: absolute; top: 10px; right: 12px; width: 36px; height: 36px; border-radius: 50%; border: 0; background: #ffffffe6; font-size: 1.4rem; cursor: pointer; z-index: 2; }
    .atags { display: flex; gap: 6px; flex-wrap: wrap; }
    .atags span { background: #FFF1F4; color: var(--a); border-radius: 999px; padding: 4px 12px; font-size: .82rem; }
    .mfine { font-size: .8rem; color: var(--m); }
    @media (max-width: 800px) { .hgrid { grid-template-columns: 1fr; } .hvis { display: none; } .barin { flex-wrap: wrap; } .sbox { flex: 1 1 100%; } .modal { grid-template-columns: 1fr; } .mimg { min-height: 200px; } }
    .osec { padding-top: 26px; }
    .oh { font-size: 1.25rem; margin: 0 0 14px; }
    .marquee { overflow: hidden; -webkit-mask-image: linear-gradient(90deg, transparent, #000 3%, #000 97%, transparent); mask-image: linear-gradient(90deg, transparent, #000 3%, #000 97%, transparent); }
    .mtrack { display: flex; width: max-content; animation: slide 60s linear infinite; }
    .marquee:hover .mtrack { animation-play-state: paused; }
    .mset { display: flex; gap: 14px; padding-right: 14px; }
    .ocard { flex: 0 0 300px; border-radius: 16px; padding: 16px 18px; display: flex; flex-direction: column; gap: 4px; }
    .ocard b { font-size: 1.05rem; }
    .ocard span { color: var(--m); font-size: .9rem; }
    .ocard small { color: var(--m); font-size: .74rem; }
    .claim { align-self: flex-start; margin-top: 10px; border: 0; background: var(--a); color: #fff; border-radius: 999px; padding: 8px 18px; font: 700 .85rem var(--body); cursor: pointer; }
    .claim:hover { background: #9e2b4b; }
    @keyframes slide { to { transform: translateX(-50%); } }
    @media (prefers-reduced-motion: reduce) { .marquee { overflow-x: auto; } .mtrack { animation: none; } }
  `],
  template: `
  <ng-template #buy let-p>
    <div (click)="$event.stopPropagation()">
      @let n = api.qty(p.id);
      @if (!p.available) { <span class="psold">Sold out</span> }
      @else if (n) {
        <div class="pstep">
          <button (click)="api.dec(p.id)" aria-label="Remove one">&minus;</button>
          <span>{{ n }}</span>
          <button (click)="api.add(p.id)" aria-label="Add one">+</button>
        </div>
      } @else { <button class="padd" (click)="api.add(p.id)">ADD</button> }
    </div>
  </ng-template>

  <section class="hero">
    <div class="wrap">
      <div class="hgrid">
        <div>
          <h1>Fresh cookies, baked just for you.</h1>
          <p class="hsub">From our home kitchen to your door. Pick a day and a time slot, and we deliver them fresh.</p>
          <div class="hcta">
            <a href="#menu" class="btn">Order now</a>
            <span class="hnote">Free delivery above {{ money(free) }}</span>
          </div>
        </div>
        @if (heroImg() && heroOk()) {
          <div class="hvis"><img [src]="heroImg()" alt="" (error)="heroOk.set(false)"></div>
        }
      </div>
    </div>
  </section>

    @if (offers().length) {
    <section class="osec">
      <div class="wrap">
        <h2 class="oh">Offers</h2>
        <div class="marquee">
          <div class="mtrack" [style.animation-duration.s]="fill().length * 12">
            @for (copy of [0, 1]; track copy) {
              <div class="mset" [attr.aria-hidden]="copy === 1" [attr.inert]="copy === 1 ? '' : null">
                @for (o of fill(); track $index; let i = $index) {
                  <div class="ocard" [style.background]="colors[i % colors.length]">
                    <b>{{ o.title }}</b>
                    <span>{{ o.subtitle }}</span>
                    @if (o.terms) { <small>{{ o.terms }}</small> }
                    @if (o.cta) { <button class="claim" (click)="claim()">{{ o.cta }}</button> }
                  </div>
                }
              </div>
            }
          </div>
        </div>
      </div>
    </section>
  }
  <div class="bar" id="menu">
    <div class="wrap barin">
      <div class="sbox">
        <input type="search" placeholder="Search cookies" aria-label="Search the menu" [value]="q()" (input)="q.set(val($event))">
      </div>
      <div class="cats">
        <button [class.on]="!cat()" (click)="cat.set('')">All</button>
        @for (c of cats(); track c) { <button [class.on]="cat() === c" (click)="cat.set(c)">{{ c }}</button> }
      </div>
    </div>
  </div>

  <div class="wrap">
    <h2>{{ shown().length }} {{ shown().length === 1 ? 'item' : 'items' }}@if (q().trim()) { for "{{ q().trim() }}" }</h2>
    <div class="pgrid">
      @for (p of shown(); track p.id) {
        <article class="pcard" [class.out]="!p.available" tabindex="0" (click)="sel.set(p)" (keydown.enter)="sel.set(p)">
          <div class="pphoto">
            @if (p.image) { <img [src]="p.image" [alt]="p.name" loading="lazy" (error)="hide($event)"> }
            <button class="heart" [class.on]="auth.favs().has(p.id)" (click)="auth.toggleFav(p.id); $event.stopPropagation()" aria-label="Favourite">&#9829;</button>
          </div>
          <div class="pbody">
            <h3>{{ p.name }}</h3>
            <span class="pmeta">
              @if (p.weight_g) { {{ p.weight_g }} g each }
              @if (p.stock !== null && p.stock > 0 && p.stock <= 5) { | Only {{ p.stock }} left }
            </span>
            <div class="pfoot">
              <b>{{ money(p.price_paise) }}</b>
              <ng-container *ngTemplateOutlet="buy; context: { $implicit: p }"></ng-container>
            </div>
          </div>
        </article>
      }
    </div>
    @if (!shown().length) { <p class="muted" style="margin-top:18px">Nothing matches your search.</p> }
  </div>

  <section class="deliver">
    <h2 style="margin-top:0">Do we deliver to you?</h2>
    <p class="muted">Enter your pincode to check.</p>
    <input inputmode="numeric" maxlength="6" placeholder="Pincode" aria-label="Pincode" [value]="api.pin()" (input)="onPin($event)">
      <p class="small muted" style="margin-top:8px">Demo site: use pincode 000000</p>
    @if (api.pin().length === 6) {
      @if (api.area(); as a) {
        @if (a.ok) { <p class="dstat ok">Yes, we deliver to {{ a.area_name }}. Delivery is {{ a.delivery_paise ? money(a.delivery_paise) : 'free' }}, and free above {{ money(free) }}.</p> }
        @else { <p class="dstat bad">Sorry, we don't deliver to that pincode yet.</p> }
      } @else { <p class="dstat muted">Checking...</p> }
    }
  </section>

  @if (api.count()) {
    <a routerLink="/cart" class="cartbar">
      <span>{{ api.count() }} {{ api.count() === 1 ? 'item' : 'items' }} | {{ money(api.subtotal()) }}</span>
      <b>View bag &rarr;</b>
    </a>
  }

  @if (sel(); as p) {
    <div class="mback" (click)="sel.set(null)">
      <div class="modal" role="dialog" aria-modal="true" (click)="$event.stopPropagation()">
        <button class="mx" (click)="sel.set(null)" aria-label="Close">&times;</button>
        <div class="mimg">@if (p.image) { <img [src]="p.image" [alt]="p.name"> }</div>
        <div class="mbody">
          <h3>{{ p.name }}</h3>
          <p><b>{{ money(p.price_paise) }}</b>@if (p.weight_g) { <span class="muted"> | {{ p.weight_g }} g each</span> }</p>
          @if (p.ingredients) { <h4>Ingredients</h4><p>{{ p.ingredients }}</p> }
          @if (p.allergens) {
            <h4>Allergens</h4>
            <div class="atags">@for (a of allergenList(p); track a) { <span>{{ a }}</span> }</div>
          }
          <p class="mfine">Baked in a home kitchen. If you have a serious allergy, please contact us before ordering.</p>
          <div class="pfoot"><ng-container *ngTemplateOutlet="buy; context: { $implicit: p }"></ng-container></div>
        </div>
      </div>
    </div>
  }
  `,
})
export class HomePage {
  api = inject(ApiService);
  auth = inject(AuthService);
  private http = inject(HttpClient);
  money = money;
  free = FREE_ABOVE;
  q = signal('');
  cat = signal('');
  sel = signal<Product | null>(null);
  offers = signal<Offer[]>([]);
  heroOk = signal(true);
  colors = ['#FFE3E9', '#D5F3D8', '#F2C7C7'];
  heroImg = computed(() => this.api.products().find(p => p.image)?.image ?? null);
  cats = computed(() => [...new Set(this.api.products().map(p => p.category))]);
  shown = computed(() => {
  const terms = this.words(this.q()), c = this.cat();
  let list = this.api.products().filter(p => !c || p.category === c);
  if (terms.length) {
    const hit = (text: string) => { const ws = this.words(text); return terms.every(t => ws.some(w => this.near(t, w))); };
    const byName = list.filter(p => hit(p.name + ' ' + p.category));
    list = byName.length ? byName : list.filter(p => hit(p.ingredients ?? ''));   // nothing by name: try ingredients
  }
  
  return list;
});


    // repeats the offers so one set is always wider than the screen (keeps the loop seamless)
  fill = computed(() => {
    const l = this.offers();
    return l.length ? Array.from({ length: Math.ceil(5 / l.length) }, () => l).flat() : [];
  });
  claim() {
    this.api.say('Add your cookies to the bag. Your offer is applied automatically at checkout if you qualify.');
    document.getElementById('menu')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  constructor() {
    firstValueFrom(this.http.get<Offer[]>('/api/offers')).then(o => this.offers.set(o)).catch(() => {});
  }
  @HostListener('document:keydown.escape') esc() { this.sel.set(null); }
  val(e: Event) { return (e.target as HTMLInputElement).value; }
    private words(s: string) {
    return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter(Boolean);
  }
  // does the typed word t match the item word w? ("chocolate" matches "choco", "chocochip" and the typo "choclate")
  private near(t: string, w: string) {
    if (w.includes(t) || (w.length >= 4 && t.includes(w))) return true;
    let i = 0;
    while (i < t.length && i < w.length && t[i] === w[i]) i++;
    if (i >= 5) return true;
    return t.length >= 6 && w.length >= 6 && this.lev(t, w) <= 2;
  }
  private lev(a: string, b: string) {
    const d = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      let prev = d[0]; d[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const tmp = d[j];
        d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = tmp;
      }
    }
    return d[b.length];
  }
  onPin(e: Event) { this.api.setPin(this.val(e).replace(/\D/g, '').slice(0, 6)); }
  hide(e: Event) { (e.target as HTMLElement).style.display = 'none'; }
  allergenList(p: Product) { return (p.allergens ?? '').split(',').map(s => s.trim()).filter(Boolean); }
}