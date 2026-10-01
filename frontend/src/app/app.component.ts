import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ApiService } from './api.service';
import { SceneComponent } from './scene.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, SceneComponent],
  template: `
  <app-scene></app-scene>
  <nav>
    <a routerLink="/" class="logo">OliveBakes</a>
    <div class="links">
      <a routerLink="/menu" routerLinkActive="on">Menu</a>
      <a routerLink="/board" routerLinkActive="on">Live queue</a>
      <a routerLink="/kitchen" routerLinkActive="on">Kitchen</a>
      @if (api.myOrder(); as id) { <a [routerLink]="['/track', id]" routerLinkActive="on">My order</a> }
      <a routerLink="/cart" class="pill">Bag ({{ api.count() }})</a>
    </div>
  </nav>
  <main><router-outlet></router-outlet></main>
  @if (api.toast()) { <div class="toast">{{ api.toast() }}</div> }
  `,
})
export class AppComponent { api = inject(ApiService); }