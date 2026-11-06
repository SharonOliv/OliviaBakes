import { Component, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../api.service';

interface Row { id: number; name: string; image: string | null; available: boolean; stock: number | null; max_qty: number | null; booked: number }

@Component({
  standalone: true,
  styles: [`
    .crow { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 12px 0; border-bottom: 1px solid var(--line); }
    .thumb { width: 52px; height: 52px; border-radius: 10px; object-fit: cover; background: #F2C7C7; flex: none; }
    .cin { width: 120px; padding: 8px 10px; }
    .st { font-size: .85rem; min-width: 170px; }
    .st.ok { color: var(--o); } .st.low { color: #b8860b; } .st.out { color: #b53030; }
  `],
  template: `
  <section class="page">
    <h1 class="h1">Daily capacity</h1>
    <p class="muted">Set how many of each item you can make for a delivery day. Leave it blank and that item is unlimited.</p>
    <div class="panel" style="margin-top:20px">
      <div class="inline" style="margin-top:0">
        <label style="margin:0">Delivery day <input type="date" [value]="date()" (change)="setDate($event)"></label>
        <label style="margin:0">Apply to the next (days) <input type="number" min="1" max="60" [value]="days()" (input)="days.set(val($event))"></label>
      </div>
      @for (r of rows(); track r.id) {
        <div class="crow">
          @if (r.image) { <img class="thumb" [src]="r.image" alt=""> } @else { <span class="thumb"></span> }
          <span class="grow"><b>{{ r.name }}</b>@if (!r.available) { <span class="tag low" style="margin-left:8px">Turned off</span> }</span>
          <span class="st" [class.ok]="tone(r) === 'ok'" [class.low]="tone(r) === 'low'" [class.out]="tone(r) === 'out'">{{ status(r) }}</span>
          <input #m class="cin" type="number" min="0" placeholder="Unlimited" [value]="r.max_qty ?? ''" aria-label="Max for this day">
          <button class="btn" (click)="save(r, m.value)">Save</button>
        </div>
      } @empty { <p class="muted" style="margin-top:16px">No items yet. Add some under Items.</p> }
    </div>
  </section>
  `,
})
export class CapacityPage {
  api = inject(ApiService);
  private http = inject(HttpClient);
  rows = signal<Row[]>([]);
  date = signal(new Date(Date.now() + 864e5).toLocaleDateString('en-CA'));   // tomorrow
  days = signal('1');

  constructor() { this.load(); }

  val(e: Event) { return (e.target as HTMLInputElement).value; }
  setDate(e: Event) { this.date.set(this.val(e)); this.load(); }
  async load() {
    try { this.rows.set(await firstValueFrom(this.http.get<Row[]>('/api/admin/capacity', { params: { date: this.date() } }))); }
    catch (e: any) { this.api.say(e.error?.error ?? 'Could not load items'); }
  }
  left(r: Row) { return r.max_qty === null ? null : Math.max(0, r.max_qty - r.booked); }
  tone(r: Row) { const l = this.left(r); return l === null ? 'ok' : l === 0 ? 'out' : l <= 3 ? 'low' : 'ok'; }
  status(r: Row) {
    const l = this.left(r);
    return l === null ? `Unlimited (${r.booked} booked)` : l === 0 ? `Full for the day (${r.booked} booked)` : `${l} left of ${r.max_qty} (${r.booked} booked)`;
  }
  async save(r: Row, v: string) {
    const max_qty = v.trim() === '' ? null : Number(v);
    if (max_qty !== null && (!Number.isInteger(max_qty) || max_qty < 0)) return this.api.say('Enter a whole number, or leave it blank for unlimited');
    try {
      await firstValueFrom(this.http.put('/api/admin/capacity', { date: this.date(), product_id: r.id, max_qty, days: Number(this.days()) || 1 }));
      this.api.say(max_qty === null ? 'Set to unlimited' : 'Saved');
      this.load();
    } catch (e: any) { this.api.say(e.error?.error ?? 'Something went wrong'); }
  }
}