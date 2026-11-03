import { Routes } from '@angular/router';
import { HomePage } from './pages/home.page';
import { MenuPage } from './pages/menu.page';
import { CartPage } from './pages/cart.page';
import { CheckoutPage } from './pages/checkout.page';
import { CustomPage } from './pages/custom.page';
import { TrackPage } from './pages/track.page';
import { AdminPage } from './pages/admin.page';

export const routes: Routes = [
  { path: '', title: 'OliviaBakes | Fresh baked to order, delivered to your door', component: HomePage },
  { path: 'menu', title: 'Menu | OliviaBakes', component: MenuPage },
  { path: 'custom', title: 'Custom cakes | OliviaBakes', component: CustomPage },
  { path: 'cart', title: 'Your bag | OliviaBakes', component: CartPage },
  { path: 'checkout', title: 'Checkout | OliviaBakes', component: CheckoutPage },
  { path: 'track/:id', title: 'Your order | OliviaBakes', component: TrackPage },
  { path: 'admin', title: 'Admin | OliviaBakes', component: AdminPage },
  { path: '**', redirectTo: '' },
];