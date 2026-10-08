# Semester Project Backend

A Node.js + Express REST API backend with:
- **JWT Authentication** – Register & login users securely
- **CRUD for Items** – Create, Read, Update, Delete resources
- **File Upload** – Upload files via multipart form data (stored in `/uploads`)
- **Real-Time WebSocket** – Socket.IO broadcasts item events to all connected clients
- **Analytics** – Stats endpoint showing item counts & recent activity

## Quick Start

### 1. Prerequisites
- Node.js v18+
- MongoDB running locally (`mongod`) or a MongoDB Atlas URI

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment
Edit `.env`:
```
PORT=5000
MONGODB_URI=mongodb://localhost:27017/semester
JWT_SECRET=your_strong_secret_here
```

### 4. Run the Server
```bash
# Development (auto-restart on changes)
npm run dev

# Production
npm start
```

## API Reference

> All routes except `/api/register` and `/api/login` require the header:
> `Authorization: Bearer <token>`

### Auth
| Method | Endpoint         | Body                       | Response        |
|--------|-----------------|----------------------------|-----------------|
| POST   | `/api/register` | `{ username, password }`   | `{ token }`     |
| POST   | `/api/login`    | `{ username, password }`   | `{ token }`     |

### Items (CRUD)
| Method | Endpoint         | Body / Params              | Response        |
|--------|-----------------|----------------------------|-----------------|
| POST   | `/api/items`    | `{ name, description }`    | Created item    |
| GET    | `/api/items`    | –                          | Array of items  |
| GET    | `/api/items/:id`| –                          | Single item     |
| PUT    | `/api/items/:id`| `{ name, description }`    | Updated item    |
| DELETE | `/api/items/:id`| –                          | 204 No Content  |

### File Upload
| Method | Endpoint       | Form Field | Response           |
|--------|---------------|------------|--------------------|
| POST   | `/api/upload` | `file`     | `{ url: "..." }`   |

### Analytics
| Method | Endpoint         | Response                              |
|--------|-----------------|---------------------------------------|
| GET    | `/api/analytics`| `{ totalItems, recentItems[] }`       |

### WebSocket Events (Socket.IO)
| Event          | Payload        | When emitted          |
|----------------|----------------|-----------------------|
| `itemCreated`  | New item       | After POST /api/items |
| `itemUpdated`  | Updated item   | After PUT /api/items  |
| `itemDeleted`  | `{ id }`       | After DELETE          |

## Project Structure
```
project01/
├── index.js          ← Main server
├── models/
│   ├── user.js       ← User schema
│   └── item.js       ← Item schema
├── uploads/          ← Uploaded files stored here
├── .env              ← Environment config (git-ignored)
├── .gitignore
└── package.json
```
