import { Component, inject, signal } from '@angular/core';
import { ApiService, pad } from '../api.service';

@Component({
  standalone: true,
  template: `
  <section class="page">
    <div class="row">
      <h1 class="h1">Kitchen</h1>
      <div>
        <button class="btn ghost" (click)="toggle()">Auto-kitchen: {{ auto() ? 'On' : 'Off' }}</button>
        <button class="btn" (click)="api.next()" style="margin-left:10px">Take next order</button>
      </div>
    </div>
    <p class="muted">Turn auto-kitchen off to run the line yourself.</p>
    <div class="kcols">
      <div>
        <h3>In queue ({{ api.queued().length }})</h3>
        @for (o of api.queued(); track o.id) {
          <div class="kcard"><b>{{ pad(o.ticket) }}</b><span>{{ o.customer }}</span>
            <ul>@for (i of o.items ?? []; track i.name) { <li>{{ i.qty }} x {{ i.name }}</li> }</ul></div>
        }
      </div>
      <div>
        <h3>Preparing ({{ api.preparing().length }})</h3>
        @for (o of api.preparing(); track o.id) {
          <div class="kcard"><b>{{ pad(o.ticket) }}</b><span>{{ o.customer }}</span>
            <ul>@for (i of o.items ?? []; track i.name) { <li>{{ i.qty }} x {{ i.name }}</li> }</ul>
            <button class="btn" (click)="api.move(o.id, 'ready')">Mark ready</button></div>
        }
      </div>
      <div>
        <h3>Ready ({{ api.ready().length }})</h3>
        @for (o of api.ready(); track o.id) {
          <div class="kcard"><b>{{ pad(o.ticket) }}</b><span>{{ o.customer }}</span>
            <button class="btn" (click)="api.move(o.id, 'collect')">Collected</button></div>
        }
      </div>
    </div>
  </section>
  `,
})
export class KitchenPage {
  api = inject(ApiService);
  pad = pad;
  auto = signal(true);
  constructor() { this.api.auto().then(v => this.auto.set(v)); }
  async toggle() { this.auto.set(await this.api.toggleAuto()); }
}