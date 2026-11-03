import { Component, computed, inject, input, output } from '@angular/core';
import { ApiService, dayParts } from './api.service';

// Delivery day and time slot picker (day chips, then slot buttons), shared by checkout and custom cake.
@Component({
  selector: 'app-when',
  standalone: true,
  template: `
  <div class="days">
    @for (d of days(); track d.day) {
      <button type="button" class="day" [class.on]="day() === d.day" [disabled]="d.remaining === 0" (click)="pickDay(d.day)">
        <small>{{ parts(d.day).wd }}</small><b>{{ parts(d.day).d }}</b><small>{{ d.remaining === 0 ? 'Full' : parts(d.day).m }}</small>
      </button>
    } @empty { <p class="muted small">Loading available days...</p> }
  </div>
  @if (day()) {
    <div class="seg" style="margin-top:12px">
      @for (s of slots(); track s) {
        <button type="button" [class.on]="slot() === s" (click)="pick.emit({ day: day(), slot: s })">{{ labels()[s] }}</button>
      }
    </div>
  }
  <p class="muted small">{{ mode() === 'custom' ? 'Custom cakes' : 'Everything' }} needs {{ lead() }} hours' notice. Days marked Full can't take more orders.</p>
  `,
})
export class WhenComponent {
  private api = inject(ApiService);
  mode = input<'standard' | 'custom'>('standard');
  day = input('');
  slot = input('');
  pick = output<{ day: string; slot: string }>();
  parts = dayParts;

  private slotsOf = (d: { slots: string[]; custom_slots: string[] }) => (this.mode() === 'custom' ? d.custom_slots : d.slots);
  days = computed(() => (this.api.avail()?.days ?? []).filter(d => this.slotsOf(d).length > 0));
  slots = computed(() => { const d = this.api.avail()?.days.find(x => x.day === this.day()); return d ? this.slotsOf(d) : []; });
  labels = computed(() => this.api.avail()?.slot_labels ?? {});
  lead = computed(() => (this.mode() === 'custom' ? this.api.avail()?.custom_lead_hours : this.api.avail()?.lead_hours) ?? (this.mode() === 'custom' ? 72 : 24));
  pickDay(day: string) { this.pick.emit({ day, slot: '' }); }
}