import { Component, inject } from '@angular/core';
import { ApiService, pad } from '../api.service';

@Component({
  standalone: true,
  template: `
  <section class="page">
    <h1 class="h1">Now serving</h1>
    <p class="muted">{{ api.queued().length }} waiting in line. Live from the kitchen.</p>
    <div class="board">
      <div class="col">
        <h2>Preparing</h2>
        <div class="nums">@for (o of api.preparing(); track o.id) { <span>{{ pad(o.ticket) }}</span> } @empty { <span class="dim">--</span> }</div>
      </div>
      <div class="col go">
        <h2>Ready for pickup</h2>
        <div class="nums">@for (o of api.ready(); track o.id) { <span>{{ pad(o.ticket) }}</span> } @empty { <span class="dim">--</span> }</div>
      </div>
    </div>
  </section>
  `,
})
export class BoardPage { api = inject(ApiService); pad = pad; }