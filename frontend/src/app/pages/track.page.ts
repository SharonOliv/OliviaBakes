import { Component, effect, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ApiService, OrderInfo, pad } from '../api.service';

@Component({
  standalone: true,
  template: `
  <section class="page narrow center">
    @if (o(); as ord) {
      <small class="eyebrow">Your ticket</small>
      <div class="ticket">{{ pad(ord.ticket) }}</div>
      <h2 class="h2">{{ headline(ord) }}</h2>
      <p class="muted">{{ sub(ord) }}</p>
      <div class="steps">
        @for (s of steps; track s) { <div [class.on]="idx(s) <= idx(ord.status)">{{ labels[s] }}</div> }
      </div>
    } @else { <p class="muted">Looking for your order...</p> }
  </section>
  `,
})
export class TrackPage {
  api = inject(ApiService);
  id = inject(ActivatedRoute).snapshot.paramMap.get('id')!;
  o = signal<OrderInfo | null>(null);
  pad = pad;
  steps = ['queued', 'preparing', 'ready'];
  labels: Record<string, string> = { queued: 'In the queue', preparing: 'Baking', ready: 'Ready' };

  constructor() { effect(() => { this.api.queue(); this.load(); }); }
  async load() { try { this.o.set(await this.api.fetchOrder(this.id)); } catch { this.o.set(null); } }
  idx(s: string) { return ['queued', 'preparing', 'ready', 'collected'].indexOf(s); }
  headline(o: OrderInfo) {
    const pos = o.position ?? 1;
    if (o.status === 'queued') return pos <= 1 ? "You're next" : `${pos - 1} orders ahead of you`;
    if (o.status === 'preparing') return 'Baking your order now';
    if (o.status === 'ready') return 'Ready for pickup';
    return 'Enjoy your bakes';
  }
  sub(o: OrderInfo) {
    if (o.status === 'queued') return `About ${((o.position ?? 1) + this.api.preparing().length) * 2} min. This page updates live.`;
    if (o.status === 'preparing') return 'Almost there. Stay close.';
    if (o.status === 'ready') return `Show ticket ${pad(o.ticket)} at the counter.`;
    return 'Thanks for ordering with OliveBakes.';
  }
}