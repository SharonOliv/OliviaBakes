import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ApiService, FREE_ABOVE, money } from './api.service';
import { AuthService } from './auth.service';
import { LogoComponent } from './logo.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, LogoComponent],
  styles: [`
    .topbar { position: sticky; top: 0; z-index: 30; background: #fff; border-bottom: 1px solid #f1e3e6; box-shadow: 0 2px 10px #0000000a; }
    .tin { max-width: 1200px; margin: 0 auto; height: 64px; padding: 0 5vw; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
    .tin.wide { max-width: none; }
    .brand { color: var(--a); }
    .tlinks { display: flex; align-items: center; gap: 20px; font-size: .92rem; color: var(--m); }
    .tlinks a.opt:hover, .tlinks a.on { color: var(--t); }
    .atag { background: var(--a); color: #fff; border-radius: 999px; padding: 4px 12px; font-size: .78rem; font-weight: 700; }
    .tbtn { border: 1px solid var(--line); background: #fff; color: var(--t); border-radius: 10px; padding: 8px 16px; font: 600 .88rem var(--body); cursor: pointer; }
    .tbtn:hover { background: #FFF1F4; }
    .acct { position: relative; }
    .who { display: flex; align-items: center; gap: 8px; padding: 6px 12px 6px 6px; }
    .av { width: 28px; height: 28px; border-radius: 50%; background: var(--a); color: #fff; display: grid; place-items: center; font-size: .82rem; }
    .wn { max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .shade { position: fixed; inset: 0; z-index: 40; }
    .drop { position: absolute; right: 0; top: calc(100% + 8px); min-width: 210px; background: #fff; border: 1px solid #f1e3e6; border-radius: 12px; box-shadow: 0 12px 32px #0000001f; padding: 8px; z-index: 50; display: flex; flex-direction: column; }
    .drop a, .drop button { padding: 10px 12px; border-radius: 8px; text-align: left; background: none; border: 0; font: 500 .92rem var(--body); color: var(--t); cursor: pointer; }
    .drop a:hover, .drop button:hover { background: #FFF1F4; }
    .bag { display: flex; align-items: center; gap: 8px; background: var(--a); color: #fff; border-radius: 10px; padding: 9px 18px; font-weight: 600; }
    .bag:hover { background: #9e2b4b; }
    .badge { background: #fff; color: var(--a); border-radius: 999px; min-width: 22px; height: 22px; padding: 0 6px; display: grid; place-items: center; font-size: .78rem; font-weight: 700; }
    .sitefoot { background: #3B1F27; color: #e9d6db; margin-top: 60px; }
    .fin { max-width: 1200px; margin: 0 auto; padding: 44px 5vw 28px; display: grid; grid-template-columns: 1.6fr 1fr 1fr; gap: 32px; }
    .fcol { display: flex; flex-direction: column; gap: 8px; font-size: .92rem; }
    .fcol h4 { color: #fff; font-size: .8rem; letter-spacing: .1em; text-transform: uppercase; margin-bottom: 4px; }
    .fcol a:hover { color: #fff; text-decoration: underline; }
    .fbrand { color: #FFB7C5; }
    .fbase { border-top: 1px solid #ffffff1f; padding: 16px 5vw; text-align: center; font-size: .82rem; color: #b99ba3; }
    @media (max-width: 720px) { .opt, .wn { display: none; } .tlinks { gap: 10px; } .who { padding: 6px; } .fin { grid-template-columns: 1fr; } }
  `],
  template: `
  @if (auth.isAdmin()) {
    <header class="topbar">
      <div class="tin wide">
        <a routerLink="/admin" class="brand"><app-logo [size]="30" /></a>
        <div class="tlinks">
          <span class="atag">Admin portal</span>
          <span class="opt">{{ auth.user()?.name }}</span>
          <button class="tbtn" (click)="auth.logout()">Log out</button>
        </div>
      </div>
    </header>
    <main><router-outlet></router-outlet></main>
  } @else {
    <header class="topbar">
      <div class="tin">
        <a routerLink="/" class="brand"><app-logo /></a>
        <div class="tlinks">
          <a routerLink="/custom" routerLinkActive="on" class="opt">Custom cake</a>
          @if (auth.loggedIn()) {
            <div class="acct">
              <button class="tbtn who" (click)="menu.set(!menu())" [attr.aria-expanded]="menu()">
                <span class="av">{{ initial() }}</span>
                <span class="wn">{{ auth.user()?.name || 'Account' }}</span>
              </button>
              @if (menu()) {
                <div class="shade" (click)="menu.set(false)"></div>
                <div class="drop" (click)="menu.set(false)">
                  <a routerLink="/profile/orders">My orders</a>
                  <a routerLink="/profile/addresses">My addresses</a>
                  <a routerLink="/profile/favourites">My favourites</a>
                  <a routerLink="/profile/settings">Settings</a>
                  <button (click)="auth.logout()">Log out</button>
                </div>
              }
            </div>
          } @else {
            <a routerLink="/login" class="tbtn">Log in</a>
          }
          <a routerLink="/cart" class="bag" aria-label="Open bag">
            Bag
            @if (api.count()) { <span class="badge">{{ api.count() }}</span> }
          </a>
        </div>
      </div>
    </header>

    <main><router-outlet></router-outlet></main>

    <footer class="sitefoot">
      <div class="fin">
        <div class="fcol">
          <a routerLink="/" class="fbrand"><app-logo [size]="34" /></a>
          <p>Warm cookies, made with butter, love and a little chocolate.</p>
        </div>
        <div class="fcol">
          <h4>Explore</h4>
          <a routerLink="/">Order cookies</a>
          <a routerLink="/custom">Custom cake</a>
          @if (auth.loggedIn()) { <a routerLink="/profile/orders">My orders</a> }
          @else { <a routerLink="/login">Log in</a> <a routerLink="/signup">Create an account</a> }
        </div>
        <div class="fcol">
          <h4>Delivery</h4>
          <p>Free delivery above {{ money(free) }}</p>
          <p>Order {{ api.leadHours() }} hours ahead</p>
          <p>Pay on delivery, cash or UPI</p>
        </div>
      </div>
      <div class="fbase">&copy; {{ year }} OliviaBakes. Fresh from a home kitchen, every single batch.</div>
    </footer>
  }

  @if (api.toast()) { <div class="toast">{{ api.toast() }}</div> }
  `,
})
export class AppComponent {
  api = inject(ApiService);
  auth = inject(AuthService);
  money = money;
  free = FREE_ABOVE;
  year = new Date().getFullYear();
  menu = signal(false);
  initial = computed(() => (this.auth.user()?.name || '?').trim().charAt(0).toUpperCase());
}