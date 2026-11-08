# Teller approvals console

The React 19/Vite console lists held transfers, records approve/deny reasons, and reads the newest-first audit register. The API key and reviewer identity live only in React memory; no browser storage is used.

```bash
npm test -- --run
npm run build
```

Vite builds with `/console/` as its base. Maven copies `dist/` into the Spring Boot static resources during `prepare-package`, so build this app before packaging the API.
