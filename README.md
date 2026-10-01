# OliveBakes

A real-time bakery ordering app with a queue system, like a counter at a busy cafe. Customers order, get a ticket number, and watch their place in line move live.

**Live demo:** https://oliviabakes.onrender.com/

The free server sleeps when idle, so the first load can take about 30 seconds.

## Features

- Menu with photos, category filters, and live stock counts
- Bag and checkout with pickup or delivery, and payment options (simulated)
- Ticket numbers and a live order tracker
- Public "Now serving" board
- Kitchen screen to run the queue
- Scroll-driven 3D photo animations (Three.js)
- Prices in rupees

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Angular, TypeScript, Three.js |
| Backend | Node.js, Express |
| Database | PostgreSQL (Neon) |
| Hosting | Render |

## Database Highlights

- **Transactional checkout:** stock is taken with `UPDATE ... WHERE stock >= qty`, so the last item can never be oversold
- **Real-time updates:** triggers call `pg_notify`, the server `LISTEN`s and streams changes to browsers over Server-Sent Events
- **Queue positions:** `ROW_NUMBER() OVER (PARTITION BY status ...)` in a view
- **Bestsellers:** ranked with a `RANK()` window function view
- **Safe order claiming:** `FOR UPDATE SKIP LOCKED` stops two staff taking the same order
- **Data integrity:** CHECK constraints, foreign keys, indexes, and money stored as integer paise
- **Server-side pricing:** totals and delivery fees are recalculated from the database, never trusted from the browser

## Run Locally

You need Node 20+ and a PostgreSQL database (a free Neon database works).

```bash
git clone https://github.com/YOUR-USERNAME/olivebakes.git
cd olivebakes
```

Create `backend/.env`:

```
DATABASE_URL=your_postgres_connection_string
```

Start the backend:

```bash
cd backend
npm install
npm run dev
```

Start the frontend in a second terminal:

```bash
cd frontend
npm install
npm start
```

Open http://localhost:4200. Tables and sample products are created automatically on first start.

## Project Structure

```
backend/     Express API, schema.sql, real-time events
frontend/    Angular app (pages, 3D scene, services)
```

## Pages

| Route | Purpose |
|---|---|
| `/` | Home with 3D scroll animation |
| `/menu` | Browse and add to bag |
| `/checkout` | Details, pickup or delivery, payment |
| `/track/:id` | Live ticket and queue position |
| `/board` | Now serving screen |
| `/kitchen` | Staff queue controls |

## Notes

Payments are simulated and no money is charged. The kitchen screen has no login, and adding authentication is the next step.
