import { Routes } from '@angular/router';
import { HomePage } from './pages/home.page';
import { CartPage } from './pages/cart.page';
import { CheckoutPage } from './pages/checkout.page';
import { CustomPage } from './pages/custom.page';
import { TrackPage } from './pages/track.page';
import { AuthPage } from './pages/auth.page';
import { ResetPage } from './pages/reset.page';
import { ProfilePage } from './pages/profile.page';
import { AdminShell } from './pages/admin-shell.page';
import { AdminPage } from './pages/admin.page';
import { CapacityPage } from './pages/capacity.page';
import { CatalogPage } from './pages/catalog.page';
import { authGuard, adminGuard, customerGuard } from './auth.service';

export const routes: Routes = [
  { path: '', title: 'OliviaBakes | Fresh cookies, baked to order', component: HomePage, canActivate: [customerGuard] },
  { path: 'menu', redirectTo: '' },
  { path: 'custom', title: 'Custom cakes | OliviaBakes', component: CustomPage, canActivate: [authGuard, customerGuard] },
  { path: 'cart', title: 'Your bag | OliviaBakes', component: CartPage, canActivate: [customerGuard] },
  { path: 'checkout', title: 'Checkout | OliviaBakes', component: CheckoutPage, canActivate: [authGuard, customerGuard] },
  { path: 'track/:id', title: 'Your order | OliviaBakes', component: TrackPage },
  { path: 'login', title: 'Log in | OliviaBakes', component: AuthPage, data: { mode: 'login' } },
  { path: 'signup', title: 'Sign up | OliviaBakes', component: AuthPage, data: { mode: 'signup' } },
  { path: 'forgot-password', title: 'Forgot password | OliviaBakes', component: ResetPage, data: { mode: 'forgot' } },
  { path: 'reset-password', title: 'Reset password | OliviaBakes', component: ResetPage, data: { mode: 'reset' } },
  { path: 'profile', redirectTo: 'profile/orders', pathMatch: 'full' },
  { path: 'profile/:tab', title: 'My account | OliviaBakes', component: ProfilePage, canActivate: [authGuard, customerGuard] },
  { path: 'orders', redirectTo: 'profile/orders' },
  {
    path: 'admin', component: AdminShell, canActivate: [adminGuard],
    children: [
      { path: '', redirectTo: 'orders', pathMatch: 'full' },
      { path: 'orders', title: 'Active orders | Admin', component: AdminPage, data: { view: 'orders' } },
      { path: 'custom', title: 'Custom cake requests | Admin', component: AdminPage, data: { view: 'custom' } },
      { path: 'capacity', title: 'Daily capacity | Admin', component: CapacityPage },
      { path: 'items', title: 'Items | Admin', component: CatalogPage, data: { view: 'items' } },
      { path: 'offers', title: 'Offers | Admin', component: CatalogPage, data: { view: 'offers' } },
    ],
  },
  { path: '**', redirectTo: '' },
];