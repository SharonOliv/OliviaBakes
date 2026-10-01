import { Directive, ElementRef, OnDestroy, OnInit, inject } from '@angular/core';

@Directive({ selector: '[reveal]', standalone: true })
export class RevealDirective implements OnInit, OnDestroy {
  private n = inject(ElementRef).nativeElement as HTMLElement;
  private io?: IntersectionObserver;
  ngOnInit() {
    this.n.classList.add('rv');
    this.io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { this.n.classList.add('in'); this.io?.disconnect(); }
    }, { threshold: 0.12 });
    this.io.observe(this.n);
  }
  ngOnDestroy() { this.io?.disconnect(); }
}

@Directive({
  selector: '[tilt]',
  standalone: true,
  host: { '(mousemove)': 'move($event)', '(mouseleave)': 'leave()' },
})
export class TiltDirective {
  private n = inject(ElementRef).nativeElement as HTMLElement;
  move(e: MouseEvent) {
    const b = this.n.getBoundingClientRect();
    const x = (e.clientX - b.left) / b.width - 0.5, y = (e.clientY - b.top) / b.height - 0.5;
    this.n.style.setProperty('--rx', `${-y * 12}deg`);
    this.n.style.setProperty('--ry', `${x * 14}deg`);
    this.n.style.setProperty('--px', `${x * -16}px`);
    this.n.style.setProperty('--py', `${y * -16}px`);
  }
  leave() { ['--rx', '--ry', '--px', '--py'].forEach(k => this.n.style.removeProperty(k)); }
}