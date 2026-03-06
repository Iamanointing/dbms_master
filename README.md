## DBMS Academy

Web-based learning platform to learn DBMS concepts through structured lessons, examples, and exercises.

### Run

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

### Admin login

Set an admin key before starting the server:

PowerShell:

```powershell
$env:ADMIN_KEY="changeme"
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

