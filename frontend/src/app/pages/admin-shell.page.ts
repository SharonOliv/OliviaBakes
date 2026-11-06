import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

@Component({
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  styles: [`
    .shell { display: grid; grid-template-columns: 240px 1fr; min-height: calc(100vh - 64px); }
    .side { position: sticky; top: 64px; align-self: start; height: calc(100vh - 64px); background: #FFF7F9; border-right: 1px solid #f1e3e6; padding: 22px 14px; display: flex; flex-direction: column; gap: 4px; }
    .side a { padding: 11px 14px; border-radius: 10px; font-weight: 500; color: var(--m); }
    .side a:hover { background: #FFE9EE; color: var(--t); }
    .side a.on { background: var(--a); color: #fff; }
    .main { min-width: 0; }
    @media (max-width: 800px) {
      .shell { grid-template-columns: 1fr; }
      .side { position: static; height: auto; flex-direction: row; overflow-x: auto; padding: 10px; border-right: 0; border-bottom: 1px solid #f1e3e6; }
      .side a { white-space: nowrap; }
    }
  `],
  template: `
  <div class="shell">
    <aside class="side">
      @for (l of links; track l.to) { <a [routerLink]="l.to" routerLinkActive="on">{{ l.t }}</a> }
    </aside>
    <div class="main"><router-outlet></router-outlet></div>
  </div>`,
})
export class AdminShell {
  links = [
    { to: '/admin/orders', t: 'Active orders' },
    { to: '/admin/custom', t: 'Custom cake requests' },
    { to: '/admin/capacity', t: 'Daily capacity' },
    { to: '/admin/items', t: 'Items' },
    { to: '/admin/offers', t: 'Offers' },
  ];
}