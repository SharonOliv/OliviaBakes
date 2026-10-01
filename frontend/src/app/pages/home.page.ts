import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, pad } from '../api.service';
import { RevealDirective } from '../fx.directive';

@Component({
  standalone: true,
  imports: [RouterLink, RevealDirective],
  template: `
  <section class="hero">
    <h1 class="mega">Baked fresh. Delivered warm.</h1>
    <div class="hero-foot">
      <div>
        <p>Small-batch cookies, cakes and pastries. Order in seconds, get your number, pick up when it is called.</p>
        <a routerLink="/menu" class="btn">Order now</a>
      </div>
      <div class="serving">
        <small>Now serving</small>
        <b>{{ serving() }}</b>
        <small>{{ api.queued().length }} waiting in line</small>
      </div>
    </div>
  </section>

  <div class="marquee">
    <div class="mtrack">
      @for (src of loop; track $index) { <img [src]="src" alt="" (error)="$any($event.target).style.display='none'"> }
    </div>
  </div>

  <section class="sec r">
    <div class="blk" reveal>
      <small class="eyebrow">The cookie</small>
      <h2>Real butter. Real chunks.</h2>
      <p>Every cookie is scooped by hand, rested for 24 hours and baked to order, so the edges are crisp and the centre stays soft.</p>
      <div class="facts"><div><b>24h</b><span>dough rest</span></div><div><b>11</b><span>chunks each</span></div><div><b>0</b><span>shortcuts</span></div></div>
    </div>
  </section>

  <section class="sec">
    <div class="blk" reveal>
      <small class="eyebrow">How it works</small>
      <h2>No waiting around. Just a number.</h2>
      <div class="step"><i>01</i><span>Pick your bakes and check out.</span></div>
      <div class="step"><i>02</i><span>Get a ticket number and watch your place in line move live.</span></div>
      <div class="step"><i>03</i><span>Collect at the counter, or get it delivered, when your number turns ready.</span></div>
      <p style="margin-top:18px"><b>{{ api.queue().length }}</b> orders in the kitchen right now.</p>
    </div>
  </section>

  <section class="sec r">
    <div class="blk" reveal>
      <small class="eyebrow">Bestsellers</small>
      <h2>What the line is ordering.</h2>
      @for (b of api.best(); track b.name) {
        <div class="rank"><span>{{ b.rank }}. {{ b.name }}</span><b>{{ b.sold }} sold</b></div>
      }
      <a routerLink="/menu" class="btn" style="margin-top:26px">See the full menu</a>
    </div>
  </section>
  `,
})
export class HomePage {
  api = inject(ApiService);
  serving = computed(() => { const r = this.api.ready()[0]; return r ? pad(r.ticket) : '--'; });
  private p = ['/images/chocolate-chunk.jpg', '/images/double-chocolate.jpg', '/images/strawberry-cream.jpg'];
  loop = [...this.p, ...this.p, ...this.p, ...this.p, ...this.p, ...this.p];
}