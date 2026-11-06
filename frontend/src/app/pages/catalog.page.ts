import { Component, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService, money } from '../api.service';

interface Item { id: number; name: string; category: string; image: string | null; price_paise: number; units: number; stock: number | null; available: boolean;
                 ingredients: string | null; allergens: string | null; weight_g: number | null; cost_paise: number | null }
interface Offer { id: number; title: string; subtitle: string; active: boolean }
interface ItemForm { id: number | null; name: string; category: string; price: string; cost: string; weight: string; ingredients: string; allergens: string;
                     stock: string; available: boolean; image: string | null }
interface OfferForm { id: number | null; title: string; subtitle: string; active: boolean }
interface Sig { cloud_name: string; api_key: string; timestamp: number; folder: string; signature: string }

const blankItem = (): ItemForm => ({ id: null, name: '', category: 'cookie', price: '', cost: '', weight: '', ingredients: '', allergens: '', stock: '', available: true, image: null });
const blankOffer = (): OfferForm => ({ id: null, title: '', subtitle: '', active: true });

@Component({
  standalone: true,
  styles: [`
    .chk { display: flex; align-items: center; gap: 8px; }
    .chk input { width: auto; margin: 0; }
    .cform { display: grid; grid-template-columns: 180px 1fr; gap: 24px; }
    .pic { width: 180px; height: 180px; border-radius: 14px; background: #F2C7C7; overflow: hidden; display: grid; place-items: center; color: var(--m); font-size: .85rem; }
    .pic img { width: 100%; height: 100%; object-fit: cover; }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .irow { align-items: center; gap: 10px; flex-wrap: wrap; }
    .thumb { width: 56px; height: 56px; border-radius: 10px; object-fit: cover; background: #F2C7C7; flex: none; }
    .stk { display: flex; gap: 6px; align-items: center; }
    .stk input { width: 100px; padding: 8px 10px; }
    @media (max-width: 700px) { .cform, .two { grid-template-columns: 1fr; } }
  `],
  template: `
  <section class="page">
    <h1 class="h1">{{ view === 'offers' ? 'Offers' : 'Items' }}</h1>

    @if (view === 'items') {
      <div class="panel" style="margin-top:20px">
        <h3>{{ f().id ? 'Edit item' : 'Add an item' }}</h3>
        <div class="cform">
          <div class="pic">
            @if (f().image) { <img [src]="f().image" alt="Preview"> } @else { <span>No photo yet</span> }
          </div>
          <div>
            <label style="margin-top:0">Photo (uploads to Cloudinary)
              <input type="file" accept="image/*" (change)="pick($event)">
            </label>
            @if (busy()) { <p class="muted small">Uploading...</p> }
            <label>Name <input [value]="f().name" (input)="set('name', val($event))"></label>
            <div class="two">
              <label>Category <input [value]="f().category" (input)="set('category', val($event))" placeholder="cookie"></label>
              <label>Weight of one piece (grams) <input type="number" min="1" [value]="f().weight" (input)="set('weight', val($event))"></label>
              <label>Selling price (₹) <input type="number" min="1" [value]="f().price" (input)="set('price', val($event))"></label>
              <label>Cost to make (₹, only you see this) <input type="number" min="0" [value]="f().cost" (input)="set('cost', val($event))"></label>
            </div>
            <label>Ingredients <textarea rows="3" [value]="f().ingredients" (input)="set('ingredients', val($event))" placeholder="Wheat flour, butter, sugar, eggs..."></textarea></label>
            <label>Allergens (separate with commas) <input [value]="f().allergens" (input)="set('allergens', val($event))" placeholder="Gluten (wheat), milk, eggs"></label>
            <label>Stock quantity (leave blank to not track it) <input type="number" min="0" [value]="f().stock" (input)="set('stock', val($event))"></label>
            <label class="chk"><input type="checkbox" [checked]="f().available" (change)="set('available', chk($event))"> Available to order</label>
            <div class="inline">
              <button class="btn" [disabled]="busy()" (click)="save()">{{ f().id ? 'Save changes' : 'Add item' }}</button>
              @if (f().id) { <button class="btn ghost" (click)="f.set(blankItem())">Cancel</button> }
            </div>
          </div>
        </div>
      </div>

      <div class="panel" style="margin-top:20px">
        <h3>All items ({{ items().length }})</h3>
        @for (p of items(); track p.id) {
          <div class="srow irow">
            @if (p.image) { <img class="thumb" [src]="p.image" alt=""> } @else { <span class="thumb"></span> }
            <span class="grow"><b>{{ p.name }}</b><br>
              <small class="muted cap">{{ p.category }} | {{ money(p.price_paise) }}@if (p.weight_g) { | {{ p.weight_g }} g }@if (p.cost_paise !== null) { | margin {{ money(p.price_paise - p.cost_paise) }} } | {{ p.stock === null ? 'stock not tracked' : p.stock + ' in stock' }}</small></span>
            <span class="stk">
              <input #st type="number" min="0" [value]="p.stock ?? ''" placeholder="No limit" aria-label="Stock quantity">
              <button class="btn ghost" (click)="setStock(p, st.value)">Set stock</button>
            </span>
            <button class="btn ghost" (click)="toggle(p)">{{ p.available ? 'Available' : 'Turned off' }}</button>
            <button class="btn ghost" (click)="edit(p)">Edit</button>
            <button class="btn ghost" (click)="remove(p)">Delete</button>
          </div>
        } @empty { <p class="muted">No items yet. Add your first one above.</p> }
      </div>
    } @else {
      <div class="panel" style="margin-top:20px">
        <h3>Offer banners (shown on the home page)</h3>
        @for (x of offers(); track x.id) {
          <div class="srow irow">
            <span class="grow"><b>{{ x.title }}</b><br><small class="muted">{{ x.subtitle }}</small></span>
            <button class="btn ghost" (click)="toggleOffer(x)">{{ x.active ? 'Showing' : 'Hidden' }}</button>
            <button class="btn ghost" (click)="o.set({ id: x.id, title: x.title, subtitle: x.subtitle, active: x.active })">Edit</button>
            <button class="btn ghost" (click)="removeOffer(x)">Delete</button>
          </div>
        } @empty { <p class="muted">No offers yet.</p> }
        <label>Title <input [value]="o().title" (input)="setO('title', val($event))" placeholder="Free delivery"></label>
        <label>Details <input [value]="o().subtitle" (input)="setO('subtitle', val($event))" placeholder="On orders above Rs 499"></label>
        <div class="inline">
          <button class="btn" (click)="saveOffer()">{{ o().id ? 'Save offer' : 'Add offer' }}</button>
          @if (o().id) { <button class="btn ghost" (click)="o.set(blankOffer())">Cancel</button> }
        </div>
      </div>
    }
  </section>
  `,
})
export class CatalogPage {
  api = inject(ApiService);
  private http = inject(HttpClient);
  view = inject(ActivatedRoute).snapshot.data['view'] as 'items' | 'offers';
  money = money;
  blankItem = blankItem;
  blankOffer = blankOffer;
  items = signal<Item[]>([]);
  offers = signal<Offer[]>([]);
  f = signal<ItemForm>(blankItem());
  o = signal<OfferForm>(blankOffer());
  busy = signal(false);

  constructor() { this.load(); }

  private async call<T>(req: Promise<T>, ok = ''): Promise<T | null> {
    try { const r = await req; if (ok) this.api.say(ok); return r; }
    catch (e: any) { this.api.say(e.error?.error ?? (e instanceof Error ? e.message : 'Something went wrong')); return null; }
  }

  async load() {
    const [i, x] = await Promise.all([
      this.call(firstValueFrom(this.http.get<Item[]>('/api/admin/products'))),
      this.call(firstValueFrom(this.http.get<Offer[]>('/api/admin/offers'))),
    ]);
    if (i) this.items.set(i);
    if (x) this.offers.set(x);
    this.api.loadProducts().catch(() => {});
  }

  val(e: Event) { return (e.target as HTMLInputElement).value; }
  chk(e: Event) { return (e.target as HTMLInputElement).checked; }
  set<K extends keyof ItemForm>(k: K, v: ItemForm[K]) { this.f.update(x => ({ ...x, [k]: v })); }
  setO<K extends keyof OfferForm>(k: K, v: OfferForm[K]) { this.o.update(x => ({ ...x, [k]: v })); }

  // ---- items ----
  async shrink(file: File): Promise<Blob> {
    const bmp = await createImageBitmap(file);
    const s = Math.min(1, 1000 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    return new Promise((ok, no) => c.toBlob(b => b ? ok(b) : no(new Error('Could not read that image')), 'image/jpeg', 0.85));
  }
  async pick(e: Event) {
    const input = e.target as HTMLInputElement, file = input.files?.[0];
    if (!file) return;
    this.busy.set(true);
    const url = await this.call((async () => {
      const s = await firstValueFrom(this.http.post<Sig>('/api/admin/upload-signature', {}));
      const fd = new FormData();
      fd.append('file', await this.shrink(file), 'photo.jpg');
      fd.append('api_key', s.api_key); fd.append('timestamp', String(s.timestamp));
      fd.append('folder', s.folder); fd.append('signature', s.signature);
      const up = await fetch(`https://api.cloudinary.com/v1_1/${s.cloud_name}/image/upload`, { method: 'POST', body: fd });
      const j = await up.json();
      if (!up.ok) throw new Error(j.error?.message ?? 'Upload failed');
      return j.secure_url as string;
    })());
    this.busy.set(false);
    if (url) this.set('image', url);
    input.value = '';
  }
  edit(p: Item) {
    this.f.set({ id: p.id, name: p.name, category: p.category, price: String(p.price_paise / 100),
                 cost: p.cost_paise === null ? '' : String(p.cost_paise / 100), weight: p.weight_g === null ? '' : String(p.weight_g),
                 ingredients: p.ingredients ?? '', allergens: p.allergens ?? '',
                 stock: p.stock === null ? '' : String(p.stock), available: p.available, image: p.image });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async save() {
    const f = this.f(), price_paise = Math.round(Number(f.price) * 100);
    const num = (s: string) => s.trim() === '' ? null : Number(s);
    const stock = num(f.stock), weight_g = num(f.weight), cost = num(f.cost);
    if (f.name.trim().length < 2) return this.api.say('Enter an item name');
    if (!(price_paise > 0)) return this.api.say('Enter a valid price');
    if (stock !== null && (!Number.isInteger(stock) || stock < 0)) return this.api.say('Stock must be a whole number');
    if (weight_g !== null && (!Number.isInteger(weight_g) || weight_g < 1)) return this.api.say('Weight must be a whole number of grams');
    if (cost !== null && !(cost >= 0)) return this.api.say('Enter a valid cost');
    const body = {
      name: f.name.trim(), category: f.category.trim() || 'cookie', price_paise, stock, weight_g,
      cost_paise: cost === null ? null : Math.round(cost * 100),
      ingredients: f.ingredients.trim() || null, allergens: f.allergens.trim() || null,
      available: f.available, image: f.image,
    };
    const req = f.id ? this.http.patch(`/api/admin/products/${f.id}`, body) : this.http.post('/api/admin/products', body);
    if (await this.call(firstValueFrom(req), f.id ? 'Saved' : 'Item added')) { this.f.set(blankItem()); this.load(); }
  }
  async setStock(p: Item, v: string) {
    const stock = v.trim() === '' ? null : Number(v);
    if (stock !== null && (!Number.isInteger(stock) || stock < 0)) return this.api.say('Stock must be a whole number');
    if (await this.call(firstValueFrom(this.http.patch(`/api/admin/products/${p.id}`, { stock })), 'Stock updated')) this.load();
  }
  async toggle(p: Item) {
    if (await this.call(firstValueFrom(this.http.patch(`/api/admin/products/${p.id}`, { available: !p.available })))) this.load();
  }
  async remove(p: Item) {
    if (confirm(`Delete "${p.name}"?`) && await this.call(firstValueFrom(this.http.delete(`/api/admin/products/${p.id}`)), 'Deleted')) this.load();
  }

  // ---- offers ----
  async saveOffer() {
    const x = this.o();
    if (!x.title.trim()) return this.api.say('Enter an offer title');
    const body = { title: x.title.trim(), subtitle: x.subtitle.trim(), active: x.active };
    const req = x.id ? this.http.put(`/api/admin/offers/${x.id}`, body) : this.http.post('/api/admin/offers', body);
    if (await this.call(firstValueFrom(req), 'Saved')) { this.o.set(blankOffer()); this.load(); }
  }
  async toggleOffer(x: Offer) {
    if (await this.call(firstValueFrom(this.http.put(`/api/admin/offers/${x.id}`, { title: x.title, subtitle: x.subtitle, active: !x.active })))) this.load();
  }
  async removeOffer(x: Offer) {
    if (confirm(`Delete "${x.title}"?`) && await this.call(firstValueFrom(this.http.delete(`/api/admin/offers/${x.id}`)), 'Deleted')) this.load();
  }
}