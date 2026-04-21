# Travel Planner - Deployment Guide

A multi-user travel planning app with cloud sync, built with Cloudflare Workers + KV + Pages.

## Features

✅ **Multi-user support** - Each user has their own account and trips  
✅ **Cloud sync** - Access your trips from any device  
✅ **Dynamic sections** - Add unlimited days, events, accommodations, travel, packing items, notes  
✅ **Generalized** - Works for any destination, not just UK  
✅ **Travel types** - Flights, trains, buses, car rentals, etc.  
✅ **Mobile-friendly** - Works great on phones for on-the-go access  

## Architecture

- **Frontend**: Static HTML/JS hosted on Cloudflare Pages
- **Backend**: Cloudflare Worker with REST API
- **Database**: Cloudflare KV (key-value store)
- **Auth**: Simple email/password with session tokens

## Quick Deploy

### Step 1: Create KV Namespace

```bash
# Install Wrangler if you haven't
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Create KV namespace
wrangler kv:namespace create "TRAVEL_KV"
wrangler kv:namespace create "TRAVEL_KV" --preview
```

Copy the namespace IDs and update `wrangler.toml`.

### Step 2: Deploy Backend

```bash
cd backend

# Update wrangler.toml with your KV namespace IDs
# Then deploy:
wrangler deploy
```

Your API will be at: `https://travel-planner-api.your-account.workers.dev`

### Step 3: Update Frontend API URL

In `app.js`, update line 4:
```javascript
const API_URL = 'https://travel-planner-api.your-account.workers.dev';
```

### Step 4: Deploy Frontend

```bash
# Deploy to Cloudflare Pages
wrangler pages deploy . --project-name=travel-planner
```

Or use the drag-and-drop method in the Cloudflare dashboard.

## File Structure

```
uk-trip-tracker/
├── index.html          # Main HTML file
├── app.js             # Frontend app (all the UI logic)
├── backend/
│   ├── worker.js      # Cloudflare Worker API
│   └── wrangler.toml  # Worker configuration
└── README.md          # This file
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/register` | POST | Create new account |
| `/api/auth/login` | POST | Sign in |
| `/api/auth/logout` | POST | Sign out |
| `/api/trips` | GET | List all trips |
| `/api/trips` | POST | Create new trip |
| `/api/trips/:id` | GET | Get specific trip |
| `/api/trips/:id` | PUT | Update trip |
| `/api/trips/:id` | DELETE | Delete trip |

## Data Structure

Each trip contains:

```javascript
{
  id: "uuid",
  userId: "uuid",
  title: "Japan Adventure",
  dates: "March 30 - April 8, 2026",
  destinations: ["Tokyo", "Kyoto"],
  days: [
    {
      date: "2026-03-30",
      label: "Day 1 - Arrival",
      location: "Tokyo",
      events: [
        { time: "3:00 PM", title: "Arrive at NRT", type: "travel", confirmed: true }
      ]
    }
  ],
  accommodations: [
    { name: "Hotel Gracery", location: "Shinjuku", dates: "Mar 30 - Apr 4", link: "", confirmed: true }
  ],
  travel: [
    { type: "Flight", direction: "Outbound", date: "Mar 30", route: "LAX → NRT", details: "JAL 61", link: "", confirmed: true }
  ],
  packingList: [
    { item: "Passport", packed: false }
  ],
  notes: ["Check weather forecast"]
}
```

## Local Development

```bash
# Start local dev server for frontend
python3 -m http.server 8080

# In another terminal, start worker locally
cd backend
wrangler dev
```

Update `API_URL` in `app.js` to `http://localhost:8787` for local testing.

## Security Notes

⚠️ **Password hashing is basic** - This uses a simple hash for demo purposes. For production:
- Use bcrypt or Argon2 for password hashing
- Add rate limiting
- Consider adding email verification
- Use HTTPS only (Cloudflare handles this)

## Cost

Cloudflare's free tier includes:
- 100,000 Worker requests/day
- 1 GB KV storage
- Unlimited Pages deployments

Perfect for personal use and small groups!

## Custom Domain (Optional)

1. Add your domain to Cloudflare
2. In Pages settings, add custom domain
3. Update API_URL to use your domain

## Troubleshooting

**CORS errors?** Make sure the Worker's CORS headers are configured properly.

**KV not working?** Double-check the namespace IDs in wrangler.toml.

**Login not working?** Check browser dev tools Network tab for API errors.

## Next Steps

- Add export/import JSON for offline backup
- Add photo attachments (Cloudflare R2)
- Share trips between users
- Collaborative editing
- Calendar sync (iCal export)

---

Built with ❤️ for travelers everywhere!
