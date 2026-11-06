import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../auth.service';

@Component({
  standalone: true,
  imports: [RouterLink],
  styles: [`
    .auth { display: grid; place-items: center; padding: 48px 16px; }
    .auth-card { width: 100%; max-width: 420px; background: #fff; border: 1px solid #F2C7C7; border-radius: 24px; padding: 32px; box-shadow: 0 10px 30px rgba(255,183,197,.25); }
    .auth-card h1 { font-size: 1.8rem; margin: 0 0 4px; }
    .auth-card label { display: block; margin-top: 14px; font-weight: 500; }
    .auth-card input { display: block; width: 100%; margin-top: 6px; padding: 12px 14px; border: 1px solid #F2C7C7; border-radius: 12px; font: inherit; box-sizing: border-box; }
    .auth-card input:focus { outline: 2px solid #FFB7C5; }
    .auth-card .btn { margin-top: 20px; }
    .switch { margin-top: 18px; text-align: center; }
  `],
  template: `
  <section class="auth">
    <div class="auth-card">
      <h1>{{ signup ? 'Create your account' : 'Welcome back' }}</h1>
      <p class="muted">{{ signup ? 'Save your details and track your orders.' : 'Log in to order and track your bakes.' }}</p>

      <form (submit)="submit($event)" novalidate>
        @if (signup) {
          <label>Full name
            <input autocomplete="name" [value]="name()" (input)="name.set(val($event))">
          </label>
          <label>Mobile number
            <input inputmode="numeric" maxlength="10" autocomplete="tel" placeholder="10-digit number"
                   [value]="phone()" (input)="phone.set(digits($event))">
          </label>
        }
        <label>Email
          <input type="email" autocomplete="email" [value]="email()" (input)="email.set(val($event))">
        </label>
        <label>Password
          <input type="password" [attr.autocomplete]="signup ? 'new-password' : 'current-password'"
                 [placeholder]="signup ? 'At least 8 characters' : ''"
                 [value]="password()" (input)="password.set(val($event))">
        </label>
                @if (!signup) { <p class="small" style="margin-top:10px"><a routerLink="/forgot-password" class="under">Forgot password?</a></p> }

        @if (error()) { <p class="hint bad">{{ error() }}</p> }

        <button class="btn wide" type="submit" [disabled]="busy()">
          {{ busy() ? 'Please wait...' : (signup ? 'Create account' : 'Log in') }}
        </button>
      </form>

      <p class="switch">
        @if (signup) { Already have an account? <a routerLink="/login" queryParamsHandling="preserve" class="under">Log in</a> }
        @else { New here? <a routerLink="/signup" queryParamsHandling="preserve" class="under">Create an account</a> }
      </p>
    </div>
  </section>
  `,
})
export class AuthPage {
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  signup = this.route.snapshot.data['mode'] === 'signup';
  name = signal(''); phone = signal(''); email = signal(''); password = signal('');
  error = signal(''); busy = signal(false);

    val(e: Event) { return (e.target as HTMLInputElement).value; }

  // keeps only digits, and also cleans what is shown in the box
  digits(e: Event) {
    const el = e.target as HTMLInputElement;
    el.value = el.value.replace(/\D/g, '');
    return el.value;
  }

  async submit(e: Event) {
    e.preventDefault();
    this.error.set('');
    const email = this.email().trim();
    if (this.signup) {
      if (this.name().trim().length < 2) return this.error.set('Please enter your name');
      if (!/^[6-9]\d{9}$/.test(this.phone())) return this.error.set('Enter a valid 10-digit mobile number');
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) return this.error.set('Enter a valid email address');
    if (this.signup && this.password().length < 8) return this.error.set('Password must be at least 8 characters');
    if (!this.password()) return this.error.set('Enter your password');

    this.busy.set(true);
    const err = this.signup
      ? await this.auth.signup({ name: this.name().trim(), phone: this.phone(), email, password: this.password() })
      : await this.auth.login(email, this.password());
    this.busy.set(false);
    if (err) return this.error.set(err);

    const next = this.route.snapshot.queryParamMap.get('next');
        this.router.navigateByUrl(next && next.startsWith('/') && !next.startsWith('//') ? next : this.auth.isAdmin() ? '/admin' : '/');
  }
}