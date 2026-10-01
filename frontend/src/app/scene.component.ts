import { AfterViewInit, Component, ElementRef, NgZone, OnDestroy, ViewChild, effect, inject } from '@angular/core';
import * as THREE from 'three';
import { ApiService } from './api.service';

@Component({
  selector: 'app-scene',
  standalone: true,
  template: '<canvas #cv></canvas>',
  styles: [`:host{position:fixed;inset:0;z-index:0;pointer-events:none;display:block}canvas{width:100%;height:100%;display:block}`],
})
export class SceneComponent implements AfterViewInit, OnDestroy {
  @ViewChild('cv', { static: true }) cv!: ElementRef<HTMLCanvasElement>;
  private zone = inject(NgZone);
  private api = inject(ApiService);
  private stop = () => {};
  private pop: (() => void) | null = null;

  constructor() { effect(() => { if (this.api.burst() > 0) this.pop?.(); }); }
  ngAfterViewInit() { this.zone.runOutsideAngular(() => this.init()); }
  ngOnDestroy() { this.stop(); }

  private init() {
    const R = new THREE.WebGLRenderer({ canvas: this.cv.nativeElement, alpha: true, antialias: true });
    R.setPixelRatio(Math.min(devicePixelRatio, 2));
    const S = new THREE.Scene(), C = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    C.position.z = 11;

    const IMGS = ['/images/chocolate-chunk.jpg', '/images/double-chocolate.jpg', '/images/strawberry-cream.jpg'];

    // A real photo cropped into a round "coin" with a white rim and a thin cream edge
    const disc = (url: string) => {
      const size = 512, cv = document.createElement('canvas');
      cv.width = cv.height = size;
      const ctx = cv.getContext('2d')!;
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
      const paint = (img?: HTMLImageElement) => {
        ctx.clearRect(0, 0, size, size);
        ctx.save(); ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2 - 14, 0, Math.PI * 2); ctx.clip();
        if (img) {
          const s = Math.max(size / img.width, size / img.height), w = img.width * s, h = img.height * s;
          ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        } else {
          const g = ctx.createRadialGradient(200, 180, 20, 256, 256, 260);
          g.addColorStop(0, '#e3b27a'); g.addColorStop(1, '#8f5426');
          ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
        }
        ctx.restore();
        ctx.lineWidth = 14; ctx.strokeStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2 - 7, 0, Math.PI * 2); ctx.stroke();
        tex.needsUpdate = true;
      };
      paint();
      const im = new Image(); im.onload = () => paint(im); im.src = url;
      const g = new THREE.Group();
      const face = new THREE.Mesh(new THREE.CircleGeometry(1.5, 64), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide }));
      const edge = new THREE.Mesh(new THREE.CircleGeometry(1.5, 64), new THREE.MeshBasicMaterial({ color: 0xe8dccb, side: THREE.DoubleSide }));
      edge.position.z = -0.05;
      g.add(edge, face); S.add(g);
      return g;
    };

    const mains = IMGS.map(u => disc(u));
    const sats = [0, 1, 2, 3, 4].map(i => ({
      m: disc(IMGS[(i + 1) % 3]), cur: 0,
      x: [-4.9, 5.3, -3.4, 4.0, 0.6][i], y: [2.4, -2.5, -2.8, 2.9, -3.5][i], z: [-1.5, -2, 0.5, -3, -1][i],
      sc: [0.5, 0.42, 0.34, 0.4, 0.36][i], k: [1.3, 1.9, 1.0, 1.6, 0.9][i],
    }));

    // Crumbs
    const N = 360, pp = new Float32Array(N * 3), pv = new Float32Array(N * 3);
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    for (let i = 0; i < N; i++) { pp[i * 3] = rnd(-9, 9); pp[i * 3 + 1] = rnd(-6, 6); pp[i * 3 + 2] = rnd(-6, 3); }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pp, 3));
    S.add(new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xc9904f, size: 0.06, transparent: true, opacity: 0.7, depthWrite: false })));
    this.pop = () => {
      for (let i = 0; i < N; i++) {
        const a = Math.random() * 6.28, sp = 2 + Math.random() * 5;
        pv[i * 3] = Math.cos(a) * sp; pv[i * 3 + 1] = 1 + Math.random() * 4; pv[i * 3 + 2] = Math.sin(a) * sp * 0.4;
      }
    };

    // Scroll choreography for the big coin: [x, y, scale]
    const KF = [[2.8, 0, 1.5], [-2.8, 0.1, 1.35], [2.7, -0.1, 1.55], [-2.5, -0.2, 1.5]];
    const lerpKF = (p: number) => {
      const i = Math.min(2, Math.floor(p * 3)), t = p * 3 - i, e = t * t * (3 - 2 * t);
      return KF[i].map((v, k) => v + (KF[i + 1][k] - v) * e);
    };

    let mx = 0, my = 0, prog = 0, sy = scrollY, vel = 0, spin = 0, t = 0, cur = KF[0].slice();
    const onMove = (e: MouseEvent) => { mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5; };
    const onResize = () => { R.setSize(innerWidth, innerHeight, false); C.aspect = innerWidth / innerHeight; C.updateProjectionMatrix(); };
    addEventListener('mousemove', onMove); addEventListener('resize', onResize); onResize();

    const clock = new THREE.Clock(); let raf = 0;
    const loop = () => {
      const dt = Math.min(clock.getDelta(), 0.05); t += dt;
      const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
      prog += (Math.min(1, scrollY / max) - prog) * 0.08;
      vel += (Math.abs(scrollY - sy) - vel) * 0.1; sy = scrollY;
      spin += Math.min(vel, 60) * 0.004;

      const home = location.pathname === '/';
      const pg2 = home ? prog : 0, p2 = pg2 * 2;
      const tgt = home ? lerpKF(pg2) : [3.9, 1.9, 0.5];
      cur = cur.map((v, i) => v + (tgt[i] - v) * 0.06);
      const wide = Math.min(1, C.aspect / 1.5), k = 0.55 + 0.45 * wide;

      mains.forEach((m, i) => {
        const f = home ? Math.max(0, 1 - Math.abs(p2 - i) * 1.1) : (i === 0 ? 1 : 0);
        const e = f * f * (3 - 2 * f);
        m.visible = e > 0.01;
        m.position.set(cur[0] * wide, cur[1] + Math.sin(t * 0.9 + i) * 0.12, 0);
        m.scale.setScalar(Math.max(0.001, cur[2] * e * k));
        m.rotation.set(-my * 0.35 + Math.sin(t * 0.6 + i) * 0.07, (p2 - i) * 1.1 + mx * 0.5 + Math.sin(t * 0.5 + i) * 0.14 + spin, Math.sin(t * 0.4 + i) * 0.05);
      });

      sats.forEach((s, i) => {
        s.cur += ((home ? s.sc : 0) - s.cur) * 0.05;
        s.m.visible = s.cur > 0.01;
        s.m.position.set(s.x * wide, s.y + Math.sin(pg2 * 5 + i * 1.7) * s.k + Math.sin(t * 0.8 + i) * 0.15, s.z);
        s.m.scale.setScalar(Math.max(0.001, s.cur * k));
        s.m.rotation.set(Math.sin(t * 0.5 + i) * 0.3 - my * 0.3, t * (0.25 + i * 0.07) + i + spin, Math.sin(t * 0.3 + i) * 0.2);
      });

      for (let i = 0; i < N; i++) {
        const j = i * 3;
        pp[j] += pv[j] * dt; pp[j + 1] += pv[j + 1] * dt - dt * 0.12; pp[j + 2] += pv[j + 2] * dt;
        pv[j] *= 0.96; pv[j + 1] *= 0.96; pv[j + 2] *= 0.96;
        if (pp[j + 1] < -6) pp[j + 1] = 6;
        if (Math.abs(pp[j]) > 9) pp[j] *= -0.95;
      }
      pg.attributes['position'].needsUpdate = true;

      C.position.x += (mx * 1.2 - C.position.x) * 0.04;
      C.position.y += (-my * 0.8 - C.position.y) * 0.04;
      C.lookAt(0, 0, 0);
      R.render(S, C);
      raf = requestAnimationFrame(loop);
    };
    loop();

    this.stop = () => { cancelAnimationFrame(raf); removeEventListener('mousemove', onMove); removeEventListener('resize', onResize); R.dispose(); };
  }
}