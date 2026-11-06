import { Component, computed, effect, inject, signal, WritableSignal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom, map } from 'rxjs';
import { ApiService, STATUS_LABEL, dayLabel, money } from '../api.service';
import { AuthService, User } from '../auth.service';

interface Row { id: number; public_token: string; kind: string; status: string; delivery_date: string; total_paise: number }
interface Addr { id: number; label: string; address: string; pincode: string; is_default: boolean }
interface AddrForm { id: number | null; label: string; address: string; pincode: string; is_default: boolean }
const blankAddr = (): AddrForm => ({ id: null, label: 'Home', address: '', pincode: '', is_default: false });

@Component({
  standalone: true,
  imports: [RouterLink],
  styles: [`
    .arow { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 12px; }
    .thumb { width: 56px; height: 56px; border-radius: 10px; object-fit: cover; background: #F2C7C7; flex: none; }
    .chk { display: flex; align-items: center; gap: 8px; }
    .chk input { width: auto; margin: 0; }
  `],
  template: `
  <section class="page">
    <h1 class="h1">{{ auth.user()?.name || 'My account' }}</h1>
    <p class="muted">{{ auth.user()?.email }}</p>
    <div class="chips">
      @for (t of tabs; track t.k) { <a class="chip" [class.on]="tab() === t.k" [routerLink]="['/profile', t.k]">{{ t.l }}</a> }
    </div>

    @switch (tab()) {
      @case ('addresses') {
        @for (a of addrs(); track a.id) {
          <div class="panel arow">
            <span class="grow"><b>{{ a.label }}</b>@if (a.is_default) { <span class="tag" style="margin-left:8px">Default</span> }<br>
              <span class="muted small">{{ a.address }}, {{ a.pincode }}</span></span>
            @if (!a.is_default) { <button class="btn ghost" (click)="makeDefault(a)">Make default</button> }
            <button class="btn ghost" (click)="editAddr(a)">Edit</button>
            <button class="btn ghost" (click)="delAddr(a)">Delete</button>
          </div>
        } @empty { <p class="muted">No saved addresses yet.</p> }
        <div class="panel" style="margin-top:20px">
          <h3>{{ af().id ? 'Edit address' : 'Add an address' }}</h3>
          <label style="margin-top:0">Label (Home, Work...) <input [value]="af().label" (input)="put(af, 'label', val($event))"></label>
          <label>Full address <textarea rows="3" [value]="af().address" (input)="put(af, 'address', val($event))"></textarea></label>
          <label>Pincode <input inputmode="numeric" maxlength="6" [value]="af().pincode" (input)="put(af, 'pincode', digits($event))"></label>
          <label class="chk"><input type="checkbox" [checked]="af().is_default" (change)="put(af, 'is_default', chk($event))"> Use as my default address</label>
          <div class="inline">
            <button class="btn" (click)="saveAddr()">{{ af().id ? 'Save changes' : 'Save address' }}</button>
            @if (af().id) { <button class="btn ghost" (click)="af.set(blankAddr())">Cancel</button> }
          </div>
        </div>
      }
      @case ('favourites') {
        @for (p of favItems(); track p.id) {
          <div class="panel arow">
            @if (p.image) { <img class="thumb" [src]="p.image" alt=""> } @else { <span class="thumb"></span> }
            <span class="grow"><b>{{ p.name }}</b><br><span class="muted small">{{ money(p.price_paise) }}</span></span>
            <button class="btn" [disabled]="!p.available" (click)="api.add(p.id)">{{ p.available ? 'Add to bag' : 'Sold out' }}</button>
            <button class="btn ghost" (click)="auth.toggleFav(p.id)">Remove</button>
          </div>
        } @empty { <p class="muted">Tap the heart on any cookie to save it here.</p> }
      }
      @case ('settings') {
        <div class="panel" style="max-width:520px">
          <h3>Your details</h3>
          <label style="margin-top:0">Email (this is your username) <input [value]="auth.user()?.email" disabled></label>
          <label>Full name <input [value]="sf().name" (input)="put(sf, 'name', val($event))"></label>
          <label>Mobile number <input inputmode="numeric" maxlength="10" [value]="sf().phone" (input)="put(sf, 'phone', digits($event))"></label>
          <button class="btn wide" (click)="saveProfile()">Save details</button>
        </div>
        <div class="panel" style="max-width:520px;margin-top:20px">
          <h3>Change password</h3>
          <label style="margin-top:0">Current password <input type="password" autocomplete="current-password" [value]="pf().current" (input)="put(pf, 'current', val($event))"></label>
          <label>New password <input type="password" autocomplete="new-password" placeholder="At least 8 characters" [value]="pf().next" (input)="put(pf, 'next', val($event))"></label>
          <button class="btn wide" (click)="changePw()">Change password</button>
        </div>
      }
      @default {
        @for (o of orders(); track o.id) {
          <a class="panel arow" [routerLink]="['/track', o.public_token]">
            <span class="grow"><b>#{{ o.id }}</b> {{ o.kind === 'custom' ? 'Custom cake' : 'Order' }}<br>
              <small class="muted">Delivery {{ dayLabel(o.delivery_date) }}</small></span>
            <span class="tag">{{ label[o.status] }}</span>
            <b>{{ o.total_paise ? money(o.total_paise) : '' }}</b>
          </a>
        } @empty { <p class="muted">{{ loaded() ? 'No orders yet.' : 'Loading...' }}</p> }
      }
    }
  </section>
  `,
})
export class ProfilePage {
  api = inject(ApiService);
  auth = inject(AuthService);
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);

  tab = toSignal(this.route.paramMap.pipe(map(p => p.get('tab') ?? 'orders')), { initialValue: 'orders' });
  tabs = [{ k: 'orders', l: 'My orders' }, { k: 'addresses', l: 'My addresses' }, { k: 'favourites', l: 'My favourites' }, { k: 'settings', l: 'Settings' }];
  label = STATUS_LABEL; money = money; dayLabel = dayLabel; blankAddr = blankAddr;
  orders = signal<Row[]>([]);
  loaded = signal(false);
  addrs = signal<Addr[]>([]);
  af = signal<AddrForm>(blankAddr());
  sf = signal({ name: '', phone: '' });
  pf = signal({ current: '', next: '' });
  favItems = computed(() => this.api.products().filter(p => this.auth.favs().has(p.id)));

  constructor() {
    effect(() => { const u = this.auth.user(); if (u) this.sf.set({ name: u.name, phone: u.phone }); });
    this.call(firstValueFrom(this.http.get<Row[]>('/api/my/orders'))).then(r => { if (r) this.orders.set(r); this.loaded.set(true); });
    this.loadAddrs();
  }

  private async call<T>(req: Promise<T>, ok = ''): Promise<T | null> {
    try { const r = await req; if (ok) this.api.say(ok); return r; }
    catch (e: any) { this.api.say(e.error?.error ?? 'Something went wrong'); return null; }
  }
  put<T, K extends keyof T>(s: WritableSignal<T>, k: K, v: T[K]) { s.update(x => ({ ...x, [k]: v })); }
  val(e: Event) { return (e.target as HTMLInputElement).value; }
  chk(e: Event) { return (e.target as HTMLInputElement).checked; }
  digits(e: Event) { const el = e.target as HTMLInputElement; el.value = el.value.replace(/\D/g, ''); return el.value; }

  async loadAddrs() { const r = await this.call(firstValueFrom(this.http.get<Addr[]>('/api/me/addresses'))); if (r) this.addrs.set(r); }
  editAddr(a: Addr) { this.af.set({ ...a }); window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); }
  async saveAddr() {
    const a = this.af();
    if (a.address.trim().length < 8) return this.api.say('Enter the full address');
    if (!/^\d{6}$/.test(a.pincode)) return this.api.say('Enter a valid 6-digit pincode');
    const body = { label: a.label.trim() || 'Home', address: a.address.trim(), pincode: a.pincode, is_default: a.is_default };
    const req = a.id ? this.http.put(`/api/me/addresses/${a.id}`, body) : this.http.post('/api/me/addresses', body);
    if (await this.call(firstValueFrom(req), 'Address saved')) { this.af.set(blankAddr()); this.loadAddrs(); }
  }
  async makeDefault(a: Addr) {
    if (await this.call(firstValueFrom(this.http.put(`/api/me/addresses/${a.id}`, { ...a, is_default: true })))) this.loadAddrs();
  }
  async delAddr(a: Addr) {
    if (confirm(`Delete "${a.label}"?`) && await this.call(firstValueFrom(this.http.delete(`/api/me/addresses/${a.id}`)), 'Deleted')) this.loadAddrs();
  }

  async saveProfile() {
    const u = await this.call(firstValueFrom(this.http.patch<User>('/api/me', this.sf())), 'Details saved');
    if (u) { this.auth.user.set(u); this.auth.prefill(u); }
  }
  async changePw() {
    if (this.pf().next.length < 8) return this.api.say('New password must be at least 8 characters');
    if (await this.call(firstValueFrom(this.http.post('/api/me/password', this.pf())), 'Password changed')) this.pf.set({ current: '', next: '' });
  }
}