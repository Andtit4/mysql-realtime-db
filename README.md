# mysql-realtime-db

Couche base de données **temps réel** pour MySQL **sans binlog** : événements au niveau application et option changelog (triggers + table).

- **Mode application** : les écritures passent par l’API du package → émission d’événements (WebSocket).
- **Mode changelog** (optionnel) : table `_realtime_changelog` + triggers sur vos tables → un poller lit les changements et les diffuse.

## Installation

```bash
npm install mysql-realtime-db
```

## Configuration minimale (mode application)

```javascript
const realtime = require('mysql-realtime-db');

const db = realtime.createConnection({
  host: 'localhost',
  user: 'myuser',
  password: 'mypassword',
  database: 'mydb',
  realtime: {
    port: 3040,              // Port du serveur WebSocket
    path: '/realtime'        // Chemin WebSocket (optionnel)
  }
});

await db.connect();
await db.startRealtimeServer();
```

## Écouter les changements (côté serveur)

```javascript
db.on('users:insert', (row) => console.log('Nouveau user:', row));
db.on('users:update', ({ previous, current }) => console.log('Modifié:', previous, '->', current));
db.on('users:delete', (row) => console.log('Supprimé:', row));
db.on('users:*', (event, data) => console.log(event, data));
```

## Écritures qui émettent les événements

```javascript
const id = await db.insert('users', { name: 'Alice', email: 'alice@example.com' });
await db.update('users', { id: 1 }, { name: 'Alice Updated' });
await db.delete('users', { id: 1 });
```

## Requêtes en lecture seule

```javascript
const rows = await db.query('SELECT * FROM users WHERE active = ?', [1]);
```

## Client distant (navigateur ou autre service Node)

```javascript
const client = realtime.createClient({
  url: 'http://localhost:3040',
  path: '/realtime'
});

await client.connect();

client.subscribe('users', (event, data) => {
  console.log(event, data);  // 'insert' | 'update' | 'delete', payload
});

client.subscribe('posts:*', (event, data) => {
  // Tous les événements sur la table posts
});
```

## Mode changelog (capturer toutes les écritures)

Pour détecter les changements même hors de l’application (SQL direct, autre service), installez la table de changelog et les triggers (les tables doivent avoir une colonne `id`) :

```javascript
const db = realtime.createConnection({
  host: 'localhost',
  user: 'app',
  password: '***',
  database: 'mydb',
  realtime: {
    port: 3040,
    enableChangelog: true,
    changelogPollIntervalMs: 500,
    tables: ['users', 'posts', 'comments']
  }
});

await db.connect();
await db.installChangelog();   // Crée _realtime_changelog + triggers
await db.startRealtimeServer();
```

## API

| Méthode | Description |
|--------|-------------|
| `createConnection(options)` | Crée une connexion avec support realtime |
| `db.connect()` | Connexion au pool MySQL |
| `db.startRealtimeServer()` | Démarre le serveur WebSocket |
| `db.on('table:event', fn)` | Écoute insert / update / delete |
| `db.insert(table, data)` | INSERT + émission d’événement |
| `db.update(table, where, data)` | UPDATE + émission d’événement |
| `db.delete(table, where)` | DELETE + émission d’événement |
| `db.query(sql, params)` | Requête arbitraire (pas d’événement) |
| `db.installChangelog()` | Installe la table + triggers (mode changelog) |
| `createClient(options)` | Client pour se connecter au serveur realtime |
| `client.subscribe(pattern, callback)` | Abonnement à une table ou un pattern |

## Licence

MIT
