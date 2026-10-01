import { Routes } from '@angular/router';
import { HomePage } from './pages/home.page';
import { MenuPage } from './pages/menu.page';
import { CartPage } from './pages/cart.page';
import { CheckoutPage } from './pages/checkout.page';
import { TrackPage } from './pages/track.page';
import { BoardPage } from './pages/board.page';
import { KitchenPage } from './pages/kitchen.page';

export const routes: Routes = [
  { path: '', component: HomePage },
  { path: 'menu', component: MenuPage },
  { path: 'cart', component: CartPage },
  { path: 'checkout', component: CheckoutPage },
  { path: 'track/:id', component: TrackPage },
  { path: 'board', component: BoardPage },
  { path: 'kitchen', component: KitchenPage },
  { path: '**', redirectTo: '' },
];