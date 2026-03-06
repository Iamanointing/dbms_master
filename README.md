## DBMS Academy

Web-based learning platform to learn DBMS concepts through structured lessons, examples, and exercises.

### Run

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

### Admin login

Set an admin password hash before starting the server:

PowerShell:

```powershell
$hashOutput = node scripts/generate-admin-password.mjs "changeme"
# Copy the printed ADMIN_PASSWORD_HASH and ADMIN_AUTH_SECRET into your environment, e.g.:
$env:ADMIN_PASSWORD_HASH="(paste from script output)"
$env:ADMIN_AUTH_SECRET="(paste from script output)"
npm run dev
```

Then open `http://localhost:3000/admin`.

### Storage

This project is dependency-free and stores data as JSON files in `data/`:

- `data/topics.json`
- `data/lessons.json`
- `data/quizzes.json` (optional knowledge checks)
- `data/users.json`
- `data/progress/<userId>.json`

