import { Component, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

@Component({
  standalone: true,
  imports: [RouterLink],
  styles: [`
    .auth { display: grid; place-items: center; padding: 48px 16px; }
    .auth-card { width: 100%; max-width: 420px; background: #fff; border: 1px solid #F2C7C7; border-radius: 24px; padding: 32px; box-shadow: 0 10px 30px rgba(255,183,197,.25); }
    .auth-card h1 { font-size: 1.7rem; margin: 0 0 4px; }
    .auth-card label { display: block; margin-top: 14px; font-weight: 500; }
    .auth-card input { display: block; width: 100%; margin-top: 6px; }
    .switch { margin-top: 18px; text-align: center; }
  `],
  template: `
  <section class="auth">
    <div class="auth-card">
      @if (done()) {
        <h1>{{ forgot ? 'Check your email' : 'Password changed' }}</h1>
        <p class="muted">{{ forgot ? 'If an account exists for that email, we have sent a reset link. It expires in 30 minutes.' : 'You can now log in with your new password.' }}</p>
        @if (!forgot) { <a routerLink="/login" class="btn wide">Go to log in</a> }
      } @else {
        <h1>{{ forgot ? 'Forgot your password?' : 'Choose a new password' }}</h1>
        <p class="muted">{{ forgot ? 'Enter your email and we will send you a reset link.' : 'Pick a password with at least 8 characters.' }}</p>
        <form (submit)="submit($event)" novalidate>
          @if (forgot) {
            <label>Email <input type="email" autocomplete="email" [value]="email()" (input)="email.set(val($event))"></label>
          } @else {
            <label>New password <input type="password" autocomplete="new-password" [value]="pw()" (input)="pw.set(val($event))"></label>
            <label>Confirm new password <input type="password" autocomplete="new-password" [value]="pw2()" (input)="pw2.set(val($event))"></label>
          }
          @if (err()) { <p class="hint bad">{{ err() }}</p> }
          <button class="btn wide" type="submit" [disabled]="busy()">{{ busy() ? 'Please wait...' : (forgot ? 'Send reset link' : 'Change password') }}</button>
        </form>
        <p class="switch"><a routerLink="/login" class="under">Back to log in</a></p>
      }
    </div>
  </section>
  `,
})
export class ResetPage {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);
  forgot = this.route.snapshot.data['mode'] === 'forgot';
  token = this.route.snapshot.queryParamMap.get('token') ?? '';
  email = signal(''); pw = signal(''); pw2 = signal('');
  err = signal(''); busy = signal(false); done = signal(false);

  val(e: Event) { return (e.target as HTMLInputElement).value; }

  async submit(e: Event) {
    e.preventDefault();
    this.err.set('');
    if (this.forgot) {
      if (!/^\S+@\S+\.\S+$/.test(this.email().trim())) return this.err.set('Enter a valid email address');
    } else {
      if (!this.token) return this.err.set('This reset link is not valid. Please request a new one.');
      if (this.pw().length < 8) return this.err.set('Password must be at least 8 characters');
      if (this.pw() !== this.pw2()) return this.err.set('The two passwords do not match');
    }
    this.busy.set(true);
    try {
      await firstValueFrom(this.forgot
        ? this.http.post('/api/auth/forgot', { email: this.email().trim() })
        : this.http.post('/api/auth/reset', { token: this.token, password: this.pw() }));
      this.done.set(true);
    } catch (x: any) { this.err.set(x.error?.error ?? 'Something went wrong. Please try again.'); }
    this.busy.set(false);
  }
}