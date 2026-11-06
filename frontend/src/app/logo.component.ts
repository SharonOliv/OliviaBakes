import { Component, input } from '@angular/core';

@Component({
  selector: 'app-logo',
  standalone: true,
  styles: [`
    :host { display: inline-flex; align-items: center; gap: 10px; }
    .wm { font-weight: 800; letter-spacing: -.03em; font-size: 1.45rem; line-height: 1; }
    .wm span { font-weight: 500; }
  `],
  template: `
  <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 48 48" aria-hidden="true">
    <defs><mask id="olbite"><rect width="48" height="48" fill="#fff"/><circle cx="39" cy="9" r="8.5" fill="#000"/></mask></defs>
    <g mask="url(#olbite)">
      <circle cx="24" cy="24" r="21" fill="#E9B872"/>
      <circle cx="24" cy="24" r="21" fill="none" stroke="#C98E47" stroke-width="2.2"/>
      <circle cx="24" cy="24" r="16.5" fill="none" stroke="#F6D49B" stroke-width="1.2" stroke-dasharray="2 4"/>
    </g>
    <g fill="#5B2E21">
      <circle cx="15" cy="18" r="3.2"/><circle cx="26" cy="29" r="3.4"/><circle cx="16" cy="32" r="2.6"/>
      <circle cx="31" cy="20" r="2.4"/><circle cx="23" cy="14" r="2"/>
    </g>
  </svg>
  <span class="wm">Olivia<span>Bakes</span></span>`,
})
export class LogoComponent { size = input(36); }