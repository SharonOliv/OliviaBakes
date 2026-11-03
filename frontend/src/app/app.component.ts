import { Component, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ApiService } from './api.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
  <nav>
    <a routerLink="/" class="logo">OliviaBakes</a>
    <div class="loc">
      <button class="locbtn" [class.unset]="!api.pin()" (click)="toggle()" [attr.aria-expanded]="open()">
        <span class="locdot"></span>
        @if (api.pin()) { <span>Deliver to <b>{{ api.pin() }}</b></span> } @else { <span>Set delivery pincode</span> }
      </button>
      @if (open()) {
        <div class="locpop">
          <label style="margin-top:0">Delivery pincode
            <input inputmode="numeric" maxlength="6" placeholder="520010" [value]="draft()" (input)="onPin($any($event.target).value)" (keyup.enter)="open.set(false)">
          </label>
          @if (draft().length === 6 && api.pin() === draft()) {
            @if (api.area(); as a) {
              @if (a.ok) { <p class="hint ok">We deliver to {{ a.area_name }}.</p> } @else { <p class="hint bad">We don't deliver here yet.</p> }
            } @else { <p class="hint">Checking...</p> }
          }
          <button class="btn wide" (click)="open.set(false)">Done</button>
        </div>
      }
    </div>
    <div class="links">
      <a routerLink="/menu" routerLinkActive="on">Menu</a>
      <a routerLink="/custom" routerLinkActive="on">Custom cake</a>
      @if (api.myOrder(); as token) { <a [routerLink]="['/track', token]" routerLinkActive="on">My order</a> }
      <a routerLink="/cart" class="pill">Bag ({{ api.count() }})</a>
    </div>
  </nav>
  <main><router-outlet></router-outlet></main>
  <footer class="foot">
    <a routerLink="/" class="logo">OliviaBakes</a>
    <span>Baked to order in a home kitchen.</span>
    <div class="flinks">
      <a routerLink="/menu" class="under">Menu</a>
      <a routerLink="/custom" class="under">Custom cake</a>
    </div>
  </footer>
  @if (api.toast()) { <div class="toast">{{ api.toast() }}</div> }
  `,
})
export class AppComponent {
  api = inject(ApiService);
  open = signal(false);
  draft = signal('');
  toggle() { this.draft.set(this.api.pin()); this.open.update(o => !o); }
  onPin(v: string) {
    const pin = v.replace(/\D/g, '').slice(0, 6);
    this.draft.set(pin);
    if (pin.length === 6) this.api.setPin(pin);
  }
}