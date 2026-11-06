import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient, HttpInterceptorFn } from '@angular/common/http';
import { CanActivateFn, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';

export interface User { id: number; name: string; phone: string; email: string; role: 'customer' | 'admin' }
interface AuthResponse { token: string; user: User }

const TOKEN_KEY = 'oliviabakes_token';
// Development: the page is on :4200 and talks to the backend on :3000 directly. Production: one server, same address.
const API = location.hostname === 'localhost' ? 'http://localhost:3000' : 'https://oliviabakes-api.onrender.com';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);
  private api = inject(ApiService);

  token = signal<string | null>(this.readToken());
  user = signal<User | null>(null);
  favs = signal<Set<number>>(new Set());
  loggedIn = computed(() => !!this.token());
  isAdmin = computed(() => this.user()?.role === 'admin');
  firstName = computed(() => this.user()?.name.split(' ')[0] ?? '');
  ready: Promise<void> = this.token() ? this.restore() : Promise.resolve();

  private readToken() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } }

  // Both return an error message, or null on success
  async signup(f: { name: string; phone: string; email: string; password: string }): Promise<string | null> {
    try { this.start(await firstValueFrom(this.http.post<AuthResponse>('/api/auth/signup', f))); return null; }
    catch (e: any) { return e.error?.error ?? 'Could not create your account'; }
  }
  async login(email: string, password: string): Promise<string | null> {
    try { this.start(await firstValueFrom(this.http.post<AuthResponse>('/api/auth/login', { email, password }))); return null; }
    catch (e: any) { return e.error?.error ?? 'Could not log in'; }
  }

  logout(goHome = true) {
    this.token.set(null); this.user.set(null); this.favs.set(new Set());
    this.api.myOrder.set(null);
    this.api.profile.set({ customer: '', phone: '', email: '', address: '' });
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem('oliviabakes_order');
      localStorage.removeItem('oliviabakes_profile');
    } catch {}
    if (goHome) this.router.navigate(['/']);
  }

  private start(r: AuthResponse) {
    this.token.set(r.token);
    try { localStorage.setItem(TOKEN_KEY, r.token); } catch {}
    this.user.set(r.user);
    this.prefill(r.user);
    this.loadFavs();
  }

  // after a page reload: refresh the user; drop the token if the server rejects it
  private async restore() {
    try {
      const u = await firstValueFrom(this.http.get<User>('/api/auth/me'));
      this.user.set(u); this.prefill(u); this.loadFavs();
    } catch (e: any) { if (e.status === 401 || e.status === 403) this.logout(false); }
  }

  prefill(u: User) {
    this.api.profile.update(p => ({ ...p, customer: u.name, phone: u.phone, email: u.email }));
  }

  // ---- favourites ----
  async loadFavs() {
    try { this.favs.set(new Set(await firstValueFrom(this.http.get<number[]>('/api/me/favourites')))); } catch {}
  }
  async toggleFav(id: number) {
    if (!this.loggedIn()) { this.router.navigate(['/login'], { queryParams: { next: '/' } }); return; }
    const on = this.favs().has(id);
    this.favs.update(s => { const n = new Set(s); if (on) n.delete(id); else n.add(id); return n; });   // instant
    try { await firstValueFrom(on ? this.http.delete(`/api/me/favourites/${id}`) : this.http.put(`/api/me/favourites/${id}`, {})); }
    catch { this.loadFavs(); }
  }
}

// Sends /api requests to the backend and adds the login token
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.url.startsWith('/api/')) {
    let token: string | null = null;
    try { token = localStorage.getItem(TOKEN_KEY); } catch {}
    req = req.clone({ url: API + req.url, setHeaders: token ? { Authorization: 'Bearer ' + token } : {} });
  }
  return next(req);
};

// Sends logged-out visitors to /login, then back to the page they wanted
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  return auth.loggedIn() || inject(Router).createUrlTree(['/login'], { queryParams: { next: state.url } });
};

// Admin pages: admins only
export const adminGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService), router = inject(Router);   // inject() must run before the await
  await auth.ready;
  if (auth.isAdmin()) return true;
  return auth.loggedIn() ? router.createUrlTree(['/']) : router.createUrlTree(['/login'], { queryParams: { next: state.url } });
};

// Admins have no bag, checkout, addresses or storefront: send them to the admin portal
export const customerGuard: CanActivateFn = async () => {
  const auth = inject(AuthService), router = inject(Router);
  await auth.ready;
  return auth.isAdmin() ? router.createUrlTree(['/admin']) : true;
};